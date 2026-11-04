// Série recorrente (módulo 30, F-30.3): paciente (só ao criar; a busca é a do passageiro), destino, dias ISO 1–7, horários de atendimento,
// saída e volta, embarque, período, cadeira e acompanhante. O api exige volta e embarque; a tela confere tudo antes (`seriesProblems`) e põe
// cada recusa no campo do `path`. A edição manda um PATCH montado campo a campo, sem `patient_id`. Nada clínico.
import { useState } from "react";
import { createSeries, updateSeries, type SeriesUpdate, type TransportDestination, type TransportSeries } from "../../lib/api";
import { seriesBody, seriesProblems, transportRefusals, type SeriesDraft } from "../../lib/transport";
import { cityIsoDate } from "../../lib/format";
import { fieldset, legend, muted, row, alert } from "../exams/styles";
import { CheckField, FleetForm, SelectField, TextField, problemsToErrors, routeRefusals, type FieldErrors } from "./fleetForm";
import { TransportPersonPick } from "./TransportPersonPick";

const DAYS: [ number, string ][] = [ [ 1, "seg" ], [ 2, "ter" ], [ 3, "qua" ], [ 4, "qui" ], [ 5, "sex" ], [ 6, "sáb" ], [ 7, "dom" ] ];
const FIELDS = [
  "patient_id", "destination_id", "provider_name", "weekdays", "appointment_time", "departure_time", "return_time", "boarding_label", "starts_on",
  "ends_on", "wheelchair", "companion.name", "companion.document", "companion.reason"
] as const;

function draftFrom(s: TransportSeries | undefined, today: string): SeriesDraft {
  if (!s) {
    return { patientId: "", destinationId: "", providerName: "", weekdays: [], appointmentTime: "", departureTime: "", returnTime: "", boardingLabel: "",
      startsOn: today, endsOn: "", wheelchair: false, companion: null };
  }
  return {
    patientId: s.patient.id, destinationId: s.destination.id, providerName: s.provider_name ?? "", weekdays: [ ...s.weekdays ],
    appointmentTime: s.appointment_time, departureTime: s.departure_time, returnTime: s.return_time, boardingLabel: s.boarding_label,
    startsOn: s.starts_on, endsOn: s.ends_on ?? "", wheelchair: s.wheelchair,
    companion: s.companion ? { name: s.companion.name, document: "", reason: "" } : null
  };
}

// PATCH campo a campo: o api recusa chave desconhecida e o paciente da série não muda.
// `companion` só vai se a pessoa mexeu nele: ausente = o api mantém o atual (o documento e o motivo guardados não voltam ao navegador).
function updateBody(d: SeriesDraft, companionTouched: boolean): SeriesUpdate {
  const b = seriesBody(d);
  return {
    destination_id: b.destination_id, provider_name: b.provider_name, weekdays: b.weekdays, appointment_time: b.appointment_time,
    departure_time: b.departure_time, return_time: b.return_time, boarding_label: b.boarding_label, starts_on: b.starts_on, ends_on: b.ends_on,
    wheelchair: b.wheelchair, ...(companionTouched ? { companion: b.companion } : {})
  };
}

