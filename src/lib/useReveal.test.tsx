import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { useReveal } from "./useReveal";

afterEach(cleanup);

function Harness() {
  const [ open, setOpen ] = useState(false);
  const ref = useReveal<HTMLElement>(open);
  return (
    <>
      <button onClick={() => setOpen(true)}>abrir</button>
      {open && <section ref={ref}><h3>Encerrar atendimento de Luíza</h3><button>ok</button></section>}
    </>
  );
}

describe("useReveal", () => {
  it("rola até o painel aberto e foca o título", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "abrir" }));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    const title = screen.getByRole("heading", { name: /Encerrar atendimento/ });
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute("tabindex")).toBe("-1");
  });
});
