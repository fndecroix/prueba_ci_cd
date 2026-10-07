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

Creá el archivo `.github/workflows/ci.yml`. El nombre `ci.yml` es
convención, no obligación; lo que importa es la carpeta.

Esto es lo que tiene que hacer (consigna más abajo). Las piezas:

- Se dispara en cada push a cualquier rama.
- Un solo job, en `ubuntu-latest`.
- Steps, en este orden:
  1. Clonar el repo.
  2. Instalar Node leyendo la versión de `.nvmrc`.
  3. Instalar dependencias con `npm ci`.
  4. Correr el lint.

Documentación de referencia, si querés mirar la sintaxis exacta:
- https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- https://github.com/actions/setup-node (fijate el input `node-version-file`)

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

Si te trabás en algo, pedime una pista. Te doy la pieza que falta, no el
archivo entero.

## Para pensar mientras esperás el run

- ¿Por qué `npm ci` y no `npm install`? Pista: mirá qué hace cada uno con
  `package-lock.json`.
- Si el lint pasa en CI pero vos no lo corriste localmente, ¿el código está
  bien? ¿Qué cubre el lint y qué no?