export function SeriesForm({ series, destinations, today, onSaved, onCancel }: {
  series?: TransportSeries; destinations: TransportDestination[]; today?: string; onSaved(s: TransportSeries): void; onCancel(): void;
}) {
  const [ d, setD ] = useState<SeriesDraft>(() => draftFrom(series, today ?? cityIsoDate()));
  const [ patientName, setPatientName ] = useState<string | null>(series?.patient.display_name ?? null);
  const [ errors, setErrors ] = useState<FieldErrors>({});
  const [ general, setGeneral ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ companionTouched, setCompanionTouched ] = useState(false);
  const set = (patch: Partial<SeriesDraft>) => setD((x) => ({ ...x, ...patch }));
  const setCompanion = (patch: Partial<NonNullable<SeriesDraft["companion"]>>) => { setCompanionTouched(true); setD((x) => ({ ...x, companion: x.companion ? { ...x.companion, ...patch } : x.companion })); };

  // Criar: primeiro a pessoa (a busca fica fora do formulário); editar: o paciente já está fixo.
  if (!series && d.patientId === "") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={muted}>Busque o paciente da série.</p>
        <TransportPersonPick onPick={(id, name) => { setPatientName(name); set({ patientId: id }); }} onCancel={onCancel} />
      </div>
    );
  }

  async function save() {
    const problems = seriesProblems(d, today ?? cityIsoDate());
    if (problems.length > 0) { setErrors(problemsToErrors(problems)); setGeneral(null); return; }
    setErrors({}); setGeneral(null); setBusy(true);
    try {
      onSaved(series ? await updateSeries(series.id, updateBody(d, companionTouched)) : await createSeries(seriesBody(d)));
    } catch (err) {
      // Regra de idade do acompanhante: a frase pede o motivo e o foco vai a ele.
      const refusals = transportRefusals(err).map((r) => (r.path === "companion" ? { ...r, path: "companion.reason" } : r));
      const routed = routeRefusals(refusals, FIELDS);
      setErrors(routed.fields); setGeneral(routed.general);
    } finally { setBusy(false); }
  }

  const active = destinations.filter((x) => x.active || x.id === d.destinationId);
  const toggleDay = (n: number, on: boolean) => set({ weekdays: on ? [ ...d.weekdays, n ] : d.weekdays.filter((x) => x !== n) });

  return (
    <FleetForm label="Série recorrente" busy={busy} general={general} onSubmit={() => { void save(); }} onCancel={onCancel}>
      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{patientName ?? "paciente escolhido"}</p>
      <SelectField id="ser-dest" label="Destino" value={d.destinationId} error={errors.destination_id} blank="Escolha o destino"
        options={active.map((x): [ string, string ] => [ x.id, x.name ])} onChange={(v) => set({ destinationId: v })} />
      <TextField id="ser-provider" label="Prestador" value={d.providerName} error={errors.provider_name} autoComplete="off" onChange={(v) => set({ providerName: v })} />
      <fieldset style={fieldset} aria-describedby={errors.weekdays ? "ser-days-err" : undefined}>
        <legend style={legend}>Dias da semana</legend>
        <div style={row}>
          {DAYS.map(([ n, name ]) => <CheckField key={n} id={`ser-day-${n}`} label={name} checked={d.weekdays.includes(n)} onChange={(on) => toggleDay(n, on)} />)}
        </div>
        {errors.weekdays && <p id="ser-days-err" role="alert" style={alert}>{errors.weekdays}</p>}
      </fieldset>
      <div style={row}>
        <TextField id="ser-appt" label="Horário do atendimento" type="time" value={d.appointmentTime} error={errors.appointment_time} onChange={(v) => set({ appointmentTime: v })} />
        <TextField id="ser-dep" label="Horário de saída" type="time" value={d.departureTime} error={errors.departure_time} onChange={(v) => set({ departureTime: v })} />
        <TextField id="ser-ret" label="Horário de volta" type="time" value={d.returnTime} error={errors.return_time} onChange={(v) => set({ returnTime: v })} />
      </div>
      <TextField id="ser-boarding" label="Embarque" value={d.boardingLabel} error={errors.boarding_label} autoComplete="off"
        hint="Ponto onde o paciente embarca (3 a 120 caracteres)." onChange={(v) => set({ boardingLabel: v })} />
      <div style={row}>
        <TextField id="ser-start" label="Início" type="date" value={d.startsOn} error={errors.starts_on} onChange={(v) => set({ startsOn: v })} />
        <TextField id="ser-end" label="Fim" type="date" value={d.endsOn} error={errors.ends_on} hint="Deixe em branco para uma série sem fim." onChange={(v) => set({ endsOn: v })} />
      </div>
      <CheckField id="ser-wheelchair" label="Cadeira de rodas" checked={d.wheelchair} onChange={(v) => set({ wheelchair: v })} />
      <CheckField id="ser-comp" label="Com acompanhante" checked={d.companion !== null}
        onChange={(v) => { setCompanionTouched(true); set({ companion: v ? { name: "", document: "", reason: "" } : null }); }} />
      {d.companion && (
        <fieldset style={fieldset}>
          <legend style={legend}>Acompanhante</legend>
          <TextField id="ser-comp-name" label="Nome do acompanhante" value={d.companion.name} error={errors["companion.name"]} autoComplete="off" onChange={(v) => setCompanion({ name: v })} />
          <TextField id="ser-comp-doc" label="Documento do acompanhante" value={d.companion.document} error={errors["companion.document"]} autoComplete="off"
            hint={series?.companion && companionTouched ? "Ao mudar o acompanhante, ele é substituído: informe de novo o documento e o motivo." : undefined}
            onChange={(v) => setCompanion({ document: v })} />
          <TextField id="ser-comp-reason" label="Motivo do acompanhante" value={d.companion.reason} error={errors["companion.reason"]} onChange={(v) => setCompanion({ reason: v })}
            hint="Só é preciso quando o paciente não é criança nem idoso pela regra da cidade." />
        </fieldset>
      )}
    </FleetForm>
  );
}
