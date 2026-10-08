# Módulo 1: Primer workflow de GitHub Actions

## Conceptos

### Qué es GitHub Actions

Es el sistema de CI/CD integrado a GitHub. Vos dejás archivos YAML dentro de
`.github/workflows/` en tu repo, y GitHub los lee y ejecuta cuando pasa algo
(un push, un pull request, un cron). No hay que instalar ni configurar un
servidor: GitHub pone los runners.

Alternativas que vas a escuchar nombrar: GitLab CI, Jenkins, CircleCI,
Buildkite. Los conceptos son los mismos en todas; cambia la sintaxis.

### Anatomía de un workflow

Un workflow tiene tres niveles:

```
workflow            ← el archivo YAML completo
  └── jobs          ← uno o más; cada job corre en un runner limpio
        └── steps   ← comandos en orden dentro de un job
```

Y tres claves obligatorias en el YAML:

- `name`: cómo se llama el workflow en la pestaña "Actions" de GitHub.
- `on`: qué eventos lo disparan. Ejemplos: `push`, `pull_request`,
  `workflow_dispatch` (botón manual), `schedule` (cron).
- `jobs`: el mapa de jobs. Cada job tiene como mínimo `runs-on` (qué
  runner usa, por ejemplo `ubuntu-latest`) y `steps`.

### Dos tipos de step

Un step puede ser una de dos cosas:

1. **`run`**: un comando de shell, tal cual lo escribirías en tu terminal.
   ```yaml
   - run: npm run lint
   ```
2. **`uses`**: una *action*, que es un paso reutilizable publicado por
   alguien (GitHub, una empresa, o vos). Se referencia como
   `dueño/repo@versión`.
   ```yaml
   - uses: actions/checkout@v4
   ```

### Las dos actions que vas a usar siempre

- **`actions/checkout`**: clona tu repo en el runner. Sin esto el runner
  está vacío; acordate que arranca limpio. Es casi siempre el primer step.
- **`actions/setup-node`**: instala Node en la versión que le pidas. Acepta
  `node-version-file: .nvmrc` para leer la versión del archivo que dejamos
  en el módulo 0. Así hay una sola fuente de verdad para la versión de Node.

### Por qué fijar la versión de una action

`actions/checkout@v4` apunta a la rama/tag `v4`, que el dueño puede mover.
`actions/checkout@main` sería peor: cualquier cambio te rompe el pipeline.
Lo más seguro es fijar el SHA del commit. Por ahora usá `@v4`; en el módulo
10 vemos cómo Dependabot te mantiene esto al día.

### Qué pasa cuando corre

1. Hacés push.
2. GitHub ve que hay un workflow con `on: push` y encola un run.
3. Un runner levanta una VM limpia de Ubuntu.
4. Ejecuta los steps en orden. Si uno falla (sale con código distinto de 0),
   el job se marca como fallido y los steps siguientes no corren.
5. En la pestaña **Actions** del repo ves el run, cada job, cada step, y el
   log completo de cada uno.
6. Al lado del commit aparece un tilde verde o una cruz roja.

## Instrucciones

### Paso 1: Loguearte en GitHub desde la terminal

```bash
gh auth login
```

Elegí: `GitHub.com` → `HTTPS` → `Login with a web browser`. Te da un código,
abrís el navegador, lo pegás.

**Qué hace:** guarda un token en tu máquina para que `gh` y `git` puedan
hablar con GitHub sin pedirte contraseña cada vez.

### Paso 2: Crear el repo en GitHub y subir el código

Desde la carpeta del proyecto:

```bash
gh repo create prueba_ci_cd --public --source=. --remote=origin --push
```

**Qué hace cada flag:**
- `--public`: repo público. Importa porque GitHub Actions es gratis e
  ilimitado en repos públicos; en privados hay una cuota mensual.
- `--source=.`: usa el repo git que ya existe en esta carpeta.
- `--remote=origin`: agrega el repo de GitHub como remote `origin`.
- `--push`: hace el primer push de `main`.

Verificá con `gh repo view --web` que se abra el repo en el navegador.

### Paso 3: Escribir el workflow

Creá el archivo `.github/workflows/ci.yml` (la carpeta también, si no
existe). El nombre `ci.yml` es convención, no obligación; lo que importa es
la carpeta.

El archivo se arma con las piezas de abajo, en ese orden. Andá copiando cada
bloque y leé qué hace antes de pegar el siguiente. Ojo con la indentación:
YAML usa espacios (dos por nivel acá), nunca tabs.

#### Pieza 1: nombre y disparador

```yaml
name: CI

on:
  push:
```

- `name` es el texto que ves en la pestaña Actions y en el tilde al lado
  del commit.
- `on: push:` sin nada más abajo significa "cualquier push a cualquier
  rama". Más adelante lo vamos a restringir (por ejemplo, solo `main`) y a
  sumar `pull_request`; por ahora alcanza con esto.

