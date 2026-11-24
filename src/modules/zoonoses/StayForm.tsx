// src/modules/zoonoses/StayForm.tsx
// Entrada e saída do canil e gatil (módulo 35b, F-35.16). Entrada: animal cadastrado (buscado) ou "animal sem cadastro" (criado sem
// tutor e sem domicílio); a entrada por observação exige escolher uma observação aberta, que passa a correr no canil (Q16). Saída:
// "Adotado" pede o adotante (PersonLookup; o api o faz tutor), devolução exige tutor e a eutanásia exige a eutanásia gravada
// (`stayExitProblems`, antes do envio). Toda escrita: um envio; 409 → a frase, UMA releitura (quem chama), nenhum reenvio.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  enterShelter, exitShelter, listObservations, type Animal, type AnimalHistory, type AnimalSex, type AnimalSize, type AnimalSpecies, type ShelterEntryKind, type ShelterExitKind, type ShelterEntry, type ShelterEntryInput, type ShelterStay,
  type ZooPerson
} from "../../lib/api";
import { fmtDay } from "../../lib/homeVisits";
import type { Problem } from "../../lib/pharmacy";
import type { PsyRefusal } from "../../lib/psychosocial";
import { STATIC_QUERY, ZOO_OBSERVATIONS_KEY, animalProblems, isZoonosesStale, stayExitProblems, zooLabel, zoonosesRefusals } from "../../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../../lib/zoonosesErrors";
import { SegmentedControl } from "../../shell/SegmentedControl";
import { ActionButton } from "../../components/ActionButton";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { box, fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { AnimalSearch } from "./AnimalSearch";
import { PersonLookup } from "./PersonLookup";
import { useZooDomains } from "./useZooDomains";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const refusals = (err: unknown): PsyRefusal[] => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null }));
const staleOptions = { refusals, isStale: (err: unknown) => isZoonosesStale(err) };
const fixed = (list: { path: string; text: string }[]): Problem[] => list.map(({ path, text }) => ({ path, text }));

export const NO_OPEN_OBSERVATION = "nenhuma observação aberta para ligar à entrada";
export const OBSERVATION_MOVES = "A observação passa a correr no canil.";

type Mode = "registered" | "new";
const MODES: { key: Mode; label: string }[] = [ { key: "registered", label: "Animal cadastrado" }, { key: "new", label: "Animal sem cadastro" } ];
const OWN = [ "animal_id", "species", "sex", "size", "coat", "breed", "entry_kind", "entered_on", "bite_observation_id" ];

