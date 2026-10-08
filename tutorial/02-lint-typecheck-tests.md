# Módulo 2: Lint, typecheck y tests en el pipeline

Prerequisito: el módulo 1 terminado, con el run verde en GitHub.

## Conceptos

### Tres capas de verificación

Un pipeline de CI corre verificaciones automáticas sobre cada cambio. Las
tres más comunes atrapan errores distintos:

| Capa      | Herramienta       | Qué atrapa                                         | Qué NO atrapa                        |
|-----------|-------------------|----------------------------------------------------|--------------------------------------|
| Lint      | ESLint            | Variables sin usar, imports rotos, malas prácticas | Que el código haga lo que debe       |
| Typecheck | TypeScript (`tsc`)| Pasar un string donde va un número, campos que no existen | Lógica equivocada con tipos correctos |
| Tests     | Vitest            | Que una función devuelva lo que esperás            | Casos que no se te ocurrió probar    |

Ejemplo concreto con la app: si cambiás `countPending` para que cuente las
tareas *hechas* en vez de las pendientes, el lint pasa, el typecheck pasa
(sigue devolviendo un número) y solo un test lo atrapa. Si en cambio
escribís `todos.filter((t) => t.dne)`, el typecheck lo atrapa antes de que
corra ningún test.

### Por qué cada capa es un step aparte

Podrías meter todo en un solo comando, pero entonces cuando falla tenés que
leer el log entero para saber qué fue. Con un step por capa, la UI de
GitHub te muestra directo "Typecheck ✗" y el resto en verde. Y el orden
importa: se ponen primero los más rápidos (lint, typecheck) y al final los
lentos (tests, build), así un error tonto te lo avisa en segundos. A esto se
le dice *fail fast*.

### Los scripts de npm son el contrato

El pipeline corre `npm run lint`, `npm run typecheck`, `npm test`, `npm run
build`. Exactamente los mismos comandos que corrés vos. Si en CI falla algo
que localmente pasa, el problema casi siempre es que el runner arranca
limpio (sin `.next/`, sin caches) y vos no. Vas a ver un caso de esto en
este módulo.

### Vitest y Testing Library

- **Vitest** es el test runner. Entiende TypeScript y ESM sin configuración
  extra, y su API es igual a la de Jest (`describe`, `it`, `expect`), así que
  lo que aprendas sirve para los dos.
- **jsdom** simula un navegador dentro de Node, para que los componentes
  puedan renderizar sin abrir Chrome.
- **@testing-library/react** renderiza componentes y los consulta como lo
  haría un usuario: por el texto que se ve, por el rol (botón, checkbox),
  por la etiqueta accesible. La idea es que el test no dependa de detalles
  internos (nombres de clases, estructura del DOM).
- **@testing-library/jest-dom** agrega matchers como `toBeInTheDocument()`.
- **@testing-library/user-event** simula tipear y clickear de forma
  realista (dispara los mismos eventos que un usuario real).

### Un detalle de Next que te va a morder en CI

`src/app/layout.tsx` usa el tipo `LayoutProps`, que no está importado de
ningún lado: Next lo genera en `.next/types/` cuando corrés `next dev` o
`next build`. Localmente ya lo tenés generado, así que `tsc` lo encuentra.
En el runner no existe, y `tsc` falla con `Cannot find name 'LayoutProps'`.
La solución es correr `next typegen` (genera los tipos sin buildear) antes
de `tsc`. Esto es el típico "en mi máquina anda".

### Peer dependencies

Cuando instales Vitest te va a tirar un error `ERESOLVE`: Vitest 5 pide
`@types/node` 22 o más nuevo, y el proyecto tiene `^20` (lo dejó el
scaffolding de Next). Como `.nvmrc` dice Node 24, lo correcto es subir
`@types/node` a 24 para que los tipos coincidan con el runtime. Un *peer
dependency* es "yo funciono junto con tal versión de tal otro paquete"; npm
se niega a instalar si no cierra.

## Instrucciones

### Paso 1: Instalar las dependencias de test

Primero alineá los tipos de Node con la versión real:

```bash
npm install -D @types/node@^24
```

Después las herramientas de test:

```bash
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/dom @testing-library/jest-dom @testing-library/user-event
```

Al terminar, npm puede avisar que hay vulnerabilidades y sugerir
`npm audit fix`. **No corras `npm audit fix --force`.** El `--force` permite
cambiar versiones mayores de lo que haga falta para "arreglar" el reporte, y
en este proyecto baja `eslint` a 8 y `eslint-config-next` a 14, que no son
compatibles con tu `eslint.config.mjs`. El síntoma es
`Package subpath './config' is not defined by "exports"` al correr el lint.
Si te pasó, se vuelve con:

```bash
npm install -D eslint@^9 eslint-config-next@16.4.0
```

Verificá con `git diff package.json` que las únicas líneas que cambiaron
sean las que esperás: los scripts nuevos y las dependencias que instalaste.
Las vulnerabilidades las vemos en serio en el módulo 10.

