// errNode do molde dos formulários do CAPS: todas as frases distintas de um path (a crítica do api põe mais de uma no mesmo campo),
// com o id de aria-describedby num elemento que existe; uma frase só continua sendo um <p> com o id.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useFormProblems } from "./useFormProblems";

afterEach(() => cleanup());

function Harness({ list }: { list: { path: string; text: string }[] }) {
  const f = useFormProblems();
  return (
    <form ref={f.formRef} onSubmit={(ev) => { ev.preventDefault(); f.show(list); }}>
      <input aria-label="Campo" {...f.aria("x")} />
      {f.errNode("x")}
      <button type="submit">Enviar</button>
    </form>
  );
}
const describedBy = () => document.getElementById(screen.getByLabelText("Campo").getAttribute("aria-describedby") as string);

describe("useFormProblems.errNode", () => {
  it("duas frases no mesmo path aparecem juntas, sem repetir, e o aria-describedby aponta para um id que existe", () => {
    render(<Harness list={[ { path: "x", text: "primeira" }, { path: "x", text: "segunda" }, { path: "x", text: "primeira" } ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(screen.getAllByText("primeira").length).toBe(1);
    expect(screen.getByText("segunda")).not.toBeNull();
    const node = describedBy();
    expect(node).not.toBeNull();
    expect(node?.textContent).toContain("primeira");
    expect(node?.textContent).toContain("segunda");
  });
  it("uma frase só: um <p> com o id", () => {
    render(<Harness list={[ { path: "x", text: "única" } ]} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    const node = describedBy();
    expect(node?.tagName).toBe("P");
    expect(node?.textContent).toBe("única");
  });
});
