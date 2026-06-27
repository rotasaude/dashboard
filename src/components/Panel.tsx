// Panel — card de painel com header (title + subtítulo mono + slot direito
// + carimbo AsOf). Equivale ao APanel do protótipo. Ver COMPONENTS.md.

import type { ReactNode } from "react";
import { AsOfStamp } from "./AsOfStamp";

interface Props {
  title: string;
  sub?: string;
  right?: ReactNode;
  source?: "live" | "proj";
  asOf?: string;
  children: ReactNode;
}

export function Panel({ title, sub, right, source, asOf, children }: Props) {
  return (
    <section
      style={{
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--radius-panel)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column"
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "13px 16px",
          borderBottom: "1px solid var(--rule)",
          background: "color-mix(in oklch, var(--panel), var(--sunken) 35%)"
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 13.5,
              fontWeight: 600,
              color: "var(--ink)",
              lineHeight: 1.2
            }}
          >
            {title}
          </h2>
          {sub && (
            <div
              className="mono"
              style={{
                marginTop: 2,
                fontSize: 10.5,
                color: "var(--ink3)",
                textTransform: "uppercase",
                letterSpacing: 0.4
              }}
            >
              {sub}
            </div>
          )}
        </div>
        {right}
        {asOf && <AsOfStamp at={asOf} kind={source} />}
      </header>
      <div style={{ padding: 16 }}>{children}</div>
    </section>
  );
}
