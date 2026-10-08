# Módulo 5: Docker multi-stage y push a GHCR

## Conceptos

### Qué resuelve Docker en un pipeline

Hasta acá el CI verifica el código, pero no produce nada que se pueda
*desplegar*. El `npm run build` genera `.next/` en el runner y se pierde
cuando el runner muere.

Una **imagen de Docker** es el artefacto de deploy más común hoy: un
paquete inmutable con el sistema operativo mínimo, Node, tu código
compilado y el comando para arrancar. La misma imagen corre igual en tu
máquina, en un servidor, o en un cluster. Cuando en los módulos 7 y 12
despleguemos, lo que vamos a mover es esta imagen, no el código.

### Dockerfile: capas y cache

Un Dockerfile es una lista de instrucciones; cada una genera una **capa**.
Docker cachea las capas: si una instrucción y todo lo anterior no
cambiaron, la reutiliza. Por eso el orden importa: lo que cambia poco
(instalar dependencias) va antes de lo que cambia siempre (tu código). Si
copiás todo el código y después hacés `npm ci`, cualquier cambio en un `.ts`
invalida la instalación entera.

### Multi-stage

Para *construir* la app necesitás `node_modules` completo (TypeScript,
ESLint, Vitest, Next con todo el compilador): cientos de MB. Para *correrla*
necesitás mucho menos. Un Dockerfile **multi-stage** tiene varios `FROM`:
cada uno abre una etapa nueva, y con `COPY --from=etapa` te traés solo lo
que querés de una etapa anterior. La imagen final es la última etapa; las
anteriores se descartan.

Acá usamos tres etapas:

1. `deps`: instala dependencias. Solo necesita `package.json` y el lock, así
   que su capa sobrevive a cambios en el código.
2. `builder`: copia `node_modules` de `deps`, copia el código, corre
   `next build`.
3. `runner`: imagen final. Solo Node, el output de Next y un usuario sin
   privilegios.

### Next.js `standalone`

Por defecto `next build` deja `.next/` pero asume que `node_modules` está al
lado para correr `next start`. Con `output: "standalone"` en la config, Next
genera `.next/standalone/` con un `server.js` y **solo** las dependencias
que de verdad usa en runtime, ya copiadas adentro. Eso es lo que hace
posible que la imagen final no lleve `node_modules`. Es la forma oficial de
dockerizar Next.

### Registry y GHCR

Un **registry** es un servidor donde subís imágenes (`docker push`) y de
donde las bajás (`docker pull`). Docker Hub es el más conocido; **GHCR**
(GitHub Container Registry, `ghcr.io`) es el de GitHub. Lo usamos porque
está al lado del repo, se autentica con el token que Actions ya tiene, y es
gratis para imágenes públicas.

El nombre completo de una imagen es `registry/dueño/nombre:tag`. Para vos:
`ghcr.io/fndecroix/prueba_ci_cd:main`.

### Tags

Un **tag** es una etiqueta mutable que apunta a una imagen. `latest` es la
convención para "la última", pero es peligrosa en deploy porque hoy apunta a
una cosa y mañana a otra. La práctica sana es taggear también con algo
inmutable, típicamente el SHA del commit (`sha-6db7822`), y deployar *eso*.
Así siempre sabés exactamente qué código corre y podés volver atrás.

### `GITHUB_TOKEN` y `permissions`

Cada run recibe un token automático, `secrets.GITHUB_TOKEN`, que sirve para
hablar con la API de GitHub en nombre del workflow. Qué puede hacer lo
define el bloque `permissions`. Por defecto es bastante restringido; para
subir a GHCR hay que pedir `packages: write` explícitamente. Regla: pedir lo
mínimo, por job. Esto lo profundizamos en el módulo 8.

## Instrucciones

Rama nueva desde `main`:

```bash
git checkout main
git pull
git checkout -b ci/docker-y-ghcr
```

### Paso 1: Activar `standalone`

En `next.config.ts`, agregá `output: "standalone"` dentro del objeto:

```ts
const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
};
```

Corré `npm run build` y mirá que aparezca `.next/standalone/server.js`.

### Paso 2: `.dockerignore`

Creá `.dockerignore` en la raíz:

```
node_modules
.next
.git
.github
tutorial
coverage
*.md
.env*
```

- Cuando corrés `docker build .`, Docker le manda a su motor **todo** el
  directorio (el *build context*) antes de ejecutar nada. Sin este archivo
  le manda tu `node_modules` local (cientos de MB) y tu `.next`, y encima
  el `COPY . .` los metería en la imagen, pisando lo que instaló `deps`.
- `.git` y `tutorial` no sirven dentro de la imagen. `.env*`: nunca metas
  secretos en una imagen; cualquiera que la baje los puede leer.

