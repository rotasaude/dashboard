// src/modules/analytics/DataStamp.tsx
// Carimbo do Analytics (spec §8): "dados até DD/MM" e, com `stale`, o aviso.
import { STALE_LABEL, dataUntil } from "../../lib/analytics";
import { fmtDateTime } from "../../lib/format";
import { Tag } from "../../components/Tag";

export function DataStamp({ asOf, stale }: { asOf: string | null; stale: boolean }) {
  const until = dataUntil(asOf);
  if (!until) return null;
  return (
    <div className="mono" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "var(--ink3)" }}>
      <span title={`consolidado em ${fmtDateTime(asOf)}`}>dados até {until}</span>
      {stale && <span role="status"><Tag tone="warn">{STALE_LABEL}</Tag></span>}
    </div>
  );
}
