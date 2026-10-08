import { describe, it, expect } from "vitest";
import { addTodo, toggleTodo, removeTodo, countPending, type Todo } from "./todos";

const base: Todo[] = [
  { id: 1, title: "Comprar pan", done: false },
  { id: 2, title: "Pagar la luz", done: true },
];

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