### Paso 3: Dockerfile

Creá `Dockerfile` (sin extensión) en la raíz, con las piezas en orden.

#### Pieza 1: etapa `deps`

```dockerfile
# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
```

- `# syntax=...`: le dice a Docker qué versión del parser usar. Es la
  primera línea siempre.
- `FROM node:24-alpine AS deps`: imagen base oficial de Node 24 sobre
  Alpine Linux, que es chiquita (~50 MB contra ~400 de la versión Debian).
  `AS deps` le pone nombre a la etapa.
- `WORKDIR /app`: crea y entra al directorio. Todo lo que sigue es relativo
  a él.
- `COPY package.json package-lock.json ./`: solo los dos archivos de
  dependencias. Mientras no cambien, Docker reutiliza la capa del `npm ci`
  siguiente.

#### Pieza 2: etapa `builder`

```dockerfile

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
```

- `COPY --from=deps`: trae `node_modules` de la etapa anterior sin volver a
  instalar.
- `COPY . .`: ahora sí todo el código (menos lo del `.dockerignore`).
- `NEXT_TELEMETRY_DISABLED=1`: Next manda estadísticas anónimas por
  defecto; en CI no tiene sentido.
- `RUN npm run build`: genera `.next/standalone` y `.next/static`.

#### Pieza 3: etapa `runner`

```dockerfile

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

- Arranca de nuevo desde `node:24-alpine` limpio: nada de `node_modules`
  de desarrollo.
- `addgroup`/`adduser`: crea un usuario sin privilegios. Correr como `root`
  dentro del contenedor es un riesgo innecesario; con `USER nextjs` el
  proceso corre como ese usuario.
- Los tres `COPY --from=builder` traen lo mínimo: `public/` (archivos
  estáticos tuyos), `standalone/` (el servidor y sus dependencias) y
  `static/` (JS y CSS compilados, que `standalone` no incluye por diseño).
  `--chown` les pone dueño para que el usuario pueda leerlos.
- `EXPOSE 3000` es documentación: no abre nada, le avisa a quien use la
  imagen qué puerto escucha. `HOSTNAME=0.0.0.0` hace que escuche en todas
  las interfaces; sin esto escucha en `localhost` *del contenedor* y desde
  afuera no llegás.
- `CMD ["node", "server.js"]`: el comando al arrancar. Formato lista, no
  string, para que Node sea el proceso principal y reciba las señales
  (Ctrl+C, `docker stop`) directamente.

### Paso 4: Probar local

```bash
docker build -t prueba-ci-cd:local .
docker image ls prueba-ci-cd:local
docker run --rm -p 3000:3000 prueba-ci-cd:local
```

Abrí http://localhost:3000. Tiene que verse la app. `Ctrl+C` para parar.

**Qué mirar:** el tamaño de la imagen (`docker image ls`): tiene que andar
cerca de 200 MB. Para comparar, lo que pesa `node_modules` local:
`du -sh node_modules`. Esa diferencia es el multi-stage.

Corré el build una segunda vez sin cambiar nada: tiene que terminar en
segundos, con `CACHED` en cada capa. Después tocá algo en `src/`, build de
nuevo: `npm ci` sigue `CACHED`, solo `COPY . .` y el build se rehacen.

### Paso 5: El job `docker` en el workflow

En `ci.yml`, agregá este job **antes** de `ci` (el orden en el archivo no
importa para la ejecución, pero conviene leerlo en orden).

#### Pieza 1: cabecera y permisos

```yaml

  docker:
    needs: [lint, typecheck, test, build]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      packages: write
```

- `needs` de los cuatro: no tiene sentido publicar una imagen de código que
  no pasó los tests. En un PR el job igual corre (para verificar que el
  Dockerfile funciona), pero no publica; eso lo decide un `if` más abajo.
- `permissions`: `contents: read` para el checkout, `packages: write` para
  subir a GHCR. Al declarar `permissions` en un job, todo lo que no
  nombrás queda en `none`.

#### Pieza 2: checkout y buildx

```yaml
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
```

- **Buildx** es el builder moderno de Docker. Lo necesitamos por el cache
  de capas remoto que viene más abajo.

#### Pieza 3: login

```yaml
      - name: Login a GHCR
        if: github.event_name != 'pull_request'
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
```

- `if: github.event_name != 'pull_request'`: en PRs no hacemos push, así
  que no hace falta loguearse. Además, un PR desde un fork no tiene permiso
  de escritura y el login fallaría.
- `github.actor` es el usuario que disparó el run. El password es el token
  automático del run; no hay que crear nada.

#### Pieza 4: tags y labels

```yaml
      - name: Tags y labels
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=sha
            type=raw,value=latest,enable={{is_default_branch}}
