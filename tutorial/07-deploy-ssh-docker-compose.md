# Módulo 7: Deploy a un servidor propio por SSH con Docker Compose

## Conceptos

### PaaS vs servidor propio

En el módulo 6 Vercel se ocupó de todo lo que no era tu código: máquinas,
HTTPS, dominio, escalado, rollback. Pagás con dinero (cuando superás el
plan gratis) y con dependencia: tu app corre como Vercel decide.

En un servidor propio es al revés. Una VM Linux con Docker, y adentro corre
la imagen que publicaste en GHCR. Tenés control total y pagás menos, pero
las actualizaciones del sistema, el firewall, los backups y el HTTPS son
problema tuyo. Para una API con base de datos, un worker, o cualquier cosa
que no encaje en el molde de Vercel, este es el camino habitual.

Lo importante del módulo no es el servidor en sí: es que **el pipeline no
cambia de forma**. Mismo trigger, mismo `needs`, mismo smoke test. Solo
cambia qué hace el último job.

### Qué necesitás

Un servidor Linux al que llegues por SSH desde internet, con una IP
pública. Cualquiera de estas opciones sirve:

- Un VPS chico: Hetzner (desde ~4 €/mes), DigitalOcean (desde ~4 USD),
  Vultr, Linode. Ubuntu 24.04, el plan más barato alcanza.
- Oracle Cloud tiene una capa gratuita permanente con VMs ARM que sirve
  para esto, aunque el registro es engorroso.
- Una máquina tuya con IP pública y el puerto 22 abierto, si tenés.

Si no tenés nada de eso ahora, leé el módulo entero igual: los pasos 3 y 4
(Compose) los podés hacer en tu máquina, y el resto queda listo para cuando
tengas servidor.

### Docker Compose

Un archivo YAML que describe **qué contenedores** querés corriendo y
**cómo**: imagen, puertos, variables, reinicio. `docker compose up -d` lee
el archivo, compara con lo que está corriendo, y hace solo lo necesario:
crea lo que falta, recrea lo que cambió, deja en paz lo que está igual.
Es declarativo e idempotente, igual que un workflow. Un deploy con Compose
son dos comandos:

```
docker compose pull    → baja la imagen nueva del registry
docker compose up -d   → reemplaza el contenedor viejo por uno con la nueva
```

Compose lee un archivo `.env` al lado del YAML y usa sus variables para
interpolar `${IMAGE_TAG}` y similares. Ese `.env` va a ser el registro de
qué versión está desplegada.

### El modelo de deploy: el runner entra por SSH

Hay varias formas de que un servidor se entere de que hay una imagen
nueva. La más simple, y la de este módulo, es **push desde el runner**: el
job de GitHub Actions abre una conexión SSH al servidor y ejecuta los dos
comandos de arriba. El runner necesita una clave SSH; el servidor, un
usuario que pueda usar Docker.

Alternativas que vas a escuchar: un agente en el servidor que mira el
registry cada tanto (Watchtower), un webhook que GHCR llama al publicar, o
un orquestador que hace todo esto a escala (Kubernetes, Nomad). Para un
servidor, SSH es lo correcto.

### SSH y claves

SSH autentica con un **par de claves**: la privada se queda con quien se
conecta, la pública se instala en el servidor (`~/.ssh/authorized_keys`
del usuario). Vamos a generar un par **exclusivo para el deploy**, distinto
de tu clave personal: si se filtra, revocás esa y nada más.

La privada va a un secret. Pero hay un segundo secreto que la gente
olvida: la **identidad del servidor**. La primera vez que te conectás a un
host, SSH te pregunta si confiás en su huella y la guarda en
`~/.ssh/known_hosts`. En el runner no hay nadie para responder esa
pregunta, y responderla con "sí a todo" (`StrictHostKeyChecking=no`)
abre la puerta a que alguien se haga pasar por tu servidor. La forma
correcta es guardar la huella desde tu máquina, donde ya la verificaste, y
dársela al runner.

### Healthcheck y `--wait`

Compose puede vigilar un contenedor con un **healthcheck**: un comando que
corre adentro cada N segundos, y si falla varias veces seguidas el
contenedor pasa a *unhealthy*. Con `docker compose up -d --wait`, el
comando no termina hasta que el contenedor esté *healthy*, y falla si no lo
logra. Es el smoke test desde adentro, y nos da un deploy que **falla con
código distinto de 0** cuando la app no levanta. Encima le sumamos el
`curl` desde afuera, como en Vercel.

