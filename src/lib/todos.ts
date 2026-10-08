export type Todo = {
  id: number;
  title: string;
  done: boolean;
};

export function addTodo(todos: Todo[], title: string): Todo[] {
  const trimmed = title.trim();
  if (trimmed === "") return todos;
  const nextId = todos.reduce((max, t) => Math.max(max, t.id), 0) + 1;
  return [...todos, { id: nextId, title: trimmed, done: false }];
}

export function toggleTodo(todos: Todo[], id: number): Todo[] {
  return todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
}

export function removeTodo(todos: Todo[], id: number): Todo[] {
  return todos.filter((t) => t.id !== id);
}

export function countPending(todos: Todo[]): number {
  return todos.filter((t) => !t.done).length;
}

const sinUsar = 42;