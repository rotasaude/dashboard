// EmptyState — nunca renderize 0 como se fosse dado carregado. Use isto.

import type { ReactNode } from "react";

interface Props {
  icon?: ReactNode;
  title: string;
  sub?: string;
}

export function EmptyState({ icon = "◌", title, sub }: Props) {
  return (
    <div
      style={{
        padding: "24px 16px",
        textAlign: "center",
        color: "var(--ink3)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6
      }}
    >
      <div style={{ fontSize: 24, color: "var(--ink4)" }}>{icon}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--ink2)" }}>{title}</div>
      {sub && <div className="mono" style={{ fontSize: 10.5 }}>{sub}</div>}
    </div>
  );
}