Si ya le pusiste `pull_request:` también, dejalo: no molesta y en el módulo
3 lo vamos a necesitar. Hasta que abras un PR, no se dispara.

#### Pieza 2: el job y su runner

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
```

- `jobs` es un mapa: cada clave de abajo es un job. `ci` es el nombre que
  elegiste vos; podría ser `lint`, `build`, lo que sea. Aparece como nombre
  del job en la UI.
- `runs-on: ubuntu-latest` pide una VM Ubuntu mantenida por GitHub. Hay
  también `windows-latest` y `macos-latest`, pero Ubuntu es la más rápida y
  barata.
- `steps:` abre la lista de pasos. Todo lo que sigue va indentado seis
  espacios (dentro de `steps`) y cada step empieza con `- `.

#### Pieza 3: clonar el repo

```yaml
      - name: Checkout
        uses: actions/checkout@v4
```

- `name` en un step es opcional; sirve para que el log sea legible. Si no lo
  ponés, GitHub muestra el `uses` o el `run` tal cual.
- `uses: actions/checkout@v4` trae tu código al runner. Sin este step la
  carpeta de trabajo está vacía: no hay `package.json`, no hay nada.

#### Pieza 4: instalar Node

```yaml
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
```

- `with` es cómo se le pasan parámetros a una action. Cada action documenta
  los suyos en su README (los llama *inputs*).
- `node-version-file: .nvmrc` le dice que lea la versión del archivo en vez
  de escribirla a mano acá. Si mañana subís a Node 26, cambiás `.nvmrc` y el
  CI te sigue sin tocar el YAML.

#### Pieza 5: instalar dependencias

```yaml
      - name: Instalar dependencias
        run: npm ci
```

- `run` ejecuta el comando en bash dentro del runner, parado en la raíz del
  repo clonado.
- `npm ci` (de *clean install*) instala exactamente lo que dice
  `package-lock.json`, falla si el lock no coincide con `package.json`, y
  borra `node_modules` antes de empezar. Es lo que querés en CI: lo mismo
  siempre, sin sorpresas. `npm install` en cambio puede actualizar el lock.

#### Pieza 6: correr el lint

```yaml
      - name: Lint
        run: npm run lint
```

- Corre el script `lint` de tu `package.json`, que es `eslint`.
- Si ESLint encuentra un error sale con código 1, el step falla, el job
  falla, y el commit queda con la cruz roja. Ese es todo el mecanismo: cada
  step que termina distinto de 0 frena el job.

#### Cómo tiene que quedar

Cuando pegues las seis piezas, el archivo tiene esta forma (sin los `...`):

```
name: CI
on: ...
jobs:
  ci:
    runs-on: ...
    steps:
      - ...   (checkout)
      - ...   (setup-node)
      - ...   (npm ci)
      - ...   (lint)
```

Antes de hacer commit, validá que el YAML esté bien formado:

```bash
npx --yes yaml-lint .github/workflows/ci.yml
```

Si tira error, casi seguro es indentación. Documentación de referencia:
- https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- https://github.com/actions/setup-node

### Paso 4: Push y mirar el run

```bash
git add .github/workflows/ci.yml
git commit -m "Módulo 1: workflow de CI con lint"
git push
```

Después:

```bash
gh run list          # lista los runs
gh run watch         # sigue el último run en vivo
```

O desde el navegador: pestaña **Actions** del repo.

**Qué mirar:** entrá al run, al job, y desplegá cada step. Fijate cuánto
tarda cada uno. Vas a ver que `npm ci` es lo más lento; eso lo arreglamos en
el módulo 4.

### Paso 5: Romperlo a propósito

Esto es la parte más importante del módulo. Un pipeline que nunca viste
fallar no sabés si funciona.

Meté un error de lint en `src/lib/todos.ts`. Por ejemplo, declarar una
variable que no se usa:

```ts
const sinUsar = 42;
```

Commit, push, mirá el run. Tiene que salir rojo. Entrá al step que falló y
leé el error en el log: tiene que ser el mismo que te daría `npm run lint`
localmente.

Después revertí el cambio (sacá la línea, o `git revert`), push, y
comprobá que vuelve a verde.

## Consigna

1. Hacé los pasos 1 a 5.
2. Cuando esté verde de nuevo, avisame. Voy a mirar tu `ci.yml` y los runs
   en GitHub y te comento.

Si algo no te cierra de alguna pieza, preguntame antes de seguir.

## Para pensar mientras esperás el run

- ¿Por qué `npm ci` y no `npm install`? Pista: mirá qué hace cada uno con
  `package-lock.json`.
- Si el lint pasa en CI pero vos no lo corriste localmente, ¿el código está
  bien? ¿Qué cubre el lint y qué no?