### Rollback con `workflow_dispatch`

Cada imagen tiene su tag `sha-...` inmutable. Volver atrás es desplegar un
tag viejo. Para eso armamos un segundo workflow con `on: workflow_dispatch`:
un botón en la pestaña Actions (o `gh workflow run`) que recibe el tag como
parámetro. Es tu primer workflow que no se dispara por un evento de git.

## Instrucciones

### Paso 1: Preparar el servidor

Conectate como root (o un usuario con `sudo`) con la clave o contraseña
que te dio el proveedor. Todo lo de este paso es una sola vez.

```bash
curl -fsSL https://get.docker.com | sh
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
chown -R deploy:deploy /home/deploy/.ssh
```

- El script de `get.docker.com` instala Docker y el plugin de Compose.
  Verificá con `docker compose version`.
- `deploy` es el usuario que va a usar el runner. Sin contraseña: solo
  entra con clave. En el grupo `docker` para poder correr `docker compose`
  sin `sudo`.

Si el servidor tiene firewall (`ufw` en Ubuntu, o el firewall del proveedor
en su panel), tienen que estar abiertos el **22** (SSH) y el **80** (la
app). Con `ufw`:

```bash
ufw allow 22 && ufw allow 80 && ufw enable
```

### Paso 2: Clave de deploy y secrets

En tu máquina, generá el par:

```bash
ssh-keygen -t ed25519 -C "deploy prueba_ci_cd" -f ~/.ssh/prueba_ci_cd_deploy -N ""
```

- `ed25519`: el algoritmo recomendado hoy, claves cortas y rápidas.
- `-N ""`: sin passphrase. El runner no puede tipear una.

Instalá la pública en el servidor. Todavía como root en el servidor, pegá
el contenido de `~/.ssh/prueba_ci_cd_deploy.pub` (de tu máquina) en
`/home/deploy/.ssh/authorized_keys`, y después:

```bash
chmod 600 /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
```

Probá desde tu máquina, con la IP de tu servidor:

```bash
ssh -i ~/.ssh/prueba_ci_cd_deploy deploy@TU_IP docker ps
```

Te pregunta si confiás en la huella del host (decí `yes`; esa es la única
vez que corresponde) y tiene que listar los contenedores (ninguno). Si
funciona, cargá los cuatro secrets:

```bash
gh secret set SSH_HOST --body "TU_IP"
gh secret set SSH_USER --body "deploy"
gh secret set SSH_PRIVATE_KEY < ~/.ssh/prueba_ci_cd_deploy
ssh-keyscan -H TU_IP 2>/dev/null | gh secret set SSH_KNOWN_HOSTS
```

- `< archivo`: `gh secret set` lee el valor de stdin, así que la clave
  privada nunca pasa por la línea de comandos ni por el historial.
- `ssh-keyscan -H` imprime la huella del servidor en el formato de
  `known_hosts`. Como ya te conectaste y la aceptaste, es la que vale.
  El `2>/dev/null` calla el banner que manda por stderr.

### Paso 3: El archivo de Compose

```bash
git checkout main && git pull
git checkout -b cd/servidor
mkdir deploy
```

Creá `deploy/compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/fndecroix/prueba_ci_cd:${IMAGE_TAG:-main}
    restart: unless-stopped
    ports:
      - "${APP_PORT:-80}:3000"
    environment:
      APP_VERSION: ${IMAGE_TAG:-main}
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "/dev/null", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
```

- `services.app`: un solo servicio, el contenedor de la app. Cuando sumes
  una base de datos, es otro servicio acá abajo.
- `image: ...:${IMAGE_TAG:-main}`: el tag viene de la variable `IMAGE_TAG`;
  si no está definida, `main`. El job va a pasar siempre un `sha-...`.
- `restart: unless-stopped`: si el contenedor muere o el servidor se
  reinicia, Docker lo vuelve a levantar.
- `ports: "${APP_PORT:-80}:3000"`: el puerto `APP_PORT` del servidor (80
  si no está definido) va al 3000 del contenedor. En el servidor queda 80,
  así la app responde en `http://TU_IP` sin puerto; en tu máquina, donde el
  80 suele estar ocupado, lo cambiás con la variable.
- `environment.APP_VERSION`: la ruta `/api/health` del módulo 0 devuelve
  esta variable. Le pasamos el tag, así la app **dice qué versión es**, y
  el smoke test puede verificar que lo que corre es lo que se desplegó.
