// Meter — barra linear used/max + label + hint. Útil p/ purge backlog (idade vs TTL).

import { fmtNumber } from "../lib/format";
import { toneColor, type Tone } from "../theme/tokens";

interface Props {
  label: string;
  used: number;
  max: number;
  unit?: string;
  tone?: Tone | string;
  hint?: string;
}

export function Meter({ label, used, max, unit = "", tone, hint }: Props) {
  const safeMax = max || 1;
  const pct = Math.min(100, (used / safeMax) * 100);
  const { fg } = toneColor(tone || (pct > 100 ? "down" : pct > 80 ? "warn" : "ok"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 12, color: "var(--ink2)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>
          {fmtNumber(used)}{unit} / {fmtNumber(max)}{unit}
        </span>
      </div>
      <div style={{ height: 8, background: "var(--sunken2)", borderRadius: 999, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: fg }} />
      </div>
      {hint && (
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>
          {hint}
        </span>
      )}
    </div>
  );
}
