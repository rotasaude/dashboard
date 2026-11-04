// Formulário do passageiro (módulo 30, F-30.2): paciente fixo (vem da sugestão de atendimento marcado ou da busca por CPF), embarque,
// destino, local e hora do atendimento, lugar, cadeira e acompanhante; sem origem, o motivo da viagem sem atendimento. Confere tudo antes de
// enviar (`passengerProblems`: lotação, cadeira, textos) e põe cada recusa do api no campo do `path`, com foco no primeiro. A regra de idade
// do acompanhante é do api (`companion_not_allowed`, path `companion`): a frase pede o motivo e o foco vai a "Motivo do acompanhante"; na
// origem TFD o motivo não resolve (o laudo não indicou acompanhante). Nenhum dado clínico: o formulário só tem os campos de <passenger>.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { addPassenger, type TripPassenger, type Trip } from "../../lib/api";
import { STALE_CODES, exceptionReasonLabel, originLabel, passengerBody, passengerProblems, transportRefusals, type PassengerDraft } from "../../lib/transport";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

const EXCEPTION_REASONS = [ "follow_up_return", "legacy_patient", "scheduling_pending", "other" ];
export const TFD_COMPANION_TEXT = "o laudo não indica acompanhante — tire o acompanhante";
export const TFD_DESTINATION_TEXT = "o destino tem de ser o do TFD deste paciente";
export const ORIGIN_GONE_TEXT = "este atendimento não está mais marcado — busque os atendimentos de novo";
// Recusas que dizem que a tela está velha: a frase fica e a agenda relê.

// Campo de cada `path` (local ou do api); o resto vai ao topo.
const FIELD_OF: Record<string, string> = {
  stop_id: "stop_id", destination_id: "destination_id", provider_name: "provider_name", address: "address", appointment_at: "appointment_at",
  takes_seat: "takes_seat", wheelchair: "wheelchair", exception_reason: "exception_reason", exception_note: "exception_note",
  "companion.name": "companion.name", "companion.document": "companion.document", "companion.reason": "companion.reason", companion: "companion.reason", "companion.toggle": "companion.toggle"
};
// Um campo editado perde a marca dele (o acompanhante: qualquer campo do bloco).
const EDIT_CLEARS: Record<string, string[]> = {
  companion: [ "companion.toggle", "companion.name", "companion.document", "companion.reason" ], exceptionReason: [ "exception_reason", "exception_note" ]
};

