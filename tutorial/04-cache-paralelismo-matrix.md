# Módulo 4: Cache, jobs en paralelo y matrix

## Conceptos

### Dónde se va el tiempo

Abrí cualquier run verde del módulo 3 y mirá la duración por step. Sale
algo así:

```
Checkout                 ~2s
Setup Node               ~3s
Instalar dependencias   ~15s   ← npm ci
Lint                     ~3s
Typecheck                ~5s
Tests                    ~4s
Build                   ~15s
```

Casi la mitad es `npm ci` bajando de internet los mismos paquetes que bajó
en el run anterior. El runner arranca limpio en cada run, así que no
recuerda nada. La respuesta es el **cache**.

### Qué se cachea y qué no

`actions/setup-node` tiene un input `cache: npm` que guarda la carpeta de
cache de npm (`~/.npm`, los tarballs ya descargados) entre runs. Clave del
cache: el hash de `package-lock.json`. Si el lock no cambió, restaura la
carpeta y `npm ci` se vuelve mucho más rápido porque no descarga nada; solo
descomprime.

Lo que **no** se cachea es `node_modules`. Eso es a propósito: `npm ci`
borra `node_modules` al arrancar, así que cachearlo sería inútil, y además
cachear `node_modules` entre versiones distintas de Node trae errores raros.
Cacheás lo que es insumo (tarballs), no lo que es resultado (la instalación).

Límites: 10 GB por repo, y las entradas que no se usan en 7 días se borran.
Para este proyecto sobra.

### Un job o varios

Hasta ahora todo corre en un solo job, en serie. Lint, typecheck, tests y
build son independientes entre sí: ninguno necesita el resultado del otro.
Si los separás en jobs distintos, corren **en paralelo** en cuatro runners
distintos, y el run tarda lo que tarde el más lento, no la suma.

El costo: cada job arranca limpio, así que cada uno repite checkout,
setup-node y `npm ci`. Con cache eso es barato. Pero fijate que ahora el
workflow *consume* más minutos de runner en total (cuatro `npm ci` en vez
de uno), aunque *termine* antes. En repos públicos da igual; en privados,
con cuota, es un trade-off real.

Otra ventaja de separar: cuando algo falla, ves de un vistazo *qué* falló,
sin abrir el log. Y los otros jobs igual terminan, así que si fallan lint y
tests a la vez te enterás de ambos en un solo run.

### `needs`: dependencias entre jobs

Por defecto todos los jobs arrancan juntos. `needs: [a, b]` hace que un job
espere a que `a` y `b` terminen, y si alguno falla, el job se saltea
(`skipped`). Sirve para encadenar: "deployar solo si pasó todo".

Hay una sutileza: con `needs`, un job que depende de otro que falló no
corre. A veces querés que corra *igual* para hacer algo con el resultado.
Para eso está `if: always()`.

### El problema del check requerido

Tu ruleset exige que pase el check `ci`. Ese nombre es el del job. Si
partís el workflow en `lint`, `typecheck`, `test` y `build`, el check `ci`
deja de existir y GitHub bloquea todos los PRs para siempre ("expected,
waiting for status to be reported").

Podrías editar el ruleset para que exija los cuatro, pero cada vez que
agregues un job tendrías que volver a tocarlo, y es fácil olvidarse. El
patrón habitual es un **job de compuerta** (*gate*): un job `ci` que hace
`needs` de todos los demás, corre siempre, y falla si alguno falló. El
ruleset sigue exigiendo `ci`, y vos agregás jobs sin tocar la configuración
del repo.

### Matrix

`strategy.matrix` genera copias de un mismo job con variables distintas.
El uso clásico: correr los tests en varias versiones de Node, o en varios
sistemas operativos. Cada combinación es un job separado y corre en
paralelo. `fail-fast: false` evita que, cuando una combinación falla,
GitHub cancele las otras; en general querés ver el resultado completo.

Para esta app no hace falta soportar dos versiones de Node, pero lo vas a
ver en cualquier librería, así que vale la pena hacerlo una vez.

### `timeout-minutes`

Si un job se cuelga (un test que espera algo que nunca llega, un proceso
que no termina), el default de GitHub es matarlo a las **6 horas**. En
repos privados eso son 360 minutos de cuota tirados. Ponerle un timeout
razonable a cada job es gratis y te ahorra un susto.

## Instrucciones

Todo este módulo va en una rama y un PR, como en el módulo 3. Arrancá desde
`main` actualizado:

```bash
git checkout main
git pull
git checkout -b ci/cache-y-jobs-paralelos
```

### Paso 1: Activar el cache (y medir)

En `.github/workflows/ci.yml`, en el step de Setup Node, agregá `cache: npm`
debajo de `node-version-file`:

```yaml
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
```

- `cache: npm` activa el cache de la carpeta `~/.npm`. La action calcula la
  clave con el hash de `package-lock.json`; si el lock cambia, la clave
  cambia y se arma un cache nuevo.

Commit, push, PR:

```bash
git add .github/workflows/ci.yml
git commit -m "CI: cache de npm"
git push -u origin ci/cache-y-jobs-paralelos
gh pr create --fill
```

**Qué mirar:** el primer run con cache es igual de lento o un poco más (tiene
que *guardar* el cache al final; buscá en el log de Setup Node la línea
"Cache saved" o "Cache not found"). Para ver la mejora necesitás un segundo
run. Hacé un commit vacío y push:

```bash
git commit --allow-empty -m "Segundo run para ver el cache"
git push
```

En este segundo run, Setup Node tiene que decir "Cache restored from key" y
`npm ci` tiene que bajar a unos pocos segundos. Anotá los tiempos de los dos
runs; en el "para pensar" te los pido.

### Paso 2: Separar en jobs paralelos

Ahora reemplazá **todo** el bloque `jobs:` del archivo por las piezas de
abajo. El `name`, `on` y `concurrency` quedan como están.

Para que el archivo no sea eterno, en los steps vamos a omitir el `name` y
dejar solo `uses`/`run`: GitHub muestra el comando en la UI, que alcanza.

#### Pieza 1: lint

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
```

- `timeout-minutes: 10`: si el job pasa de 10 minutos, GitHub lo mata y lo
  marca como fallido. Hoy tarda menos de uno; el margen es para que no
  salte por un día lento, no para esperar.
- El resto es lo mismo que tenías, recortado a lo que este job necesita.

#### Pieza 2: typecheck

```yaml

  typecheck:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run typecheck
```

- Idéntico a `lint` salvo el último comando. Sí, es repetitivo: Actions no
  soporta anclas de YAML (`&x`/`*x`), así que no hay forma de factorizar
  esto dentro del archivo. En el módulo 11 lo resolvemos con una *composite
  action*. Por ahora, copiar y pegar es la forma correcta.

#### Pieza 3: test, con matrix

```yaml

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]
    name: test (node ${{ matrix.node }})
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: npm
      - run: npm ci
      - run: npm test
