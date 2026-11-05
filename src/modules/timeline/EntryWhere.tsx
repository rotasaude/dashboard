// "Onde e quem" de uma entrada da linha do tempo: unidade e pessoa em duas linhas, sem cortar (AT-15). Serve à linha do tempo geral
// (`PatientTimeline`) e à do CAPS (`CapsTimeline`).
import type { TimelineEntry } from "../../lib/api";
import { entryWhere } from "../../lib/timeline";

export function EntryWhere({ entry }: { entry: TimelineEntry }) {
  const w = entryWhere(entry);
  if (!w.unit && !w.person) return <>—</>;
  return (
    <span style={{ display: "flex", flexDirection: "column" }}>
      {w.unit ?? "—"}{w.person && <span style={{ color: "var(--ink2)" }}>{w.person}</span>}
    </span>
  );
}