// Entrada. `unit` é a unidade de vigilância ambiental escolhida na tela.
export function StayForm({ unit, today, onEntered, onStale, onCancel }: {
  unit: { id: string; name: string }; today: string; onEntered(entry: ShelterEntry): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems(staleOptions);
  const [ mode, setMode ] = useState<Mode>("registered");
  const [ found, setFound ] = useState<Animal | null>(null);
  const [ species, setSpecies ] = useState("");
  const [ sex, setSex ] = useState("");
  const [ size, setSize ] = useState("");
  const [ coat, setCoat ] = useState("");
  const [ breed, setBreed ] = useState("");
  const [ kind, setKind ] = useState("");
  const [ enteredOn, setEnteredOn ] = useState(today);
  const [ observationId, setObservationId ] = useState("");
  const busy = f.busy;
  const byObservation = kind === "observation";
  // Filas sem pessoa: só ids, espécie e datas (nada de tutor nem paciente).
  const open = useQuery({ queryKey: [ ZOO_OBSERVATIONS_KEY, "pickable" ], queryFn: () => listObservations({ state: "open" }), ...STATIC_QUERY, enabled: byObservation });
  // Uma observação que já tem outro animal não serve a este (o api responde 409 observation_changed).
  const observations = (open.data?.items ?? []).filter((o) => o.animal_id === null || o.animal_id === found?.id);

  function check(): Problem[] {
    const out: Problem[] = [];
    if (mode === "registered") {
      if (!found) out.push({ path: "animal_id", text: "busque e escolha o animal" });
      else if (found.status === "transferred" || found.status === "deceased") out.push({ path: "animal_id", text: ZOONOSES_ERRORS.animal_not_active });
    } else {
      out.push(...fixed(animalProblems({
        species, name: "", sex, size, coat, breed, birthEstimateOn: "", microchip: "", registryNumber: "", householdId: null, tutorId: null, community: false
      })));
    }
    if (!kind) out.push({ path: "entry_kind", text: "escolha o tipo de entrada" });
    if (!DATE.test(enteredOn)) out.push({ path: "entered_on", text: "informe a data da entrada" });
    else if (enteredOn > today) out.push({ path: "entered_on", text: ZOONOSES_ERRORS.date_out_of_range });
    if (byObservation && !observationId) out.push({ path: "bite_observation_id", text: "escolha a observação aberta" });
    return out;
  }
  function body(): ShelterEntryInput {
    const base: ShelterEntryInput = { health_unit_id: unit.id, entry_kind: kind as ShelterEntryKind, entered_on: enteredOn };
    if (byObservation) base.bite_observation_id = observationId;
    if (mode === "registered") return { ...base, animal_id: found!.id };
    return {
      ...base,
      new_animal: {
        species: species as AnimalSpecies, sex: sex as AnimalSex, community: false,
        ...(size ? { size: size as AnimalSize } : {}), ...(coat.trim() ? { coat: coat.trim() } : {}), ...(breed.trim() ? { breed: breed.trim() } : {})
      }
    };
  }
  const submit = (ev: React.FormEvent) => void f.submit(ev, { check, call: () => enterShelter(body()), ok: onEntered, stale: onStale });

  const select = (path: string, label: string, value: string, set: (v: string) => void, options: { code: string; label: string }[] | undefined) => (
    <>
      <label style={fieldLabel}>
        {label}
        <select value={value} disabled={busy} style={inputStyle} {...f.aria(path)} onChange={(e) => { set(e.target.value); f.clear(path); }}>
          <option value="">escolha</option>
          {(options ?? []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </label>
      {f.errNode(path)}
    </>
  );

  return (
    <div style={form}>
      <SegmentedControl<Mode> options={MODES} value={mode} onChange={(m) => { if (!busy) { setMode(m); setFound(null); setObservationId(""); f.setProblems([]); } }} />
      {mode === "registered" && !found && <div style={box}><AnimalSearch onOpen={(_id, a) => { setFound(a); setObservationId(""); f.clear("animal_id"); }} /></div>}
      <form ref={f.formRef} noValidate style={{ ...form, ...box }} aria-label="Entrada no canil" onSubmit={submit}>
        <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Entrada em {unit.name}</p>
        {mode === "registered" ? (
          <>
            {found ? (
              <div style={row}>
                <span>{found.name ?? "sem nome"} · {zooLabel(domains?.species, found.species)}</span>
                <ActionButton variant="secondary" onClick={() => { if (!busy) { setFound(null); setObservationId(""); } }}>Trocar animal</ActionButton>
              </div>
            ) : <p style={muted}>busque o animal acima</p>}
            {f.errNode("animal_id")}
          </>
        ) : (
          <>
            <p style={muted}>O animal é criado sem tutor e sem domicílio.</p>
            {select("species", "Espécie", species, setSpecies, domains?.species)}
            {select("sex", "Sexo", sex, setSex, domains?.sexes)}
            {select("size", "Porte", size, setSize, domains?.sizes)}
            <label style={fieldLabel}>
              Pelagem
              <input value={coat} disabled={busy} style={inputStyle} {...f.aria("coat")} onChange={(e) => { setCoat(e.target.value); f.clear("coat"); }} />
            </label>
            {f.errNode("coat")}
            <label style={fieldLabel}>
              Raça
              <input value={breed} disabled={busy} style={inputStyle} {...f.aria("breed")} onChange={(e) => { setBreed(e.target.value); f.clear("breed"); }} />
            </label>
            {f.errNode("breed")}
          </>
        )}
        {select("entry_kind", "Tipo de entrada", kind, (v) => { setKind(v); setObservationId(""); }, domains?.entry_kinds)}
        {byObservation && (
          <>
            <label style={fieldLabel}>
              Observação aberta
              <select value={observationId} disabled={busy} style={inputStyle} {...f.aria("bite_observation_id")}
                onChange={(e) => { setObservationId(e.target.value); f.clear("bite_observation_id"); }}>
                <option value="">escolha</option>
                {observations.map((o) => (
                  <option key={o.id} value={o.id}>{zooLabel(domains?.species, o.species)} · exposição {fmtDay(o.exposure_on)} · até {fmtDay(o.ends_on)}</option>
                ))}
              </select>
            </label>
            {open.data && observations.length === 0 && <p style={muted}>{NO_OPEN_OBSERVATION}</p>}
            {f.errNode("bite_observation_id")}
            <p style={muted}>{OBSERVATION_MOVES}</p>
          </>
        )}
        <label style={fieldLabel}>
          Data da entrada
          <input type="date" value={enteredOn} disabled={busy} style={inputStyle} {...f.aria("entered_on")}
            onChange={(e) => { setEnteredOn(e.target.value); f.clear("entered_on"); }} />
        </label>
        {f.errNode("entered_on")}
        {f.top((p) => OWN.includes(p))}
        <div style={row}>
          <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Registrar entrada</button>
          <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// Saída: tipo e data (entre a entrada e hoje); "Adotado" pede o adotante, que vira o tutor. `expected_version` da estada lida.
export function ExitForm({ stay, animal, today, onExited, onStale, onCancel }: {
  stay: ShelterStay; animal: AnimalHistory; today: string; onExited(s: ShelterStay): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems(staleOptions);
  const [ kind, setKind ] = useState("");
  const [ exitedOn, setExitedOn ] = useState(today);
  const [ adopter, setAdopter ] = useState<ZooPerson | null>(null);
  const busy = f.busy;
  const adopted = kind === "adopted";

  function check(): Problem[] {
    const out = fixed(stayExitProblems({ exitKind: kind || null, adopterId: adopter?.patient.id ?? null }, { tutor: animal.has_tutor, euthanized: animal.euthanasia !== null }));
    if (!DATE.test(exitedOn)) out.push({ path: "exited_on", text: "informe a data da saída" });
    else if (exitedOn > today || exitedOn < stay.entered_on) out.push({ path: "exited_on", text: ZOONOSES_ERRORS.date_out_of_range });
    return out;
  }
  const call = () => exitShelter(stay.id, {
    exit_kind: kind as ShelterExitKind, exited_on: exitedOn, expected_version: stay.version,
    ...(adopted && adopter ? { adopter_patient_id: adopter.patient.id } : {})
  });
  const submit = (ev: React.FormEvent) => void f.submit(ev, { check, call, ok: onExited, stale: onStale });

  return (
    <form ref={f.formRef} noValidate style={{ ...form, ...box }} aria-label="Saída do canil" onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Saída do canil</p>
      <label style={fieldLabel}>
        Tipo de saída
        <select value={kind} disabled={busy} style={inputStyle} {...f.aria("exit_kind")}
          onChange={(e) => { setKind(e.target.value); if (e.target.value !== "adopted") setAdopter(null); f.clear("exit_kind", "adopter_patient_id"); }}>
          <option value="">escolha</option>
          {(domains?.exit_kinds ?? []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </label>
      {f.errNode("exit_kind")}
      {adopted && (
        <>
          <PersonLookup value={adopter} onChange={(p) => { setAdopter(p); f.clear("adopter_patient_id"); }} label="Adotante" />
          {f.errNode("adopter_patient_id")}
          <p style={muted}>O adotante passa a ser o tutor do animal.</p>
        </>
      )}
      <label style={fieldLabel}>
        Data da saída
        <input type="date" value={exitedOn} disabled={busy} style={inputStyle} {...f.aria("exited_on")}
          onChange={(e) => { setExitedOn(e.target.value); f.clear("exited_on"); }} />
      </label>
      {f.errNode("exited_on")}
      {f.top((p) => [ "exit_kind", "adopter_patient_id", "exited_on" ].includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Registrar saída</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
