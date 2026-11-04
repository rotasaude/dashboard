// Formulário da viagem (módulo 30, F-30.2): criar e editar. Confere o formulário inteiro antes de enviar (tripProblems, que já inclui a CNH na
// data da viagem e a categoria para veículo com mais de 8 lugares) e mostra todas as recusas do api no campo do `path` (sobreposição de veículo e
// motorista, dia travado por série ou TFD, parada com passageiro). Na edição cada linha de embarque guarda o `id` da parada: renomear não vira
// parada nova (que o api recusaria com `stop_in_use`); destino mantém o `id` enquanto o destino da linha não muda.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createTrip, updateTrip, type TransportDestination, type TransportDriver, type TransportVehicle, type Trip } from "../../lib/api";
import { newTripDraft, tripBody, tripDraftFrom, tripProblems, transportRefusals, type TripDraft } from "../../lib/transport";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

type FieldErrors = Record<string, string>;
interface BoardingRow { key: number; stopId: string | null; label: string }
interface DestinationRow { key: number; stopId: string | null; originalDestinationId: string | null; destinationId: string }

const FIELDS = [ "date", "departure_at", "return_at", "vehicle_id", "driver_id", "boarding", "destinations", "stops" ];

// `stops.0.label` e afins caem no bloco das paradas; o que não tem campo vai para o aviso geral.
function fieldOf(path: string): string {
  if (/^stops(\.|$)/.test(path)) return "stops";
  return FIELDS.includes(path) ? path : "";
}

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Vencido aparece marcado e não pode ser escolhido; a vencer, com o aviso. Inativo só aparece se já for o desta viagem.
function driverOption(d: TransportDriver): { text: string; disabled: boolean } {
  const name = d.user.name;
  if (!d.active) return { text: `${name} (inativo)`, disabled: true };
  if (d.license_status === "expired") return { text: `${name} (CNH vencida)`, disabled: true };
  if (d.license_status === "expiring") return { text: `${name} (CNH vence em ${fmtDay(d.license_expires_on)})`, disabled: false };
  return { text: name, disabled: false };
}

let rowKey = 0;
const nextKey = () => ++rowKey;

function initialRows(trip: Trip | undefined): { boarding: BoardingRow[]; destinations: DestinationRow[] } {
  if (!trip) return { boarding: [ { key: nextKey(), stopId: null, label: "" } ], destinations: [ { key: nextKey(), stopId: null, originalDestinationId: null, destinationId: "" } ] };
  const stops = [ ...trip.stops ].sort((a, b) => a.position - b.position);
  const boarding = stops.filter((s) => s.kind === "boarding").map((s) => ({ key: nextKey(), stopId: s.id, label: s.label }));
  const destinations = stops.filter((s) => s.kind === "destination")
    .map((s) => ({ key: nextKey(), stopId: s.id, originalDestinationId: s.destination_id, destinationId: s.destination_id ?? "" }));
  return {
    boarding: boarding.length > 0 ? boarding : [ { key: nextKey(), stopId: null, label: "" } ],
    destinations: destinations.length > 0 ? destinations : [ { key: nextKey(), stopId: null, originalDestinationId: null, destinationId: "" } ]
  };
}

function Err({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} role="alert" style={alert}>{text}</p> : null;
}

