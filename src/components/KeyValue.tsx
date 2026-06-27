// KeyValue (AKV) — par rótulo/valor empilhado (NAVBAR.md / COMPONENTS.md).
//   label: --mono 10.5px uppercase letter-spacing 0.4 ink3
//   value: --mono 14px weight 600 (cor via `vc`)

import type { ReactNode } from "react";

interface Props {
  k: string;
  v: ReactNode;
  vc?: string;
  mono?: boolean;
}

export function KeyValue({ k, v, vc, mono = true }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--ink3)",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {k}
      </span>
      <span
        className={mono ? "mono" : ""}
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: vc || "var(--ink)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {v}
      </span>
    </div>
  );
}