```

- `strategy.matrix.node: [22, 24]` genera dos jobs, uno por valor. `node` es
  un nombre que elegís vos; podrías tener también `os: [ubuntu-latest,
  windows-latest]` y tendrías cuatro combinaciones.
- `fail-fast: false`: si falla en Node 22, igual dejá terminar el de 24.
- `name: test (node ${{ matrix.node }})` le pone nombre a cada copia. Sin
  esto GitHub muestra `test (22)` y `test (24)`, que también sirve.
- `node-version: ${{ matrix.node }}` reemplaza a `node-version-file`,
  porque acá la versión viene de la matrix, no del `.nvmrc`.

#### Pieza 4: build

```yaml

  build:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run build
```

#### Pieza 5: la compuerta `ci`

```yaml

  ci:
    needs: [lint, typecheck, test, build]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - name: Algún job falló
        if: contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled') || contains(needs.*.result, 'skipped')
        run: exit 1
      - name: Todo verde
        run: echo "ok"
```

- El job se llama `ci` a propósito: es el nombre que exige tu ruleset.
- `needs: [lint, typecheck, test, build]`: espera a los cuatro. Para `test`,
  que es una matrix, espera a todas las combinaciones.
- `if: always()` a nivel job: corré aunque alguno de los `needs` haya
  fallado. Sin esto, si `lint` falla, `ci` queda `skipped`, y un check
  skipped **no bloquea** el merge en GitHub. Ese sería un agujero grave.
- `needs.*.result` es la lista de resultados de los jobs esperados
  (`success`, `failure`, `cancelled`, `skipped`). `contains(lista, valor)`
  es una función de expresiones de Actions. Si aparece cualquiera de los tres
  estados malos, el primer step corre `exit 1` y el job falla. Si no, el
  primer step se saltea y el segundo imprime "ok".
- Este job no hace checkout ni instala nada: tarda unos segundos.

#### Cómo tiene que quedar

```
name: CI
on: ...
concurrency: ...
jobs:
  lint: ...
  typecheck: ...
  test: ...        (con strategy.matrix)
  build: ...
  ci: ...          (needs de los cuatro, if: always())
```

Validá el esquema de Actions, no solo el YAML. Este validador conoce las
claves válidas de un workflow y atrapa cosas como el `concurrency` mal
indentado del módulo 3:

```bash
npx --yes @action-validator/cli .github/workflows/ci.yml
```

Si no imprime nada, está bien.

### Paso 3: Push y mirar el grafo

```bash
git add .github/workflows/ci.yml
git commit -m "CI: jobs en paralelo, matrix de Node y compuerta"
git push
```

Abrí el run en la web. Ahora en vez de un job ves un grafo: `lint`,
`typecheck`, `test (node 22)`, `test (node 24)` y `build` a la izquierda,
todos corriendo a la vez, y `ci` a la derecha esperándolos. Anotá cuánto
tardó el run completo comparado con el del paso 1.

En el PR, en el bloque de checks, tienen que aparecer los seis. Solo `ci`
tiene la etiqueta "Required".

### Paso 4: Romperlo a propósito

Metele un bug a `countPending` como en el módulo 2 (`filter((t) =>
t.done)`), commit, push. Mirá:

1. `test (node 22)` y `test (node 24)` fallan los dos. `lint`, `typecheck` y
   `build` pasan.
2. `ci` corre igual (por `if: always()`) y falla en el step "Algún job
   falló".
3. El PR queda bloqueado por `ci`, no por los jobs de test.

Después arreglá el bug, push, y mergeá el PR cuando esté verde:

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull
```

## Consigna

1. Pasos 1 a 4.
2. Avisame con los tres tiempos: run sin cache (módulo 3), run con cache (paso
   1, segundo run), run en paralelo (paso 3).

## Para pensar

- El run en paralelo terminó antes, pero sumá los tiempos de todos los jobs.
  ¿Cuántos minutos de runner consumió comparado con el run en serie? Si
  este fuera un repo privado con 2.000 minutos por mes, ¿cuál convendría?
- Si mañana agregás un job `e2e` y te olvidás de sumarlo a `needs` de `ci`,
  ¿qué pasa cuando `e2e` falla? ¿Cómo lo detectarías?
- `cache: npm` cachea los tarballs. ¿Qué pasa si cambiás `package-lock.json`
  en una rama y abrís el PR? ¿Y después, cuando mergeás a `main`? Pista: la
  clave del cache depende del hash del lock, no de la rama, pero el alcance
  del cache sí depende de la rama. Leé "Restrictions for accessing a cache"
  en https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows
