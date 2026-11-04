// Laudo de TFD só para leitura (módulo 30, F-30.5) e os eventos do processo. Vem de uma leitura com trilha (POST /tfd/cases/:id/read);
// quem mostra guarda o processo só na memória da tela. Código novo do api aparece cru.
import type { TfdCase, TfdEvent } from "../../lib/api";
import { tfdEventLabel, transportModeLabel } from "../../lib/tfd";
import { fmtDateTime } from "../../lib/format";
import { list, muted } from "../exams/styles";

const dash = (v: string | null | undefined) => (v && v.trim() !== "" ? v : "—");

export function TfdReportView({ c }: { c: TfdCase }) {
  const r = c.report;
  const sigtap = r.sigtap_code ? `${r.sigtap_code}${r.sigtap_name ? ` — ${r.sigtap_name}` : ""}` : null;
  const rows: [ string, string ][] = [
    [ "Procedimento (SIGTAP)", dash(sigtap) ],
    [ "CID-10", dash(r.cid10) ],
    [ "Justificativa", dash(r.justification) ],
    [ "Indicação de acompanhante", r.companion_indicated ? `sim${r.companion_reason ? ` — ${r.companion_reason}` : ""}` : "não" ],
    [ "Tipo de transporte", transportModeLabel(r.transport_mode) ],
    [ "Cidade de destino", `${c.destination.name} — ${c.destination.distance_km} km${c.destination.metropolitan ? " (mesma região metropolitana)" : ""}` ],
    [ "Prestador", dash(c.provider?.name) ],
    [ "Atendimento no destino", c.appointment_at ? fmtDateTime(c.appointment_at) : "não marcado" ]
  ];
  return (
    <section aria-label="Laudo do pedido" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(0, max-content) minmax(0, 1fr)", gap: "4px 12px", fontSize: 12.5 }}>
        {rows.map(([ k, v ]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--ink3)" }}>{k}</dt>
            <dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function TfdEvents({ events }: { events: TfdEvent[] }) {
  if (events.length === 0) return <p style={muted}>sem eventos</p>;
  return (
    <ol aria-label="eventos do pedido" style={list}>
      {events.map((e, i) => (
        <li key={`${e.kind}-${e.at}-${i}`}>
          <span>{[ fmtDateTime(e.at), tfdEventLabel(e.kind), e.by_name ].filter(Boolean).join(" · ")}</span>
          {e.reason && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{e.reason}</p>}
        </li>
      ))}
    </ol>
  );
}
