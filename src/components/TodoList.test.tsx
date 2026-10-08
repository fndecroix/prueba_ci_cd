import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TodoList from "./TodoList";

describe("TodoList", () => {
  it("arranca sin tareas pendientes", () => {
    render(<TodoList />);
    expect(screen.getByText("Pendientes: 0")).toBeInTheDocument();
  });
 
  it("agrega una tarea al enviar el formulario", async () => {
    const user = userEvent.setup();
    render(<TodoList />);

    await user.type(screen.getByLabelText("Nueva tarea"), "Comprar pan");
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    expect(screen.getByText("Comprar pan")).toBeInTheDocument();
    expect(screen.getByText("Pendientes: 1")).toBeInTheDocument();
  });

  it("marca una tarea como hecha y baja el contador", async () => {
    const user = userEvent.setup();
    render(<TodoList />);

    await user.type(screen.getByLabelText("Nueva tarea"), "Comprar pan");
    await user.click(screen.getByRole("button", { name: "Agregar" }));
    await user.click(screen.getByRole("checkbox"));

    expect(screen.getByText("Pendientes: 0")).toBeInTheDocument();
  });
});