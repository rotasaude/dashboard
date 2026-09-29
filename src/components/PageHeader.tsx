// Cabeçalho de página: título 20px + slug mono + slot à direita (seletor de bairro).
import type { ReactNode } from "react";

interface Props {
  title: string;
  sub: string;
  right?: ReactNode;
}

export function PageHeader({ title, sub, right }: Props) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>{title}</h1>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink3)",
          textTransform: "uppercase",
          letterSpacing: 0.6
        }}
      >
        {sub}
      </span>
      {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
    </div>
  );
}