```

- `id: meta` le pone nombre al step para poder leer sus *outputs* en el
  step siguiente (`steps.meta.outputs.tags`).
- `images`: el nombre base. `github.repository` es `fndecroix/prueba_ci_cd`.
- `tags` es una lista de reglas, una por línea (el `|` abre un string
  multilínea en YAML):
  - `type=ref,event=branch`: en un push a rama, tag con el nombre de la rama
    → `main`.
  - `type=ref,event=pr`: en un PR, `pr-4`. No se publica, pero el tag se
    calcula igual.
  - `type=sha`: `sha-6db7822`. El inmutable.
  - `type=raw,value=latest,enable={{is_default_branch}}`: `latest` solo
    cuando es la rama default.
- Además genera labels estándar (`org.opencontainers.image.source` con la
  URL del repo, la revisión, la fecha). El label `source` es lo que hace que
  GitHub asocie el paquete al repo automáticamente.

#### Pieza 5: build y push

```yaml
      - name: Build (y push si no es PR)
        uses: docker/build-push-action@v6
        with:
          context: .
          push: ${{ github.event_name != 'pull_request' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- `push:` recibe `true` o `false` según el evento. En PR construye y
  descarta; en `main` construye y sube.
- `cache-from`/`cache-to: type=gha`: guarda las capas de Docker en el cache
  de GitHub Actions. Sin esto cada run reconstruye desde cero, porque el
  runner no tiene el cache local que tenés vos. `mode=max` guarda también
  las capas de las etapas intermedias (`deps`, `builder`), que es justo lo
  que querés cachear.

#### Pieza 6: sumar `docker` a la compuerta

En el job `ci`, cambiá el `needs`:

```yaml
    needs: [lint, typecheck, test, build, docker]
```

Esto es la respuesta a la segunda pregunta del "para pensar" del módulo 4:
si te olvidás de esta línea, un Dockerfile roto no bloquea el PR.

Validá:

```bash
npx --yes @action-validator/cli .github/workflows/ci.yml
```

### Paso 6: PR, mirar, mergear

```bash
git add next.config.ts .dockerignore Dockerfile .github/workflows/ci.yml
git commit -m "Docker multi-stage y publicación en GHCR"
git push -u origin ci/docker-y-ghcr
gh pr create --fill
```

En el run del PR, el job `docker` tiene que construir la imagen y
terminar sin hacer push (el step de login aparece como *skipped*). Cuando
esté verde, mergeá:

```bash
gh pr merge --squash --delete-branch
git checkout main
git pull
```

El run de `main` ahora sí publica. Cuando termine:

1. Entrá al repo en GitHub. En la barra lateral derecha aparece
   **Packages** con `prueba_ci_cd`. Entrá: tenés que ver los tags `main`,
   `latest` y `sha-...`.
2. El paquete nace **privado** aunque el repo sea público. En la página del
   paquete, **Package settings** → **Danger Zone** → **Change visibility** →
   Public. Así lo podés bajar sin loguearte, y en el módulo 7 el servidor
   también.

### Paso 7: Bajar la imagen publicada y correrla

```bash
docker pull ghcr.io/fndecroix/prueba_ci_cd:main
docker run --rm -p 3000:3000 ghcr.io/fndecroix/prueba_ci_cd:main
```

Esta imagen la construyó GitHub, no vos. Es el mismo artefacto que va a
llegar a producción.

### Paso 8: Romperlo a propósito

En una rama nueva, sacá la línea `output: "standalone"` de `next.config.ts`,
commit, push, PR. El job `docker` falla en el `COPY --from=builder
/app/.next/standalone`: no existe. Lint, typecheck, tests y build pasan, y
`ci` bloquea el PR igual. Revertí y cerrá el PR (`gh pr close`) o mergealo
arreglado, como prefieras.

## Consigna

1. Pasos 1 a 8.
2. Avisame con la URL del paquete en GHCR y el tamaño de la imagen.

## Para pensar

- Un cambio en `src/` invalida la capa de `COPY . .` y todo lo que sigue.
  ¿Qué cambios invalidan la capa de `npm ci`? ¿Y la de `FROM node:24-alpine`?
- El tag `main` se mueve con cada merge. Si deployás `main` y algo sale mal,
  ¿cómo volvés a la versión anterior? ¿Y si deployás `sha-...`?
- La imagen corre como usuario `nextjs`, no `root`. ¿Qué podría hacer un
  atacante que encontró una vulnerabilidad en la app si el proceso corriera
  como `root`? ¿Y como `nextjs`?
