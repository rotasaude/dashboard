// Modo cartão (spec do subprojeto 3, §3): só classes e atributos. O DOM
// consultado pelos testes (roles, filhos diretos, textContent) não muda.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable";

afterEach(cleanup);

type Row = { id: string; nome: string; n: number };
const rows: Row[] = [ { id: "a", nome: "Ana", n: 3 }, { id: "b", nome: "Bia", n: 7 } ];
const cols: Column<Row>[] = [
  { label: "Nome", render: (r) => r.nome },
  { label: "Total", align: "right", render: (r) => r.n },
  { label: "Ações", card: "actions", render: () => <button type="button">Abrir</button> },
  { label: "Interno", card: "hide", render: () => "x" }
];

describe("DataTable em modo cartão", () => {
  it("classes na tabela, no cabeçalho e nas linhas", () => {
    render(<DataTable cols={cols} rows={rows} rowKey={(r) => r.id} />);
    const [ head, ...data ] = screen.getAllByRole("row");
    expect(screen.getByRole("table").className).toBe("dt");
    expect(head.classList.contains("dt-row") && head.classList.contains("dt-head")).toBe(true);
    data.forEach((r) => expect(r.className).toBe("dt-row"));
  });

  it("cada célula é dt-cell, filha direta da linha, com data-label", () => {
    render(<DataTable cols={cols} rows={rows} rowKey={(r) => r.id} />);
    const row = screen.getAllByRole("row")[1];
    const cells = screen.getAllByRole("cell").slice(0, 4);
    cells.forEach((c) => { expect(c.parentElement).toBe(row); expect(c.className).toBe("dt-cell"); });
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual([ "Nome", "Total", "Ações", "Interno" ]);
  });

  it("data-align só fora do padrão e data-card só quando declarado", () => {
    render(<DataTable cols={cols} rows={rows} rowKey={(r) => r.id} />);
    const cells = screen.getAllByRole("cell").slice(0, 4);
    expect(cells.map((c) => c.getAttribute("data-align"))).toEqual([ null, "right", null, null ]);
    expect(cells.map((c) => c.getAttribute("data-card"))).toEqual([ null, null, "actions", "hide" ]);
  });

  it("o texto de linhas e células não muda (o rótulo é só CSS)", () => {
    render(<DataTable cols={cols} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getAllByRole("row")[1].textContent).toBe("Ana3Abrirx");
    expect(screen.getAllByRole("cell")[0].textContent).toBe("Ana");
  });

  it("cabeçalho sem data-label; linha só é BUTTON com onRowClick", () => {
    const { rerender } = render(<DataTable cols={cols} rows={rows} rowKey={(r) => r.id} />);
    screen.getAllByRole("columnheader").forEach((h) => expect(h.hasAttribute("data-label")).toBe(false));
    expect(screen.getAllByRole("row")[1].tagName).toBe("DIV");
    rerender(<DataTable cols={cols} rows={rows} rowKey={(r) => r.id} onRowClick={vi.fn()} />);
    expect(screen.getAllByRole("row")[1].tagName).toBe("BUTTON");
    expect(screen.getAllByRole("row")[1].className).toBe("dt-row");
  });

  it("vazio continua sem role=table", () => {
    render(<DataTable cols={cols} rows={[]} rowKey={(r) => r.id} empty="nada" />);
    expect(screen.queryByRole("table")).toBeNull();
  });
});
