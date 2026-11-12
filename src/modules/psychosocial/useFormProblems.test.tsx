// errNode do molde dos formulários do CAPS: todas as frases distintas de um path (a crítica do api põe mais de uma no mesmo campo),
// com o id de aria-describedby num elemento que existe; uma frase só continua sendo um <p> com o id.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../../lib/api";
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

function Sender({ opts, onStale, onRefused }: {
  opts?: Parameters<typeof useFormProblems>[0]; onStale: (t: string) => void; onRefused?: (r: unknown[]) => void;
}) {
  const f = useFormProblems(opts);
  return (
    <form ref={f.formRef} onSubmit={(ev) => f.submit(ev, {
      call: () => Promise.reject(new ApiError(409, { error: "manifestation_changed" }, "x")), ok: () => undefined, stale: onStale,
      refused: (r) => { onRefused?.(r); return r.map((x) => ({ path: x.path, text: x.text })); }
    })}>
      {f.top(() => false)}
      <button type="submit">Enviar</button>
    </form>
  );
}

describe("useFormProblems(opts)", () => {
  it("com opts, a recusa vai pelo tradutor recebido e o isStale decide o stale", async () => {
    const stale = vi.fn();
    const refusals = vi.fn(() => [ { path: "", code: "x", text: "frase do tradutor", participantIndex: null } ]);
    const isStale = vi.fn(() => true);
    render(<Sender opts={{ refusals, isStale }} onStale={stale} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    await waitFor(() => expect(stale).toHaveBeenCalledWith("frase do tradutor", expect.anything()));
    expect(refusals).toHaveBeenCalled();
    expect(isStale).toHaveBeenCalled();
  });
  it("com opts, sem stale, o tradutor recebido produz os problemas da tela", async () => {
    const stale = vi.fn();
    render(<Sender opts={{ refusals: () => [ { path: "", code: "x", text: "outra frase", participantIndex: null } ], isStale: () => false }} onStale={stale} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("outra frase")).not.toBeNull();
    expect(stale).not.toHaveBeenCalled();
  });
  it("sem opts, o comportamento do CAPS segue (409 não é tela velha do CAPS)", async () => {
    const stale = vi.fn();
    render(<Sender onStale={stale} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("recusado pelo servidor (manifestation_changed)")).not.toBeNull();
    expect(stale).not.toHaveBeenCalled();
  });
});
