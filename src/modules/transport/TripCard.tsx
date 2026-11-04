// Cartão de uma viagem da agenda (módulo 30, F-30.2): situação, veículo, motorista, lotação e paradas; ações por situação.
// Confirmar confere antes na tela (`<trip>.driver` não traz a CNH: a ficha vem da lista de motoristas) e mostra todas as recusas do api de uma vez,
// relendo a agenda. Cancelar pede o motivo (10–500); o aviso aos passageiros só sai se a viagem já estava confirmada (api).
// O slot `children` recebe a lista de passageiros e a correção de presença (tarefas seguintes).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cancelTrip, confirmTrip, type TransportDestination, type TransportDriver, type TransportVehicle, type Trip } from "../../lib/api";
import { cityIsoDate, fmtHourMinute } from "../../lib/format";
import { occupancyText, transportRefusals, tripDraftFrom, tripProblems, tripStatusLabel, tripStatusTone } from "../../lib/transport";
import { SensitiveAction } from "../../components/SensitiveAction";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, list, muted, panel, row, title } from "../exams/styles";
import { TripForm } from "./TripForm";

const REASON_TEXT = "o motivo tem de 10 a 500 caracteres";
class LocalRefusal extends Error {}

const dayOf = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : iso;
};

export function tripTitle(t: Trip): string {
  const stops = [ ...t.stops ].sort((a, b) => a.position - b.position);
  const places = stops.filter((s) => s.kind === "destination").map((s) => s.label).join(", ");
  const back = fmtHourMinute(t.return_at);
  // Retorno em outro dia: diz o dia.
  const backDay = cityIsoDate(new Date(t.return_at));
  return `${fmtHourMinute(t.departure_at)} → ${backDay === t.date ? back : `${back} de ${dayOf(backDay)}`}${places ? ` · ${places}` : ""}`;
}

// `editBlocked`: frase de por que não dá para editar agora (ex.: a lista de veículos, motoristas ou destinos não carregou).
export function TripCard({ trip, today: _today, vehicles, drivers, destinations, editBlocked = null, children, onChanged, onReload, onGoToSecurity }: {
  trip: Trip; today: string; vehicles: TransportVehicle[]; drivers: TransportDriver[]; destinations: TransportDestination[];
  editBlocked?: string | null; children?: ReactNode; onChanged(t: Trip | null, text: string): void; onReload(): void; onGoToSecurity?(): void;
}) {
  const [ mode, setMode ] = useState<"view" | "edit" | "cancel">("view");
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ busy, setBusy ] = useState(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const focusTitle = useRef(false);
  const titleId = `trip-${trip.id}-title`;

  // Um alvo só para o foco: depois de salvar ou cancelar com sucesso, a frase da agenda (ActionMessage) fica com ele; ao desistir
  // (botão Cancelar do formulário) ou quando a viagem deixa de aceitar edição, o foco volta ao título.
  const close = (toTitle: boolean) => { focusTitle.current = toTitle; setMode("view"); };
  useEffect(() => {
    if (mode === "view" && focusTitle.current) { focusTitle.current = false; titleRef.current?.focus(); }
  }, [ mode ]);

  const stops = [ ...trip.stops ].sort((a, b) => a.position - b.position);
  const canEdit = trip.status === "planned" || trip.status === "confirmed";
  // Depois de uma recusa (ex.: `trip_not_open`) a agenda relida pode trazer a viagem já em andamento: o formulário fecha.
  useEffect(() => { if (!canEdit && mode !== "view") close(true); }, [ canEdit, mode ]);

  async function confirm() {
    if (busy) return;
    const local = tripProblems(tripDraftFrom(trip), { vehicles, drivers, confirm: true }).map((p) => p.text);
    if (local.length > 0) { setProblems(local); return; }
    setProblems([]); setBusy(true);
    try {
      const t = await confirmTrip(trip.id);
      onChanged(t, "Viagem confirmada.");
    } catch (err) {
      setProblems([ ...new Set(transportRefusals(err).map((r) => r.text)) ]);
      onReload();
    } finally { setBusy(false); }
  }

  const notice = trip.status === "confirmed"
    ? "A viagem sai da agenda e os passageiros recebem o aviso do cancelamento."
    : "A viagem sai da agenda. Como ainda não foi confirmada, os passageiros não recebem aviso.";

  return (
    <article aria-labelledby={titleId} style={panel}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h3 id={titleId} ref={titleRef} tabIndex={-1} style={title}>{tripTitle(trip)}</h3>
        <Tag tone={tripStatusTone(trip.status)} mono={false}>{tripStatusLabel(trip.status)}</Tag>
      </div>
      <div style={{ ...row, fontSize: 12.5 }}>
        <span>{trip.vehicle ? `${trip.vehicle.plate} · ${trip.vehicle.model}` : "sem veículo"}</span>
        <span aria-hidden="true" style={muted}>·</span>
        <span>{trip.driver ? trip.driver.name : "sem motorista"}</span>
        <span aria-hidden="true" style={muted}>·</span>
        <span>{occupancyText(trip)}</span>
      </div>
      <ol aria-label="Paradas" style={list}>
        {stops.map((s) => <li key={s.id}>{`${s.kind === "boarding" ? "embarque" : s.kind === "destination" ? "destino" : s.kind}: ${s.label}`}</li>)}
      </ol>

      {problems.length > 0 && (
        <ul aria-label="Recusas" style={{ ...list, color: "var(--down)" }}>
          {problems.map((p) => <li key={p} role="alert" style={alert}>{p}</li>)}
        </ul>
      )}

      {mode === "edit" && canEdit && (
        <TripForm trip={trip} date={trip.date} vehicles={vehicles} drivers={drivers} destinations={destinations}
          onSaved={(t) => { close(false); setProblems([]); onChanged(t, "Viagem atualizada."); }}
          onCancel={() => close(true)} onRefused={onReload} />
      )}

      {mode === "cancel" && canEdit && (
        <SensitiveAction title="Cancelar viagem" description={notice} requiresStepUp={false} onGoToSecurity={onGoToSecurity}
          fields={[ { name: "reason", label: "Motivo", required: true, multiline: true } ]}
          translateError={(err) => (err instanceof LocalRefusal ? err.message : transportRefusals(err)[0].text)}
          run={async (values) => {
            const reason = (values.reason ?? "").trim();
            if (reason.length < 10 || reason.length > 500) throw new LocalRefusal(REASON_TEXT);
            try {
              const t = await cancelTrip(trip.id, reason);
              onChanged(t, "Viagem cancelada.");
            } catch (err) { onReload(); throw err; }
          }}
          onDone={() => close(false)} onCancel={() => close(true)} />
      )}

      {mode === "view" && canEdit && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} disabled={busy || editBlocked !== null} aria-describedby={editBlocked ? `${titleId}-blocked` : undefined}
            onClick={() => { setProblems([]); setMode("edit"); }}>Editar</button>
          {trip.status === "planned" && (
            <button type="button" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy} onClick={() => { void confirm(); }}>Confirmar viagem</button>
          )}
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => { setProblems([]); setMode("cancel"); }}>Cancelar viagem</button>
        </div>
      )}
      {mode === "view" && canEdit && editBlocked && <p id={`${titleId}-blocked`} style={muted}>{`Editar indisponível: ${editBlocked}`}</p>}
      {children}
    </article>
  );
}