export function TripForm({ trip, date, vehicles, drivers, destinations, onSaved, onCancel, onRefused }: {
  trip?: Trip; date: string; vehicles: TransportVehicle[]; drivers: TransportDriver[]; destinations: TransportDestination[];
  onSaved(t: Trip): void; onCancel(): void; onRefused?(): void;
}) {
  const [ head, setHead ] = useState<Omit<TripDraft, "boarding" | "destinationIds">>(() => {
    const { boarding: _b, destinationIds: _d, ...rest } = trip ? tripDraftFrom(trip) : newTripDraft(date);
    return rest;
  });
  const [ rows, setRows ] = useState(() => initialRows(trip));
  const [ errors, setErrors ] = useState<FieldErrors>({});
  const [ general, setGeneral ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const ref = useRef<HTMLFormElement | null>(null);
  const uid = trip?.id ?? "new";
  const id = (name: string) => `trip-${uid}-${name}`;

  useEffect(() => { ref.current?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled])")?.focus(); }, []);

  const set = (patch: Partial<typeof head>) => setHead((h) => ({ ...h, ...patch }));
  // Trocar o dia leva junto o dia do retorno quando ele era o mesmo.
  const setDay = (day: string) => setHead((h) => ({ ...h, date: day, returnDate: h.returnDate === h.date ? day : h.returnDate }));

  const draft: TripDraft = { ...head, boarding: rows.boarding.map((b) => b.label), destinationIds: rows.destinations.map((d) => d.destinationId) };

  // Veículos ativos; o desta viagem fica na lista mesmo inativo, marcado (o api recusa ao confirmar).
  const vehicleOptions = vehicles.filter((v) => v.active || v.id === head.vehicleId);
  const driverOptions = drivers.filter((d) => d.active || d.id === head.driverId);
  const destinationOptions = destinations.filter((d) => d.active || rows.destinations.some((r) => r.destinationId === d.id));

  function body() {
    const base = tripBody(draft, undefined, { edit: !!trip });
    const boarding = rows.boarding.filter((b) => b.label.trim() !== "");
    const dests = rows.destinations.filter((d) => d.destinationId !== "");
    let bi = 0;
    let di = 0;
    const stops = base.stops.map((s) => {
      if (s.kind === "boarding") {
        const r = boarding[bi++];
        return r?.stopId ? { id: r.stopId, ...s } : s;
      }
      const r = dests[di++];
      return r?.stopId && r.originalDestinationId === s.destination_id ? { id: r.stopId, ...s } : s;
    });
    return { ...base, stops };
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problems = tripProblems(draft, { vehicles, drivers, confirm: trip?.status === "confirmed" });
    if (problems.length > 0) {
      const out: FieldErrors = {};
      problems.forEach((p) => { if (out[p.path] === undefined) out[p.path] = p.text; });
      setErrors(out); setGeneral(null);
      return;
    }
    setErrors({}); setGeneral(null); setBusy(true);
    try {
      const saved = trip ? await updateTrip(trip.id, body()) : await createTrip(body());
      onSaved(saved);
    } catch (err) {
      const out: FieldErrors = {};
      const rest: string[] = [];
      transportRefusals(err).forEach((r) => {
        const f = fieldOf(r.path);
        if (f !== "" && out[f] === undefined) out[f] = r.text;
        else if (f === "" && !rest.includes(r.text)) rest.push(r.text);
      });
      setErrors(out); setGeneral(rest.length > 0 ? rest.join("; ") : null);
      onRefused?.();
    } finally { setBusy(false); }
  }

  const described = (name: string, extra?: string) => [ extra, errors[name] ? id(`${name}-err`) : "" ].filter(Boolean).join(" ") || undefined;
  const invalid = (name: string) => (errors[name] ? true : undefined);

  const input = (name: string, label: string, type: string, value: string, onChange: (v: string) => void, field = name) => (
    <div style={fieldLabel}>
      <label htmlFor={id(name)}>{label}</label>
      <input id={id(name)} type={type} value={value} style={inputStyle} aria-invalid={invalid(field)} aria-describedby={described(field)}
        onChange={(e) => onChange(e.target.value)} />
      <Err id={id(`${field}-err`)} text={errors[field]} />
    </div>
  );

  return (
    <form ref={ref} aria-label="Viagem" noValidate style={box} onSubmit={(e) => { void submit(e); }}>
      <div style={form}>
        {input("date", "Dia da viagem", "date", head.date, setDay)}
        {input("departure", "Saída", "time", head.departureTime, (v) => set({ departureTime: v }), "departure_at")}
        <div style={fieldLabel}>
          <label htmlFor={id("return-date")}>Data do retorno</label>
          <input id={id("return-date")} type="date" value={head.returnDate} style={inputStyle} aria-invalid={invalid("return_at")}
            aria-describedby={described("return_at")} onChange={(e) => set({ returnDate: e.target.value })} />
        </div>
        {input("return", "Retorno", "time", head.returnTime, (v) => set({ returnTime: v }), "return_at")}
        <div style={fieldLabel}>
          <label htmlFor={id("vehicle")}>Veículo</label>
          <select id={id("vehicle")} value={head.vehicleId} style={inputStyle} aria-invalid={invalid("vehicle_id")} aria-describedby={described("vehicle_id")}
            onChange={(e) => set({ vehicleId: e.target.value })}>
            <option value="">Sem veículo por enquanto</option>
            {vehicleOptions.map((v) => (
              <option key={v.id} value={v.id}>{`${v.plate} · ${v.model} · ${v.seats} lugares${v.active ? "" : " (inativo)"}`}</option>
            ))}
          </select>
          <Err id={id("vehicle_id-err")} text={errors.vehicle_id} />
        </div>
        <div style={fieldLabel}>
          <label htmlFor={id("driver")}>Motorista</label>
          <select id={id("driver")} value={head.driverId} style={inputStyle} aria-invalid={invalid("driver_id")} aria-describedby={described("driver_id")}
            onChange={(e) => set({ driverId: e.target.value })}>
            <option value="">Sem motorista por enquanto</option>
            {driverOptions.map((d) => {
              const o = driverOption(d);
              return <option key={d.id} value={d.id} disabled={o.disabled}>{o.text}</option>;
            })}
          </select>
          <Err id={id("driver_id-err")} text={errors.driver_id} />
        </div>

        <fieldset style={fieldset} aria-describedby={described("boarding", errors.stops ? id("stops-err") : undefined)}>
          <legend style={legend}>Embarques</legend>
          {rows.boarding.map((b, i) => (
            <div key={b.key} style={row}>
              <div style={{ ...fieldLabel, flex: 1 }}>
                <label htmlFor={id(`boarding-${b.key}`)}>{`Embarque ${i + 1}`}</label>
                <input id={id(`boarding-${b.key}`)} value={b.label} style={inputStyle} aria-invalid={invalid("boarding")}
                  onChange={(e) => { const v = e.target.value; setRows((r) => ({ ...r, boarding: r.boarding.map((x) => (x.key === b.key ? { ...x, label: v } : x)) })); }} />
              </div>
              <button type="button" style={secondaryButtonStyle} disabled={rows.boarding.length === 1} aria-label={`Remover embarque ${i + 1}`}
                onClick={() => setRows((r) => ({ ...r, boarding: r.boarding.filter((x) => x.key !== b.key) }))}>Remover</button>
            </div>
          ))}
          <div style={row}>
            <button type="button" style={secondaryButtonStyle}
              onClick={() => setRows((r) => ({ ...r, boarding: [ ...r.boarding, { key: nextKey(), stopId: null, label: "" } ] }))}>Adicionar embarque</button>
          </div>
          <Err id={id("boarding-err")} text={errors.boarding} />
        </fieldset>

        <fieldset style={fieldset} aria-describedby={described("destinations")}>
          <legend style={legend}>Destinos</legend>
          {rows.destinations.map((d, i) => (
            <div key={d.key} style={row}>
              <div style={{ ...fieldLabel, flex: 1 }}>
                <label htmlFor={id(`dest-${d.key}`)}>{`Destino ${i + 1}`}</label>
                <select id={id(`dest-${d.key}`)} value={d.destinationId} style={inputStyle} aria-invalid={invalid("destinations")}
                  onChange={(e) => { const v = e.target.value; setRows((r) => ({ ...r, destinations: r.destinations.map((x) => (x.key === d.key ? { ...x, destinationId: v } : x)) })); }}>
                  <option value="">escolha…</option>
                  {destinationOptions.map((o) => <option key={o.id} value={o.id}>{o.active ? o.name : `${o.name} (inativo)`}</option>)}
                </select>
              </div>
              <button type="button" style={secondaryButtonStyle} disabled={rows.destinations.length === 1} aria-label={`Remover destino ${i + 1}`}
                onClick={() => setRows((r) => ({ ...r, destinations: r.destinations.filter((x) => x.key !== d.key) }))}>Remover</button>
            </div>
          ))}
          <div style={row}>
            <button type="button" style={secondaryButtonStyle}
              onClick={() => setRows((r) => ({ ...r, destinations: [ ...r.destinations, { key: nextKey(), stopId: null, originalDestinationId: null, destinationId: "" } ] }))}>
              Adicionar destino
            </button>
          </div>
          <Err id={id("destinations-err")} text={errors.destinations} />
        </fieldset>
        <Err id={id("stops-err")} text={errors.stops} />
        {trip && <p style={muted}>Parada que já teve passageiro não pode ser removida; mudar só o horário é sempre possível.</p>}
      </div>
      {general && <p role="alert" style={alert}>{general}</p>}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Salvar</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
