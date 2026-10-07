"use client";

import { useState } from "react";
import {
  addTodo,
  countPending,
  removeTodo,
  toggleTodo,
  type Todo,
} from "@/lib/todos";

export default function TodoList() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTodos(addTodo(todos, title));
    setTitle("");
  }

  return (
    <section>
      <form onSubmit={handleSubmit}>
        <input
          aria-label="Nueva tarea"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="¿Qué hay que hacer?"
        />
        <button type="submit">Agregar</button>
      </form>

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={() => setTodos(toggleTodo(todos, todo.id))}
              />
              <span className={todo.done ? "done" : undefined}>
                {todo.title}
              </span>
            </label>
            <button
              type="button"
              aria-label={`Eliminar ${todo.title}`}
              onClick={() => setTodos(removeTodo(todos, todo.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <p>Pendientes: {countPending(todos)}</p>
    </section>
  );
}
