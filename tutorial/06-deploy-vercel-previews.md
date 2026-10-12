# Módulo 6: Deploy a Vercel con previews por PR

## Conceptos

### De CI a CD

Hasta acá el pipeline **verifica** (lint, typecheck, tests, build) y
**empaqueta** (imagen Docker). Falta el último tramo: que el código llegue
a algún lado donde alguien lo pueda usar. Eso es *continuous deployment*:
cada merge a `main` termina en producción sin que nadie corra un comando a
mano.

Y hay un paso intermedio que vale tanto como el deploy a producción: el
**preview por PR**. Cada pull request se despliega a una URL propia,
temporal, que cualquiera puede abrir desde el PR. Un revisor no tiene que
clonar la rama ni levantar nada para ver el cambio funcionando. Cuando el
PR se cierra, la URL muere.

En este módulo vamos a hacer las dos cosas contra Vercel. En el 7, lo mismo
contra un servidor tuyo con la imagen Docker del módulo 5. Son dos destinos
distintos para el mismo pipeline, y cuando termines los dos vas a poder
compararlos con criterio.

### Qué es Vercel

Una plataforma de hosting (PaaS, *platform as a service*) hecha por la
empresa que mantiene Next.js. Le das el output del build y ella lo sirve:
CDN, HTTPS, dominio `*.vercel.app`, escalado, todo resuelto. El plan Hobby
es gratis para proyectos personales, que es tu caso. Alternativas del mismo
tipo: Netlify, Cloudflare Pages, Railway, Render. Los conceptos de este
módulo valen para todas.

### Dos formas de deployar a Vercel

1. **Integración Git.** Conectás el repo desde la UI de Vercel y ella sola
   escucha los pushes, hace el build en sus máquinas y despliega. Cero
   configuración. Pero el deploy pasa por afuera de tu pipeline: Vercel
   despliega aunque tu CI esté rojo, no sabe nada de tu compuerta `ci`, y
   el build corre en un entorno que no controlás.
2. **Desde GitHub Actions con la CLI de Vercel.** Tu workflow hace el build
   en el runner y le sube el resultado a Vercel. El deploy es un job más:
   corre después de los tests, solo si pasaron, y vos decidís cuándo y cómo.

