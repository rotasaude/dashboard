// SourceBadge — "ao vivo" (dot pulsante verde) vs "projeção" (relógio + ts).
// Requisito do brief §2.5 / §7: cada métrica honesta sobre sua origem.

import { fmtTime } from "../lib/format";

interface Props {
  kind?: "live" | "proj";
  at?: string;
  compact?: boolean;
}

export function SourceBadge({ kind = "live", at, compact }: Props) {
  const isLive = kind === "live";
  return (
    <span
      className="mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        color: "var(--ink3)",
        whiteSpace: "nowrap"
      }}
      title={isLive ? "Métrica calculada ao vivo (consulta indexada)" : "Métrica lida de projeção"}
    >
      {isLive ? (
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "var(--ok)",
            color: "var(--ok)",
            animation: "pulse-dot 1.6s ease-in-out infinite"
          }}
        />
      ) : (
        <span aria-hidden style={{ fontSize: 10 }}>◔</span>
      )}
      {!compact && <span>{isLive ? "ao vivo" : "projeção"}</span>}
      {at && !compact && <span style={{ opacity: 0.85 }}>· {fmtTime(at)}</span>}
    </span>
  );
}