**Qué es cada uno:**
- `vitest`: el runner.
- `@vitejs/plugin-react`: le enseña a Vitest a compilar JSX de React.
- `jsdom`: el navegador simulado.
- `@testing-library/react` y `@testing-library/dom`: render y queries
  (`dom` es peer dependency de `react`, por eso van los dos).
- `@testing-library/jest-dom`: matchers extra.
- `@testing-library/user-event`: simulación de usuario.

`-D` los pone en `devDependencies`: se necesitan para desarrollar y testear,
no para que la app corra en producción. Eso importa en el módulo 5, cuando
la imagen de Docker instale solo lo necesario.

Si probás `git diff package.json` vas a ver las versiones agregadas, y
`package-lock.json` cambió también. Los dos van al commit.

### Paso 2: Agregar los scripts

En `package.json`, dentro de `"scripts"`, agregá estas dos líneas después de
`"lint"` (acordate de la coma al final de la línea anterior):

```json
    "typecheck": "next typegen && tsc --noEmit",
    "test": "vitest run"
```

- `typecheck`: primero `next typegen` genera los tipos de Next, después
  `tsc --noEmit` revisa todo el proyecto sin generar archivos JS (solo
  queremos los errores).
- `test`: `vitest run` corre todos los tests una vez y termina. Sin `run`,
  Vitest queda en modo *watch* esperando cambios, que es lo que querés
  localmente pero en CI se colgaría para siempre.

### Paso 3: Configurar Vitest

Creá `vitest.config.mts` en la raíz del proyecto:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- La extensión `.mts` fuerza que el archivo se trate como módulo ES, que es
  lo que Vitest espera. El `tsconfig.json` ya incluye `**/*.mts`.
- `plugins: [react()]`: compila JSX.
- `resolve.tsconfigPaths: true`: hace que el alias `@/` (definido en
  `tsconfig.json` como `./src/*`) funcione también en los tests. Sin esto,
  el `import ... from "@/lib/todos"` del componente falla dentro de Vitest.
- `environment: "jsdom"`: usa el navegador simulado para todos los tests.
- `setupFiles`: un archivo que corre antes de cada archivo de test. Lo
  creás en el paso siguiente.

### Paso 4: El archivo de setup

Creá `vitest.setup.ts` en la raíz:

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
```

- La primera línea registra los matchers de jest-dom (como
  `toBeInTheDocument`) y sus tipos de TypeScript.
- `afterEach(cleanup)` desmonta lo que se renderizó después de cada test.
  Sin esto, el DOM de un test se queda para el siguiente y te aparecen
  errores tipo "Found multiple elements with the text ...". Testing Library
  lo hace solo en Jest, pero en Vitest hay que pedírselo.

### Paso 5: Tests de la lógica pura

Creá `src/lib/todos.test.ts`. Vitest encuentra solo los archivos que
terminan en `.test.ts` o `.test.tsx`, en cualquier carpeta.

```ts
import { describe, it, expect } from "vitest";
import { addTodo, toggleTodo, removeTodo, countPending, type Todo } from "./todos";

const base: Todo[] = [
  { id: 1, title: "Comprar pan", done: false },
  { id: 2, title: "Pagar la luz", done: true },
];
```

- Se importan explícitamente `describe`, `it` y `expect`. Vitest puede
  exponerlos como globales, pero importarlos deja claro de dónde salen y
  hace feliz a TypeScript sin configuración extra.
- `base` es una lista fija que cada test usa como punto de partida. Como
  las funciones de `todos.ts` no mutan su entrada, se puede compartir.

```ts
describe("addTodo", () => {
  it("agrega una tarea con el siguiente id", () => {
    const result = addTodo(base, "Sacar la basura");
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ id: 3, title: "Sacar la basura", done: false });
  });

  it("ignora títulos vacíos o solo espacios", () => {
    expect(addTodo(base, "   ")).toBe(base);
  });

  it("no muta la lista original", () => {
    addTodo(base, "Otra");
    expect(base).toHaveLength(2);
  });
});
```

- `describe` agrupa; `it` es un test. El texto del `it` es lo que ves en el
  log cuando falla, así que conviene que diga el comportamiento esperado.
- `toEqual` compara contenido (dos objetos con los mismos campos). `toBe`
  compara identidad (el mismo objeto). El segundo test usa `toBe` a
  propósito: `addTodo` con título vacío devuelve *la misma* lista, no una
  copia.

```ts
describe("toggleTodo", () => {
  it("invierte done de la tarea indicada", () => {
    expect(toggleTodo(base, 1)[0].done).toBe(true);
  });
});

describe("removeTodo", () => {
  it("saca la tarea indicada", () => {
    expect(removeTodo(base, 2).map((t) => t.id)).toEqual([1]);
  });
});

describe("countPending", () => {
  it("cuenta solo las no hechas", () => {
    expect(countPending(base)).toBe(1);
  });
});
```

Un test por función alcanza para empezar. Más adelante, cuando rompas algo,
vas a ver cuál conviene agregar.

### Paso 6: Test del componente

Creá `src/components/TodoList.test.tsx` (con `x`, porque tiene JSX).

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TodoList from "./TodoList";
```