Vamos por la segunda, porque es la que enseña CD. Consecuencia práctica:
**no conectes el repo desde la UI de Vercel** (no uses "Import Git
Repository"). Si lo hacés, vas a tener dos deploys por cada push, uno de
Vercel y otro del workflow.

### Los tres comandos

La CLI de Vercel separa el deploy en tres pasos, y conviene entenderlos
porque el workflow los copia tal cual:

```
vercel pull     → baja la configuración del proyecto a .vercel/
vercel build    → corre el build de Next en tu máquina (o en el runner)
                  usando esa configuración; deja todo en .vercel/output/
vercel deploy --prebuilt → sube .vercel/output/ tal cual, sin rebuild
```

El `--prebuilt` es la clave: Vercel no construye nada, solo hospeda lo que
vos construiste. El build corre en el mismo runner, con el mismo Node, que
el resto de tu CI.

### Preview vs production, y por qué es igual que los tags de Docker

Cada deploy en Vercel tiene una **URL única e inmutable**, algo como
`prueba-ci-cd-k3j2h1-fndecroix.vercel.app`. Esa URL muestra ese deploy para
siempre. Un deploy de **preview** es solo eso. Un deploy de **production**
además mueve el dominio principal (`prueba-ci-cd.vercel.app`) para que
apunte a él.

Si lo pensás, es exactamente el esquema del módulo 5: la URL única es el
tag `sha-...`, el dominio principal es el tag `main`. Y el rollback es
igual de barato: mover el dominio al deploy anterior, que sigue existiendo.
Vercel lo llama *Instant Rollback*.

### Secrets

Para hablar con Vercel desde el runner hace falta un **token** de tu
cuenta. No puede ir en el YAML: el repo es público y cualquiera lo leería.
GitHub tiene **secrets** para esto: valores cifrados que solo existen
dentro de los runs, se leen con `${{ secrets.NOMBRE }}`, y si alguno
aparece en un log GitHub lo reemplaza por `***`. Se cargan con
`gh secret set`. En el módulo 8 vemos a fondo cómo funcionan, qué no
protegen, y cómo restringir quién puede usarlos.

### Un deploy no está terminado cuando el comando termina

Que `vercel deploy` salga con código 0 significa que subió los archivos.
No significa que la app ande. El último step de un deploy siempre tiene que
ser un **smoke test**: una request real a la URL nueva verificando que
responde. Para eso dejamos `/api/health` en el módulo 0.

## Instrucciones

### Paso 0: Cuenta en Vercel

Creá una cuenta en https://vercel.com/signup. Podés entrar con tu cuenta de
GitHub; eso solo te loguea, no conecta ningún repo. Cuando te pregunte si
querés importar un repositorio, **no** lo hagas.

### Paso 1: Rama

```bash
git checkout main && git pull
git checkout -b cd/vercel
```

### Paso 2: Vincular el proyecto desde tu máquina

```bash
npx vercel@latest login
```

Te abre el navegador para autorizar. Después:

```bash
npx vercel@latest link
```

Te hace preguntas: confirmá la carpeta, elegí tu cuenta como *scope*,
respondé **no** a "Link to existing project?", poné `prueba-ci-cd` como
nombre, y `./` como directorio. Al terminar deja una carpeta `.vercel/`
con un `project.json`. Miralo:

```bash
cat .vercel/project.json
```

Tiene dos IDs: `orgId` (tu cuenta) y `projectId` (el proyecto recién
creado). Es lo que la CLI necesita para saber a qué proyecto le habla. Esa
carpeta ya está en el `.gitignore` que trae Next (`grep vercel .gitignore`):
no se versiona, cada máquina se vincula sola.

### Paso 3: Probar los tres comandos a mano

```bash
npx vercel@latest pull --yes --environment=preview
npx vercel@latest build
npx vercel@latest deploy --prebuilt
```

- `pull --yes --environment=preview`: baja la config a `.vercel/` sin
  preguntar nada. `preview` o `production` eligen qué variables de entorno
  del proyecto se bajan; todavía no tenés ninguna, pero el flag es
  obligatorio en CI.
- `build`: corre `next build` con esa config. Fijate que usa tu Node local
  y que tarda lo mismo que `npm run build`.
- `deploy --prebuilt`: sube `.vercel/output/` y al final **imprime la URL**
  del deploy. Abrila: es tu app, servida por Vercel.

Esto corre con tu login local; no hizo falta token. En el runner no hay
login, por eso el paso que sigue.

Si el build te dice que la versión de Node del proyecto no coincide, en el
dashboard de Vercel: tu proyecto → **Settings** → **General** → **Node.js
Version**, elegí la 24.

### Paso 4: Token y secrets

Creá un token en https://vercel.com/account/tokens. Nombre `github-actions`,
scope tu cuenta, y ponele vencimiento (90 días está bien: en el módulo 8
vemos rotación). Copialo; se muestra una sola vez.

```bash
gh secret set VERCEL_TOKEN
```

Te queda esperando que pegues el valor y des Enter. Después los dos IDs,
leídos del JSON con Node para no copiarlos a mano:

```bash
gh secret set VERCEL_ORG_ID --body "$(node -p "require('./.vercel/project.json').orgId")"
gh secret set VERCEL_PROJECT_ID --body "$(node -p "require('./.vercel/project.json').projectId")"
gh secret list
```

Los IDs no son secretos de verdad, pero por ahora van como secrets porque
es el único mecanismo que conocés. En el módulo 8 los pasamos a *variables*,
que es su lugar.

### Paso 5: El job de preview

Agregá esta pieza a `.github/workflows/ci.yml`, como un job más, antes de
`ci`.

#### Pieza 1: cabecera del job

```yaml
  preview:
    needs: [lint, typecheck, test, build]
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
```

- `needs`: no se despliega nada que no haya pasado las verificaciones. No
  depende de `docker` porque Vercel no usa la imagen.
- `if: github.event_name == 'pull_request'`: este job es solo para PRs. En
  el push a `main` queda *skipped*.
- `pull-requests: write`: el último step va a comentar en el PR, y el
  `GITHUB_TOKEN` por defecto no puede.
- `env` a nivel job: las tres variables quedan disponibles en todos los
  steps. La CLI de Vercel lee `VERCEL_ORG_ID` y `VERCEL_PROJECT_ID` del
  entorno; es el reemplazo de `.vercel/project.json`, que en el runner no
  existe.

#### Pieza 2: build y deploy

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - name: Instalar Vercel CLI
        run: npm install --global vercel@latest
      - name: Bajar config del proyecto
        run: vercel pull --yes --environment=preview --token="$VERCEL_TOKEN"
      - name: Build
        run: vercel build --token="$VERCEL_TOKEN"
      - name: Deploy
        id: deploy
        run: echo "url=$(vercel deploy --prebuilt --token="$VERCEL_TOKEN")" >> "$GITHUB_OUTPUT"
```

- Son los mismos tres comandos del paso 3, con `--token` porque en el runner
  nadie hizo `vercel login`. Se escribe `"$VERCEL_TOKEN"` (variable de
  shell) y no `${{ secrets.VERCEL_TOKEN }}` adentro del `run`; el porqué
  es parte del módulo 8.
- `id: deploy` + `>> "$GITHUB_OUTPUT"`: es cómo un step le pasa un valor a
  los siguientes. `vercel deploy` imprime la URL por stdout; `$(...)` la
  captura, y escribir `url=...` en el archivo `$GITHUB_OUTPUT` la publica
  como `steps.deploy.outputs.url`.
- `vercel@latest` sin fijar versión es una excepción a la regla de fijar
  todo. La CLI de Vercel cambia seguido y las versiones viejas dejan de
  funcionar contra la plataforma; acá conviene la última.

#### Pieza 3: smoke test y comentario

```yaml
      - name: Smoke test
        env:
          URL: ${{ steps.deploy.outputs.url }}
        run: curl --fail --silent --show-error --retry 5 --retry-delay 3 "$URL/api/health"
      - name: Comentar la URL en el PR
        env:
          GH_TOKEN: ${{ github.token }}
          URL: ${{ steps.deploy.outputs.url }}
          PR: ${{ github.event.pull_request.number }}
        run: gh pr comment "$PR" --body "Preview desplegado en $URL"
```

- `curl --fail`: sale con error si la respuesta no es 2xx. `--retry 5`:
  recién desplegado, Vercel puede tardar unos segundos en servir. Si
  `/api/health` no responde, el job falla y el PR muestra la cruz aunque
  el deploy "haya terminado".
- `gh` viene instalado en los runners. Con `GH_TOKEN` seteado al token del
  run, puede comentar en el PR. Cada push al PR agrega un comentario
  nuevo; hay actions que editan siempre el mismo, pero esta versión es la
  que se entiende leyendo.
- Detalle de YAML: un `run` de una sola línea no puede contener `: `
  (dos puntos y espacio), porque YAML lo lee como otra clave. Por eso el
  mensaje dice "desplegado en" y no "desplegado:". Si necesitás los dos
  puntos, usá `run: |` y el comando en la línea siguiente.

#### Pieza 4: el job de producción

```yaml
  production:
    needs: [lint, typecheck, test, build]
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - name: Instalar Vercel CLI
        run: npm install --global vercel@latest
      - name: Bajar config del proyecto
        run: vercel pull --yes --environment=production --token="$VERCEL_TOKEN"
      - name: Build
        run: vercel build --prod --token="$VERCEL_TOKEN"
      - name: Deploy
        id: deploy
        run: echo "url=$(vercel deploy --prebuilt --prod --token="$VERCEL_TOKEN")" >> "$GITHUB_OUTPUT"
      - name: Smoke test
        env:
          URL: ${{ steps.deploy.outputs.url }}
        run: curl --fail --silent --show-error --retry 5 --retry-delay 3 "$URL/api/health"
```

- Es el espejo de `preview` con tres diferencias: corre en `push` (que por
  tu `on:` solo puede ser a `main`), `--environment=production` en el pull,
  y `--prod` en build y deploy. `--prod` es lo que mueve el dominio
  principal al deploy nuevo.
- Sí, hay mucho duplicado entre los dos jobs. Es a propósito: en el módulo
  11 lo factorizamos, y vas a entender bien qué estás factorizando.

#### La compuerta `ci` no cambia

No sumes `preview` ni `production` a `needs` de `ci`. Pensá por qué: en un
push a `main`, `preview` queda *skipped*, y tu compuerta trata *skipped*
como falla. Por ahora, si un deploy falla, lo ves en el PR como un check
rojo más, pero no bloquea el merge. En el "para pensar" hay más sobre esto.

Validá:

```bash
npx --yes @action-validator/cli .github/workflows/ci.yml
```

### Paso 6: PR, preview, merge, producción

```bash
git add .github/workflows/ci.yml
git commit -m "Deploy a Vercel: preview por PR y producción desde main"
git push -u origin cd/vercel
gh pr create --fill
gh run watch
```

Cuando termine, en el PR tiene que haber un comentario con la URL del
preview. Abrila. Y en el dashboard de Vercel, en **Deployments**, el deploy
aparece marcado como Preview, con el commit y la rama.

Mergeá:

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
gh run watch
```

El run de `main` corre `production` (y `preview` queda skipped). Al
terminar, abrí `https://prueba-ci-cd.vercel.app` (o el dominio que te
muestre Vercel en el proyecto). Es la misma app, pero esta URL se va a
mover con cada merge.

### Paso 7: Rollback

En el dashboard: **Deployments** → el deploy anterior de producción → menú
`⋯` → **Instant Rollback** (o **Promote to Production**). El dominio
principal pasa a apuntar al deploy viejo en segundos, sin build. Volvé a
promover el nuevo cuando termines. Esto es lo que vale tener URLs
inmutables: volver atrás no es un deploy, es cambiar un puntero.

### Paso 8: Romperlo a propósito

En una rama nueva, hacé que `/api/health` explote en runtime: en
`src/app/api/health/route.ts`, agregá como primera línea de `GET`:

```ts
  throw new Error("boom");
```

Commit, push, PR. Lint pasa, typecheck pasa, tests pasan (nadie testea ese
endpoint), build pasa, el deploy a Vercel **termina bien**, y el smoke test
falla con un 500. El job `preview` queda rojo y no hay comentario con la
URL. Sin ese step, el PR estaría verde con una app rota desplegada.

Cerrá el PR sin mergear:

```bash
gh pr close --delete-branch
```

## Consigna

1. Pasos 0 a 8.
2. Avisame con la URL del preview de tu primer PR, la URL de producción, y
   cuánto tardó el job `production` comparado con `docker`.

## Para pensar

- El deploy de preview no bloquea el merge porque no está en la compuerta.
  ¿Debería? ¿Qué pasa si un PR rompe el deploy pero pasa los tests? ¿Cómo
  harías para sumarlo a `ci` sin que el *skipped* del push a `main` la rompa?
  Pista: la condición de la compuerta puede distinguir `skipped` de
  `failure`.
- Si alguien hace un fork de tu repo y abre un PR, ¿el job `preview` tiene
  acceso a `VERCEL_TOKEN`? Buscá "secrets" y "fork" en la doc de GitHub.
- El token de Vercel tiene acceso a toda tu cuenta. Si se filtra, ¿qué
  puede hacer quien lo tenga? ¿Qué harías primero?
- `/api/health` devuelve `version: "dev"` en Vercel, porque `APP_VERSION`
  no está definida. ¿Cómo le harías llegar el SHA del commit? Pista: buscá
  "System Environment Variables" en la doc de Vercel.
