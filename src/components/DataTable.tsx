// DataTable — tabela em CSS grid. Header mono uppercase. Linhas via render(row).
// `cols[*].w` aceita qualquer grid-template-columns value (fr, px, minmax).

import type { ReactNode } from "react";

export interface Column<T> {
  label: string;
  w?: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
}

interface Props<T> {
  cols: Column<T>[];
  rows: T[];
  rowKey: (row: T, i: number) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}

export function DataTable<T>({ cols, rows, rowKey, onRowClick, empty }: Props<T>) {
  const gridCols = cols.map((c) => c.w || "1fr").join(" ");
  if (rows.length === 0) {
    return <div className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{empty ?? "sem dados"}</div>;
  }
  return (
    <div role="table" style={{ width: "100%" }}>
      <div
        role="row"
        className="mono"
        style={{
          display: "grid",
          gridTemplateColumns: gridCols,
          gap: 12,
          padding: "8px 10px",
          background: "var(--sunken)",
          borderTop: "1px solid var(--rule)",
          borderBottom: "1px solid var(--rule)",
          fontSize: 10.5,
          color: "var(--ink3)",
          textTransform: "uppercase",
          letterSpacing: 0.5
        }}
      >
        {cols.map((c) => (
          <span key={c.label} role="columnheader" style={{ textAlign: c.align || "left" }}>
            {c.label}
          </span>
        ))}
      </div>
      {rows.map((r, i) => (
        <button
          key={rowKey(r, i)}
          role="row"
          onClick={onRowClick ? () => onRowClick(r) : undefined}
          disabled={!onRowClick}
          style={{
            display: "grid",
            gridTemplateColumns: gridCols,
            gap: 12,
            width: "100%",
            padding: "10px 10px",
            background: "transparent",
            borderBottom: "1px solid var(--rule)",
            fontSize: 12,
            color: "var(--ink)",
            cursor: onRowClick ? "pointer" : "default",
            textAlign: "left",
            alignItems: "center"
          }}
        >
          {cols.map((c, ci) => (
            <span key={ci} role="cell" style={{ textAlign: c.align || "left", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.render(r)}
            </span>
          ))}
        </button>
      ))}
    </div>
  );
}
