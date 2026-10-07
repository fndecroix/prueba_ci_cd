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
  mismas versiones de dependencias que vos.

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
