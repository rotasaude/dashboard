import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DataTable, type Column } from "./DataTable";

afterEach(cleanup);

interface Row {
  id: string;
  label: string;
}

const cols: Column<Row>[] = [
  { label: "Nome", render: (r) => r.label },
  {
    label: "Ação", render: (r) => (
      <button type="button" onClick={() => actionClicked(r)}>Ação {r.label}</button>
    )
  }
];

const rows: Row[] = [ { id: "1", label: "Ana" }, { id: "2", label: "Bia" } ];

const plainCols: Column<Row>[] = [ { label: "Nome", render: (r) => r.label } ];

let actionClicked: (r: Row) => void;

describe("DataTable", () => {
  it("sem onRowClick, a linha não é <button> e um botão de ação na célula recebe o clique", async () => {
    const onAction = vi.fn();
    actionClicked = onAction;
    render(<DataTable<Row> cols={cols} rows={rows} rowKey={(r) => r.id} />);

    const rowEls = screen.getAllByRole("row").slice(1); // sem o cabeçalho
    expect(rowEls[0].tagName).not.toBe("BUTTON");

    fireEvent.click(screen.getByRole("button", { name: "Ação Ana" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(rows[0]);
  });

  it("com onRowClick, clicar na linha chama uma vez, com a row certa", () => {
    const onRowClick = vi.fn();
    render(<DataTable<Row> cols={plainCols} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);

    const rowEls = screen.getAllByRole("row").slice(1);
    fireEvent.click(rowEls[1]);

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("getAllByRole('row') devolve cabeçalho + N linhas, e a tabela existe", () => {
    render(<DataTable<Row> cols={cols} rows={rows} rowKey={(r) => r.id} />);

    expect(screen.getAllByRole("row")).toHaveLength(1 + rows.length);
    expect(screen.getByRole("table")).not.toBeNull();
  });

  it("rows: [] renderiza o texto de empty", () => {
    render(<DataTable<Row> cols={cols} rows={[]} rowKey={(r) => r.id} empty="nada por aqui" />);

    expect(screen.getByText("nada por aqui")).not.toBeNull();
  });
});