- `render` monta el componente en el jsdom. `screen` es el objeto para
  buscar cosas en lo que se renderizó.

```tsx
describe("TodoList", () => {
  it("arranca sin tareas pendientes", () => {
    render(<TodoList />);
    expect(screen.getByText("Pendientes: 0")).toBeInTheDocument();
  });
```

- `getByText` busca un elemento por su texto visible. Si no hay exactamente
  uno, el test falla (y te imprime el DOM entero para que veas qué había).
- `toBeInTheDocument` viene de jest-dom; sin el setup del paso 4 no existe.

```tsx
  it("agrega una tarea al enviar el formulario", async () => {
    const user = userEvent.setup();
    render(<TodoList />);

    await user.type(screen.getByLabelText("Nueva tarea"), "Comprar pan");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    expect(screen.getByText("Comprar pan")).toBeInTheDocument();
    expect(screen.getByText("Pendientes: 1")).toBeInTheDocument();
  });
```

- `userEvent.setup()` crea un "usuario" que tipea y clickea. Sus métodos
  son asíncronos, por eso el test es `async` y usa `await`.
- `getByLabelText("Nueva tarea")` encuentra el input por su
  `aria-label`. `getByRole("button", { name: "Agregar" })` encuentra el
  botón por rol y texto. Buscar así, en vez de por clase CSS o por `id`,
  hace que el test sobreviva a cambios de estilo y de estructura.

```tsx
  it("marca una tarea como hecha y baja el contador", async () => {
    const user = userEvent.setup();
    render(<TodoList />);

    await user.type(screen.getByLabelText("Nueva tarea"), "Comprar pan");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByText("Pendientes: 0")).toBeInTheDocument();
  });
});
```

- Este test depende de que el anterior no haya dejado nada renderizado (el
  `getByRole("checkbox")` fallaría si hubiera dos). Ahí trabaja el
  `cleanup` del paso 4.

### Paso 7: Correr todo localmente

Antes de tocar el workflow, confirmá que los cuatro comandos pasan en tu
máquina:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Fijate en la salida de `npm test`: tiene que decir `Test Files  2 passed`
y `Tests  9 passed`. Si algo falla acá, arreglalo antes de seguir; no tiene
sentido mandar a CI algo que ya sabés que está roto.

### Paso 8: Sumar los steps al workflow

En `.github/workflows/ci.yml`, después del step de lint, pegá estos tres
steps, con la misma indentación que los anteriores:

```yaml
      - name: Typecheck
        run: npm run typecheck

      - name: Tests
        run: npm test

      - name: Build
        run: npm run build
```

- `npm test` es un atajo de `npm run test`; los dos funcionan.
- `Build` va último porque es el más lento. Si el lint o un test fallan,
  ni se llega a buildear.
- El orden de los steps es el orden de ejecución, no hay paralelismo dentro
  de un job. Dividirlo en jobs paralelos es tema del módulo 4.

### Paso 9: Commit, push, mirar el run

```bash
git add -A
git commit -m "Módulo 2: typecheck, tests con Vitest y build en CI"
git push
gh run watch
```

Antes de commitear, mirá `git status`: tienen que aparecer `package.json`,
`package-lock.json`, los dos archivos de config de Vitest, los dos tests y
el workflow. Si aparece `.next/` o `node_modules/`, algo pasa con el
`.gitignore`.

En el run, abrí cada step y fijate cuánto tarda. `Build` y `npm ci` van a
ser los lentos.

### Paso 10: Romperlo a propósito, dos veces

**Primero, un bug de lógica.** En `src/lib/todos.ts`, cambiá el cuerpo de
`countPending` para que cuente las hechas:

```ts
  return todos.filter((t) => t.done).length;
```

Push y mirá el run. Lint y Typecheck pasan; Tests falla. Abrí el step y
buscá la línea `FAIL src/lib/todos.test.ts > countPending > cuenta solo las
no hechas`. Más abajo te muestra el valor esperado y el recibido. Fijate
también que el test del componente que chequea "Pendientes: 1" falla por el
mismo bug: el componente usa esa función.

**Segundo, un error de tipos.** Revertí lo anterior y ahora escribí mal un
campo:

```ts
  return todos.filter((t) => !t.dne).length;
```

Push. Ahora falla Typecheck, y Tests ni corre (el step anterior frenó el
job). El error dice `Property 'dne' does not exist on type 'Todo'`.

Revertí, push, verde.

## Consigna

1. Pasos 1 a 10.
2. Cuando esté verde, avisame. Voy a revisar los tests, la config y el
   workflow, y a mirar los tres runs (el verde, el rojo de tests y el rojo
   de typecheck).

## Para pensar

- `next build` también hace typecheck por su cuenta. ¿Para qué tener el
  step `Typecheck` separado, entonces? Pista: tiempo y claridad del error.
- Si `countPending` estuviera mal pero no tuviera test, ¿llegaría a
  producción? ¿Qué capa lo frenaría?
- El test del componente usa `getByLabelText("Nueva tarea")`. ¿Qué pasa si
  alguien cambia el `aria-label` a "Tarea nueva"? ¿Eso es bueno o malo?
