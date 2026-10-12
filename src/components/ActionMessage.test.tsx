import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionMessage } from "./ActionMessage";
import { useActionMessage } from "../lib/useActionMessage";

afterEach(cleanup);

function Harness() {
  const m = useActionMessage();
  return (
    <div>
      <button onClick={() => { m.start(); m.ok("Pedido de agendamento criado"); }}>a</button>
      <button onClick={() => m.start()}>b</button>
      <button onClick={() => { m.start(); m.fail("Não deu para encerrar"); }}>c</button>
      <ActionMessage message={m.message} />
    </div>
  );
}

describe("ActionMessage", () => {
  it("mostra junto da ação, recebe o foco e some quando outra ação começa", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    const ok = screen.getByRole("status");
    expect(ok.textContent).toBe("Pedido de agendamento criado");
    expect(document.activeElement).toBe(ok);
    fireEvent.click(screen.getByRole("button", { name: "b" }));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "c" })); });
    expect(screen.getByRole("alert").textContent).toBe("Não deu para encerrar");
  });
});