export function PassengerForm({ trip, initial, patientName, onSaved, onCancel, onRefused }: {
  trip: Trip; initial: PassengerDraft; patientName: string; onSaved(p: TripPassenger): void; onCancel(): void; onRefused?(): void;
}) {
  const [ d, setD ] = useState<PassengerDraft>(initial);
  const [ errors, setErrors ] = useState<Record<string, string>>({});
  const [ general, setGeneral ] = useState<string[]>([]);
  const [ busy, setBusy ] = useState(false);
  const ref = useRef<HTMLFormElement | null>(null);
  const focusNext = useRef(false);
  const uid = `pf-${trip.id}`;
  const id = (name: string) => `${uid}-${name.replace(/\./g, "-")}`;

  const stops = [ ...trip.stops ].sort((a, b) => a.position - b.position);
  const boardings = stops.filter((s) => s.kind === "boarding");
  const destinations = stops.filter((s) => s.kind === "destination" && s.destination_id);
  const exception = d.origin === "exception";

  // Depois de mostrar as recusas, o foco vai ao primeiro campo marcado (ou à frase do topo).
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    const first = ref.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-general='true']");
    first?.focus();
  }, [ errors, general ]);

  const PATH_OF: Record<string, string> = {
    stopId: "stop_id", destinationId: "destination_id", providerName: "provider_name", address: "address", appointmentAt: "appointment_at",
    takesSeat: "takes_seat", wheelchair: "wheelchair", exceptionNote: "exception_note"
  };
  function clear(keys: string[]) {
    const fields = keys.flatMap((k) => EDIT_CLEARS[k] ?? (PATH_OF[k] ? [ PATH_OF[k] ] : []));
    // Lotação: lugar, cadeira e acompanhante mudam a mesma conta.
    if (keys.some((k) => k === "takesSeat" || k === "companion")) fields.push("takes_seat");
    setErrors((e) => (fields.some((f) => e[f]) ? Object.fromEntries(Object.entries(e).filter(([ f ]) => !fields.includes(f))) : e));
  }
  const set = (patch: Partial<PassengerDraft>) => { clear(Object.keys(patch)); setD((x) => ({ ...x, ...patch })); };
  const setCompanion = (patch: Partial<NonNullable<PassengerDraft["companion"]>>) => {
    clear([ "companion" ]);
    setD((x) => ({ ...x, companion: x.companion ? { ...x.companion, ...patch } : x.companion }));
  };

  function show(list: { path: string; text: string }[]) {
    const byField: Record<string, string> = {};
    const top: string[] = [];
    for (const p of list) {
      const field = FIELD_OF[p.path];
      if (field && !byField[field]) byField[field] = p.text;
      else if (!field && !top.includes(p.text)) top.push(p.text);
    }
    focusNext.current = true;
    setErrors(byField); setGeneral(top);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const local = passengerProblems(d, trip);
    if (local.length > 0) { show(local); return; }
    setErrors({}); setGeneral([]); setBusy(true);
    try {
      const p = await addPassenger(trip.id, passengerBody(d));
      onSaved(p);
    } catch (err) {
      const refusals = transportRefusals(err);
      show(refusals.map((r) => {
        // TFD: o motivo não resolve — o foco vai a "Com acompanhante".
        if (r.code === "companion_not_allowed") return d.origin === "tfd" ? { path: "companion.toggle", text: TFD_COMPANION_TEXT } : { path: "companion", text: r.text };
        if (r.code === "invalid_request" && r.path === "destination_id" && d.origin === "tfd") return { path: r.path, text: TFD_DESTINATION_TEXT };
        if (r.code === "invalid_request" && r.path === "origin_id") return { path: "", text: ORIGIN_GONE_TEXT };
        return { path: r.path, text: r.text };
      }));
      if (refusals.some((r) => STALE_CODES.includes(r.code))) onRefused?.();
    } finally { setBusy(false); }
  }

  const err = (name: string) => errors[name];
  const aria = (name: string) => (err(name) ? { "aria-invalid": true as const, "aria-describedby": `${id(name)}-err` } : {});
  // Chamada simples (não componente): a frase não é recriada a cada tecla.
  const errNode = (name: string) => (err(name) ? <p key={name} id={`${id(name)}-err`} role="alert" style={alert}>{err(name)}</p> : null);

  return (
    <form ref={ref} aria-label="Passageiro" style={form} onSubmit={(e) => { void submit(e); }} noValidate>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{patientName}</p>
      <p style={muted}>{exception ? originLabel("exception") : `origem: ${originLabel(d.origin)}`}</p>
      {general.map((t) => <p key={t} role="alert" tabIndex={-1} data-general="true" style={alert}>{t}</p>)}

      <div style={row}>
        <label style={fieldLabel}>
          Parada de embarque
          <select value={d.stopId} style={inputStyle} {...aria("stop_id")} onChange={(e) => set({ stopId: e.target.value })}>
            {boardings.length === 0 && <option value="">nenhum embarque</option>}
            {boardings.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Destino
          <select value={d.destinationId} style={inputStyle} {...aria("destination_id")} onChange={(e) => set({ destinationId: e.target.value })}>
            <option value="">Escolha o destino</option>
            {destinations.map((s) => <option key={s.id} value={s.destination_id as string}>{s.label}</option>)}
          </select>
        </label>
      </div>
      {errNode("stop_id")}{errNode("destination_id")}

      <div style={row}>
        <label style={fieldLabel}>
          Prestador
          <input value={d.providerName} style={inputStyle} autoComplete="off" {...aria("provider_name")} onChange={(e) => set({ providerName: e.target.value })} />
        </label>
        <label style={fieldLabel}>
          Endereço
          <input value={d.address} style={inputStyle} autoComplete="off" {...aria("address")} onChange={(e) => set({ address: e.target.value })} />
        </label>
        <label style={fieldLabel}>
          Hora do atendimento
          <input type="datetime-local" value={d.appointmentAt} style={inputStyle} {...aria("appointment_at")} onChange={(e) => set({ appointmentAt: e.target.value })} />
        </label>
      </div>
      {errNode("provider_name")}{errNode("address")}{errNode("appointment_at")}

      {exception && (
        <fieldset style={fieldset}>
          <legend style={legend}>Sem atendimento marcado</legend>
          <label style={fieldLabel}>
            Motivo da viagem sem atendimento
            <select value={d.exceptionReason} style={inputStyle} {...aria("exception_reason")} onChange={(e) => set(e.target.value === "other" ? { exceptionReason: e.target.value } : { exceptionReason: e.target.value, exceptionNote: "" })}>
              <option value="">Escolha o motivo</option>
              {EXCEPTION_REASONS.map((r) => <option key={r} value={r}>{exceptionReasonLabel(r)}</option>)}
            </select>
          </label>
          {errNode("exception_reason")}
          {d.exceptionReason === "other" && (
            <label style={fieldLabel}>
              Descreva o motivo
              <textarea value={d.exceptionNote} rows={2} style={inputStyle} {...aria("exception_note")} onChange={(e) => set({ exceptionNote: e.target.value })} />
            </label>
          )}
          {errNode("exception_note")}
        </fieldset>
      )}

      <div style={row}>
        <label style={checkLabel}>
          <input type="checkbox" checked={d.takesSeat} {...aria("takes_seat")} onChange={(e) => set({ takesSeat: e.target.checked })} />Ocupa lugar
        </label>
        <label style={checkLabel}>
          <input type="checkbox" checked={d.wheelchair} {...aria("wheelchair")} onChange={(e) => set({ wheelchair: e.target.checked })} />Cadeira de rodas
        </label>
        <label style={checkLabel}>
          <input type="checkbox" checked={d.companion !== null} {...aria("companion.toggle")}
            onChange={(e) => set({ companion: e.target.checked ? { name: "", document: "", reason: "" } : null })} />Com acompanhante
        </label>
      </div>
      {errNode("takes_seat")}{errNode("wheelchair")}{errNode("companion.toggle")}

      {d.companion && (
        <fieldset style={fieldset}>
          <legend style={legend}>Acompanhante</legend>
          <div style={row}>
            <label style={fieldLabel}>
              Nome do acompanhante
              <input value={d.companion.name} style={inputStyle} autoComplete="off" {...aria("companion.name")} onChange={(e) => setCompanion({ name: e.target.value })} />
            </label>
            <label style={fieldLabel}>
              Documento do acompanhante
              <input value={d.companion.document} style={inputStyle} autoComplete="off" {...aria("companion.document")} onChange={(e) => setCompanion({ document: e.target.value })} />
            </label>
          </div>
          {errNode("companion.name")}{errNode("companion.document")}
          <label style={fieldLabel}>
            Motivo do acompanhante
            <textarea value={d.companion.reason} rows={2} style={inputStyle} {...aria("companion.reason")} onChange={(e) => setCompanion({ reason: e.target.value })} />
          </label>
          <p style={muted}>Só é preciso quando o paciente não é criança nem idoso pela regra da cidade.</p>
          {errNode("companion.reason")}
        </fieldset>
      )}

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Pôr na viagem</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
