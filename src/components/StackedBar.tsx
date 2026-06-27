// StackedBar — barra empilhada horizontal + legenda em % (tier, ack, mode).

import { toneColor, type Tone } from "../theme/tokens";

interface Segment {
  label: string;
  count: number;
  tone?: Tone | string;
}

interface Props {
  segments: Segment[];
  showLegend?: boolean;
}

export function StackedBar({ segments, showLegend = true }: Props) {
  const total = segments.reduce((acc, s) => acc + (s.count || 0), 0);
  if (total === 0) {
    return (
      <div
        className="mono"
        style={{ fontSize: 10.5, color: "var(--ink3)", padding: "4px 0" }}
      >
        sem dados
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div
        style={{
          display: "flex",
          height: 10,
          borderRadius: 999,
          overflow: "hidden",
          background: "var(--sunken2)"
        }}
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(", ")}
      >
        {segments.map((s, i) => {
          const pct = (s.count / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={`${s.label}-${i}`}
              title={`${s.label}: ${s.count} (${pct.toFixed(1)}%)`}
              style={{ width: `${pct}%`, background: toneColor(s.tone).fg }}
            />
          );
        })}
      </div>
      {showLegend && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
          {segments.map((s, i) => {
            const pct = total === 0 ? 0 : (s.count / total) * 100;
            return (
              <div
                key={`${s.label}-${i}`}
                className="mono"
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5 }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: toneColor(s.tone).fg
                  }}
                />
                <span style={{ color: "var(--ink2)" }}>{s.label}</span>
                <span style={{ color: "var(--ink3)" }}>· {pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
