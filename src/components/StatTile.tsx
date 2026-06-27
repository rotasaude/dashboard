// StatTile — KPI. Valor mono 27px, rótulo 11.5, source badge, sparkline opcional.

import { fmtNumber, fmtPercent } from "../lib/format";
import { toneColor, type Tone } from "../theme/tokens";
import { SourceBadge } from "./SourceBadge";
import { Sparkline } from "./Sparkline";

interface Props {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  delta?: string | null;
  tone?: Tone | string;
  spark?: number[];
  source?: "live" | "proj";
}

export function StatTile({ label, value, unit, delta, tone, spark, source }: Props) {
  const { fg } = toneColor(tone);
  const formatted =
    typeof value === "number"
      ? (unit === "%" ? fmtPercent(value, "") : fmtNumber(value))
      : value ?? "—";

  return (
    <div
      style={{
        background: "var(--panel)",
        border: "1px solid var(--rule)",
        borderRadius: "var(--radius-panel)",
        padding: "13px 15px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: 104
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span
          style={{
            fontSize: 11.5,
            color: "var(--ink2)",
            letterSpacing: 0.1
          }}
        >
          {label}
        </span>
        <SourceBadge kind={source} compact />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 6, flex: 1 }}>
        <span
          className="mono"
          style={{
            fontSize: 27,
            fontWeight: 600,
            color: "var(--ink)",
            lineHeight: 1,
            letterSpacing: -0.8
          }}
        >
          {formatted}
        </span>
        {unit && (
          <span
            className="mono"
            style={{ fontSize: 13, color: "var(--ink3)" }}
          >
            {unit}
          </span>
        )}
        {delta && (
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: tone ? fg : "var(--ink3)",
              marginLeft: "auto"
            }}
          >
            {delta}
          </span>
        )}
      </div>

      {spark && spark.length > 0 && (
        <Sparkline data={spark} color={tone ? fg : "var(--accent)"} h={26} />
      )}
    </div>
  );
}
