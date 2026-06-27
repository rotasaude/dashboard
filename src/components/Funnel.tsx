// Funnel — barras horizontais com retenção % vs topo do funil.

import { fmtNumber } from "../lib/format";
import { toneColor, type Tone } from "../theme/tokens";

interface Step {
  label: string;
  count: number;
  tone?: Tone | string;
}

interface Props {
  steps: Step[];
}

export function Funnel({ steps }: Props) {
  const top = steps[0]?.count || 0;
  const max = Math.max(...steps.map((s) => s.count || 0), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => {
        const pctMax = (s.count / max) * 100;
        const retention = top === 0 ? 0 : (s.count / top) * 100;
        return (
          <div key={`${s.label}-${i}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12
              }}
            >
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>{s.label}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>
                {fmtNumber(s.count)} · {retention.toFixed(0)}%
              </span>
            </div>
            <div style={{ height: 8, background: "var(--sunken2)", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  width: `${pctMax}%`,
                  height: "100%",
                  background: toneColor(s.tone).fg,
                  transition: "width 200ms ease"
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
