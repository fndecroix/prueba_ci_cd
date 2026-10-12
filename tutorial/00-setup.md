# Módulo 0: Setup y conceptos

## Qué es CI/CD

**CI (Integración Continua)** es la práctica de integrar el código de todo el
equipo en una rama principal de forma frecuente, y verificar automáticamente
cada integración. "Verificar" quiere decir compilar, correr linters, correr
tests. La idea es que un error se detecte minutos después de introducirlo, no
semanas después cuando ya nadie recuerda qué cambió.

**CD** tiene dos lecturas que conviene distinguir:

- **Entrega Continua (Continuous Delivery):** cada cambio que pasa CI queda
  *listo para desplegar* con un click. Alguien decide cuándo.
- **Despliegue Continuo (Continuous Deployment):** cada cambio que pasa CI se
  despliega solo, sin intervención humana.

La diferencia es un paso manual. En este tutorial vamos a hacer las dos.

## Vocabulario

- **Pipeline:** la secuencia de pasos automáticos que corre sobre un cambio.
  Por ejemplo: instalar dependencias → lint → tests → build → deploy.
- **Workflow:** en GitHub Actions, un archivo YAML que define un pipeline.
- **Job:** un grupo de pasos que corre en una misma máquina. Un workflow
  puede tener varios jobs, en paralelo o en secuencia.
- **Step:** un comando individual dentro de un job.
- **Runner:** la máquina (virtual) donde corre un job. GitHub provee runners
  con Linux, Windows y macOS. Cada job arranca en un runner limpio.
- **Trigger / evento:** qué dispara el workflow: un push, un pull request,
  un cron, un click manual.
- **Artefacto:** algo que produce el pipeline y se guarda: un build, una
  imagen Docker, un reporte de tests.

## Por qué importa que cada runner arranque limpio

Esto es lo que más cuesta internalizar al principio. En tu máquina tenés Node
instalado, `node_modules` ya bajados, variables de entorno configuradas.
El runner no tiene nada de eso. Todo lo que tu pipeline necesita tiene que
estar declarado explícitamente: la versión de Node, las dependencias, los
secretos. Si funciona en CI, funciona en cualquier lado. Esa es la gracia.

Por eso en este módulo dejamos:

- `.nvmrc` con la versión de Node. CI va a leer este archivo para usar la
  misma versión que vos.
- `package-lock.json` versionado. Garantiza que CI instale exactamente las
  mismas versiones de dependencias que vos (cómo, en el módulo 1).

### Qué es `.nvmrc` y cómo funciona

Es un archivo de texto con una sola línea: la versión de Node del proyecto.
En este repo dice `24`. No hace nada por sí mismo: no se ejecuta, no instala
nada. Es una **nota** en un lugar con nombre conocido, para que los
programas que la buscan la encuentren.

Quién lo lee:

- **`nvm`**, el gestor con el que instalaste Node. Puede tener varias
  versiones instaladas y elegir cuál está activa en tu terminal. `nvm use 22`
  activa la 22; `nvm use` sin número busca `.nvmrc` en la carpeta actual,
  lee el número y activa esa versión. Probalo:
  ```bash
  nvm use        # "Found .nvmrc with version <24>  Now using node v24.x"
  cd /tmp && nvm use   # "No .nvmrc file found"
  ```
- **`actions/setup-node`** en el CI (módulo 1). El runner no tiene `nvm`,
  pero esa action entiende el mismo archivo si le pasás
  `node-version-file: .nvmrc`: lo abre, lee el número e instala esa versión.
  Es lo mismo que hace `nvm use`, hecho por otro programa en otra máquina.

El problema que resuelve: vos tenés Node 24, un compañero tiene Node 20 de
hace dos años, el runner instala lo que le digas. Con tres versiones
distintas, el mismo código puede andar en una máquina y romperse en otra.
Con `.nvmrc` la versión viaja con el código, en **un solo lugar**. La
alternativa, escribir `node-version: 24` en el YAML, funciona igual pero
duplica el dato; el día que actualizás uno y te olvidás del otro, local y
CI corren Node distinto sin que nadie se entere.

**Es una convención, no un control.** Si un dev nunca corre `nvm use`,
sigue con su versión y nadie lo nota. Tres respuestas a eso, de más blanda
a más dura:

1. Automatizarlo: el README de nvm trae un hook de shell que corre
   `nvm use` solo al entrar a una carpeta con `.nvmrc`. Herramientas más
   nuevas como `fnm` o `volta` lo hacen de fábrica.
2. Que el proyecto se niegue a correr con otra versión. En `package.json`
   se declara `"engines": { "node": ">=24 <25" }`, y con un archivo
   `.npmrc` en la raíz que diga `engine-strict=true`, `npm install` falla
   con un error claro si la versión no cumple. Lo podés agregar cuando
   quieras, en un PR aparte.
3. El CI como red final: aunque un dev tenga Node 20 y le pase todo en su
   máquina, el PR corre en el runner con la versión del `.nvmrc`. Si algo
   depende de la versión, el check sale rojo. La idea de CI es justamente
   que el lugar donde se decide si el código está bien no sea la máquina
   de nadie.

## La app

Una lista de tareas mínima:

- `src/lib/todos.ts`: funciones puras para agregar, marcar, eliminar y contar
  tareas. Sin React, sin estado. Fáciles de testear (módulo 2).
- `src/components/TodoList.tsx`: el componente que usa esas funciones.
- `src/app/api/health/route.ts`: un endpoint `GET /api/health` que devuelve
  estado y versión. Lo vamos a usar en los módulos de deploy para verificar
  que lo que subimos es lo que esperábamos.

## Comandos que CI va a correr

```bash
npm ci            # instala exactamente lo que dice el lockfile
npm run lint      # ESLint
npx tsc --noEmit  # chequeo de tipos sin generar archivos
npm run build     # build de producción
```

Probalos localmente. Si alguno falla acá, va a fallar en CI.

## Para correr la app

```bash
npm run dev       # desarrollo, en http://localhost:3000
npm run build && npm run start   # como en producción
```
