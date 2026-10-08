# Módulo 3: Pull requests y protección de rama

Prerequisito: el módulo 2 terminado, con lint, typecheck, tests y build en
verde.

## Conceptos

### El problema de pushear a main

Hasta ahora pusheás directo a `main` y el CI corre *después*. Si rompiste
algo, ya está en `main`; el tilde rojo te avisa, pero el daño está hecho.
Para que el CI sirva de barrera y no solo de alarma, el cambio tiene que
pasar por un lugar donde se pueda frenar: el pull request.

### Flujo con pull requests

1. Creás una rama a partir de `main` (`feature/lo-que-sea`).
2. Commiteás ahí y pusheás la rama.
3. Abrís un PR: "quiero meter estos commits en `main`".
4. El CI corre sobre el PR. GitHub muestra el resultado en el PR mismo.
5. Si está verde (y alguien lo aprobó, si el equipo lo pide), se mergea.
6. Se borra la rama.

`main` siempre queda en un estado que pasó el CI. Eso es lo que hace
posible, más adelante, deployar automáticamente desde `main`.

### Eventos `push` y `pull_request`

Tu workflow ya tiene los dos. Diferencias:

- `push` corre cuando llegan commits a una rama. Con `push:` sin filtros,
  corre en *todas* las ramas.
- `pull_request` corre cuando se abre un PR o llegan commits a su rama. El
  runner no clona tu rama tal cual: clona un *merge commit* temporal de tu
  rama sobre `main`. Es decir, testea cómo quedaría `main` después del
  merge, que es lo que de verdad importa.

Con los dos sin filtro, cada push a una rama con PR abierto dispara dos
runs iguales. Lo arreglás restringiendo `push` a `main`: en las ramas de
trabajo corre solo el de `pull_request`, y en `main` corre el de `push`
después de mergear.

### Status checks y branch protection

Un *status check* es el resultado de un job (verde o rojo) asociado a un
commit. GitHub los lista abajo del PR.

*Branch protection* (hoy GitHub lo llama *rulesets*) es una regla sobre una
rama: "no se puede mergear a `main` si el check `ci` no está en verde", o
"nadie puede pushear directo a `main`". Con eso el botón de merge se
deshabilita hasta que el CI pase. Sin eso, el CI es una sugerencia.

Importante: el nombre del check es el **nombre del job**, no el del
workflow. En tu YAML el job se llama `ci`, así que ese es el check a exigir.

### Concurrency

Si pusheás tres veces seguidas a la misma rama, se encolan tres runs; los
dos primeros ya no sirven. `concurrency` con `cancel-in-progress: true`
cancela el run anterior cuando llega uno nuevo del mismo grupo. Es una
línea y ahorra minutos de runner.

## Instrucciones

### Paso 1: Ajustar los triggers del workflow

En `.github/workflows/ci.yml`, reemplazá el bloque `on:` por:

```yaml
on:
  push:
    branches: [main]
  pull_request:
```

- `push` ahora solo corre en `main` (o sea, después de un merge).
- `pull_request` sin filtro corre en cualquier PR, apunte a la rama que
  apunte.

Agregá debajo, al mismo nivel que `on:` y `jobs:`:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- `${{ ... }}` es la sintaxis de expresiones de Actions. `github.workflow`
  es el nombre del workflow ("CI") y `github.ref` es la rama o el PR
  (`refs/heads/main`, `refs/pull/3/merge`). Juntos forman un grupo distinto
  por rama, así un push a tu rama no cancela el run de `main`.
- `cancel-in-progress: true`: si hay un run del mismo grupo corriendo, lo
  cancela.

Este cambio lo vas a mandar en tu primer PR. No lo pushees a `main`.

### Paso 2: Crear una rama y abrir el PR

```bash
git checkout -b ci/triggers-y-concurrency
git add .github/workflows/ci.yml
git commit -m "CI: push solo en main, concurrency por rama"
git push -u origin ci/triggers-y-concurrency
```

- `-b` crea la rama y se para en ella.
- `-u origin <rama>` crea la rama en GitHub y la vincula con la local; los
  próximos `git push` no necesitan argumentos.

Abrí el PR:

```bash
gh pr create --fill
```

- `--fill` usa el mensaje del commit como título y descripción. Sin el flag
  te los pide interactivamente.

Mirá el PR en el navegador con `gh pr view --web`. Abajo de todo tiene que
aparecer el check `ci` corriendo. Fijate en el run: el evento dice
`pull_request`, no `push`.

### Paso 3: Proteger `main`

Esto se hace en la web. Andá a **Settings → Rules → Rulesets → New ruleset
→ New branch ruleset** y configurá:

- **Ruleset name:** `main`.
- **Enforcement status:** Active.
- **Target branches:** Add target → Include default branch.
- En **Rules**, tildá:
  - **Require a pull request before merging.** Dejá *Required approvals*
    en 0 (sos vos solo; en un equipo sería 1 o más).
  - **Require status checks to pass.** Tildá también *Require branches to
    be up to date before merging*. Abajo, en *Add checks*, buscá `ci` y
    agregalo. Si no aparece, es porque todavía no corrió ningún run con ese
    job en un PR; esperá a que termine el del paso 2 y recargá.
- Guardá con **Create**.

**Qué acabás de hacer:** nadie (ni vos) puede pushear directo a `main`, y
ningún PR se puede mergear con el check `ci` en rojo o pendiente.

Comprobalo:

```bash
git checkout main
git commit --allow-empty -m "prueba de push directo"
git push
```

Tiene que fallar con un error que menciona la regla. Borrá ese commit local
con `git reset --hard origin/main` y volvé a tu rama con
`git checkout ci/triggers-y-concurrency`.

### Paso 4: Mergear el PR

Con el check en verde:

```bash
gh pr merge --squash --delete-branch
```

- `--squash` junta todos los commits del PR en uno solo sobre `main`. Es la
  opción más común: el historial de `main` queda con un commit por PR.
  Las alternativas son `--merge` (commit de merge, conserva todo) y
  `--rebase` (reaplica los commits uno por uno).
- `--delete-branch` borra la rama remota y la local, y te deja parado en
  `main` actualizado.

Mirá `gh run list`: tiene que haber un run nuevo con evento `push` en
`main`, disparado por el merge.

### Paso 5: Ver la barrera en acción

Ahora un PR que falla. Rama nueva, bug a propósito en `countPending` (el
mismo del módulo 2), commit, push, PR:

```bash
git checkout -b bug/count-pending
# editá src/lib/todos.ts: filter((t) => t.done)
git commit -am "Bug a propósito"
git push -u origin bug/count-pending
gh pr create --fill
```

Esperá el run y mirá el PR en la web: el botón de merge está gris y dice
que faltan checks. Probá igual desde la terminal:

```bash
gh pr merge --squash
```

Tiene que negarse.

Ahora arreglalo en la misma rama (revertí el cambio), commit, push. No hace
falta abrir otro PR: el PR sigue a la rama, y cada push dispara un run
nuevo. Fijate que el run anterior, si todavía estaba corriendo, aparece
como *cancelled*: eso es `concurrency`.

Cuando esté verde, mergeá con `--squash --delete-branch`.

## Consigna

1. Pasos 1 a 5. Al final tenés que tener dos PRs mergeados y `main`
   protegida.
2. Avisame. Voy a mirar los PRs, los runs (incluido el cancelado) y la
   configuración del ruleset.

## Para pensar

- `pull_request` testea el merge de tu rama sobre `main`. Si mientras tu
  PR está abierto alguien mergea otro PR a `main`, ¿tu check verde sigue
  siendo válido? ¿Qué hace la opción *Require branches to be up to date*?
- Con squash, los commits intermedios de la rama desaparecen de `main`.
  ¿Qué ganás y qué perdés?