- `healthcheck`: `wget` existe en la imagen Alpine. Cada 10 segundos pide
  `/api/health`; 5 fallos seguidos y el contenedor es *unhealthy*.
  `start_period` le da 10 segundos de gracia al arrancar.

Probalo en tu máquina con la imagen que ya está en GHCR:

```bash
cd deploy
printf 'IMAGE_TAG=main\nAPP_PORT=8080\n' > .env
docker compose pull
docker compose up -d --wait
curl http://localhost:8080/api/health
docker compose ps
docker compose down
rm .env
cd ..
```

Tiene que responder `{"status":"ok","version":"main",...}`, y `ps` tiene
que mostrar el contenedor como `healthy`. El `.env` no se versiona: cada
máquina tiene el suyo, y en el servidor es el runner el que lo escribe.

### Paso 4: Que el push a `main` no cancele un deploy a medias

Tu `concurrency` cancela el run anterior cuando llega un push nuevo a la
misma rama. En un PR es lo que querés. En `main`, con un deploy en curso,
cancelarlo a la mitad puede dejar el servidor con el contenedor bajado.
Cambiá el bloque `concurrency` por:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

- `cancel-in-progress` acepta una expresión. En PRs sigue cancelando; en
  `main` los runs hacen cola y corren uno después del otro, en orden.

### Paso 5: El job de deploy

Agregá este job a `ci.yml`, después de `production` y antes de `ci`.

#### Pieza 1: cabecera y SSH

```yaml
  deploy:
    needs: [docker]
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      SSH_HOST: ${{ secrets.SSH_HOST }}
      SSH_USER: ${{ secrets.SSH_USER }}
      IMAGE_TAG: sha-${{ github.sha }}
    steps:
      - uses: actions/checkout@v4
      - name: Configurar SSH
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          SSH_KNOWN_HOSTS: ${{ secrets.SSH_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
          echo "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
          chmod 600 ~/.ssh/id_ed25519 ~/.ssh/known_hosts
```

- `needs: [docker]`: la imagen tiene que estar publicada antes. Como
  `docker` ya depende de lint, typecheck, test y build, esto encadena todo.
- `IMAGE_TAG: sha-${{ github.sha }}` da el SHA **completo**, de 40
  caracteres, pero `metadata-action` publicó el tag con 7. Lo acortamos en
  el step siguiente con bash; acá queda la base.
- El step de SSH escribe la clave privada y el `known_hosts` donde el
  cliente `ssh` los busca por defecto, con permisos `600` (sin eso `ssh`
  se niega a usar la clave). El `|` abre un script multilínea.

#### Pieza 2: desplegar

```yaml
      - name: Copiar compose al servidor
        run: |
          ssh "$SSH_USER@$SSH_HOST" mkdir -p app
          scp deploy/compose.yml "$SSH_USER@$SSH_HOST:app/compose.yml"
      - name: Desplegar
        run: |
          TAG="sha-${GITHUB_SHA::7}"
          ssh "$SSH_USER@$SSH_HOST" "cd app && echo IMAGE_TAG=$TAG > .env && docker compose pull --quiet && docker compose up -d --wait"
```

- `scp` copia el archivo de Compose versionado en el repo al servidor. Si
  cambiás el compose en un PR, el merge lo lleva solo.
- `${GITHUB_SHA::7}`: bash recortando los primeros 7 caracteres de la
  variable de entorno `GITHUB_SHA`, que GitHub define en todos los runs.
  Coincide con el `type=sha` del módulo 5.
- La línea de `ssh` ejecuta en el servidor: escribe el `.env` con el tag,
  baja la imagen, y recrea el contenedor esperando a que esté *healthy*.
  Si no lo logra, `--wait` sale con error y el job queda rojo.

#### Pieza 3: smoke test desde afuera

```yaml
      - name: Smoke test
        run: |
          TAG="sha-${GITHUB_SHA::7}"
          curl --fail --silent --show-error --retry 5 --retry-delay 3 "http://$SSH_HOST/api/health" | tee salud.json
          grep -q "\"version\":\"$TAG\"" salud.json
```

- Igual que en Vercel, pero además `grep` verifica que la versión que
  responde sea el tag recién desplegado. Si el servidor respondiera con la
  imagen vieja (por ejemplo porque `pull` falló en silencio), el deploy
  fallaría acá en vez de pasar como si nada.

Validá y commiteá:

```bash
npx --yes @action-validator/cli .github/workflows/ci.yml
git add deploy/compose.yml .github/workflows/ci.yml
git commit -m "Deploy a servidor por SSH con Docker Compose"
git push -u origin cd/servidor
gh pr create --fill
```

En el PR el job `deploy` queda skipped (es solo `push`). Cuando esté verde:

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
gh run watch
```

Mirá el job `deploy` en el log, y después:

```bash
curl http://TU_IP/api/health
```

Tiene que devolver `"version":"sha-..."` con el SHA del merge. Y en el
servidor, `cat ~/app/.env` te dice lo mismo.

### Paso 6: Workflow de rollback

Creá `.github/workflows/rollback.yml`:

```yaml
name: Rollback

on:
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag de la imagen a desplegar (por ejemplo sha-7e4baa7)"
        required: true
        type: string

jobs:
  rollback:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      SSH_HOST: ${{ secrets.SSH_HOST }}
      SSH_USER: ${{ secrets.SSH_USER }}
      TAG: ${{ inputs.tag }}
    steps:
      - name: Configurar SSH
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          SSH_KNOWN_HOSTS: ${{ secrets.SSH_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh
          echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_ed25519
          echo "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
          chmod 600 ~/.ssh/id_ed25519 ~/.ssh/known_hosts
      - name: Desplegar el tag pedido
        run: ssh "$SSH_USER@$SSH_HOST" "cd app && echo IMAGE_TAG=$TAG > .env && docker compose pull --quiet && docker compose up -d --wait"
      - name: Smoke test
        run: |
          curl --fail --silent --show-error --retry 5 --retry-delay 3 "http://$SSH_HOST/api/health" | tee salud.json
          grep -q "\"version\":\"$TAG\"" salud.json
```

- `workflow_dispatch` con `inputs`: el workflow se dispara a mano y pide un
  valor. Se lee con `${{ inputs.tag }}`.
- No hace `checkout`: no necesita nada del repo, el compose ya está en el
  servidor.
- Los steps de SSH y deploy están copiados del job `deploy`. Es la tercera
  vez que ves duplicación de este tipo; el módulo 11 es para eso.

Commit, PR, merge (recordá que `workflow_dispatch` lee el archivo de la
rama default, así que hasta que esté en `main` no aparece el botón). Después
buscá un tag viejo en la página del paquete en GHCR, o con:

```bash
git log --oneline -5 main
```

y disparalo:

```bash
gh workflow run rollback.yml -f tag=sha-XXXXXXX
gh run watch
curl http://TU_IP/api/health
```

La versión tiene que ser la vieja. En la pestaña Actions, el workflow
"Rollback" también tiene un botón **Run workflow** que pide el tag.

### Paso 7: Romperlo a propósito

En una rama, el mismo `throw new Error("boom")` del módulo 6 en
`/api/health`. PR, y esta vez **mergealo**: vas a ver qué pasa en
producción cuando llega código roto.

El run de `main`: `docker` publica la imagen (el build no se entera), y
`deploy` falla en `docker compose up -d --wait` porque el healthcheck nunca
pasa. El job queda rojo. Pero fijate qué quedó en el servidor:

```bash
curl http://TU_IP/api/health
```

Error 500. El contenedor viejo ya fue reemplazado. El smoke test te
**avisó**, no te **protegió**. Volvé con el rollback del paso 6 al último
`sha-` sano, y después un PR que saque el `throw`.

## Consigna

1. Pasos 1 a 7.
2. Avisame con la IP (o dominio) del servidor y el output de
   `curl http://TU_IP/api/health` después del rollback.

## Para pensar

- En el paso 7 el servidor quedó roto aunque el deploy falló. ¿Cómo lo
  evitarías? Pista: dos contenedores y un proxy adelante (Caddy, Traefik,
  nginx) que cambia de uno a otro solo cuando el nuevo está *healthy*. Se
  llama *blue/green*.
- La app responde por HTTP en el puerto 80, sin cifrar. Buscá qué hace
  Caddy con un dominio y por qué dos líneas de configuración te dan HTTPS
  automático. ¿Dónde lo pondrías en el compose?
- El secret `SSH_PRIVATE_KEY` permite entrar al servidor como `deploy`, que
  está en el grupo `docker`. Estar en el grupo `docker` equivale a ser root
  en esa máquina. ¿Qué podría hacer alguien que consiga ese secret?
- `SSH_HOST` y `SSH_USER` no son secretos; ¿por qué los pusimos como
  secrets? ¿Qué perdés al hacerlo? (Mirá un log del job `deploy`.)
