// src/modules/zoonoses/AnimalSearch.tsx
// Busca de animal (módulo 35b, F-35.11): microchip, registro, tutor ou domicílio. Microchip e registro vão direto ao api (sem
// useQuery e sem chave de cache com o número) e o resultado fica só no estado local; o tutor nunca aparece na lista (só nome,
// espécie e situação). Tutor e domicílio vêm de uma pessoa achada por documento (PersonLookup); o domicílio é o do cadastro
// individual dela (Q25).
import { useState } from "react";
import { searchAnimals, type Animal, type AnimalSearch as SearchBody, type ZooPerson } from "../../lib/api";
import { animalDisplayName, zooLabel, zoonosesError } from "../../lib/zoonoses";
import { SegmentedControl } from "../../shell/SegmentedControl";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, list, muted, panel, row } from "../exams/styles";
import { NO_HOUSEHOLD, PersonLookup } from "./PersonLookup";
import { useZooDomains } from "./useZooDomains";

type Mode = "microchip" | "registry" | "tutor" | "household";
const MODES: { key: Mode; label: string }[] = [
  { key: "microchip", label: "Microchip" }, { key: "registry", label: "Registro" }, { key: "tutor", label: "Tutor" }, { key: "household", label: "Domicílio" }
];
export const NO_ANIMAL = "nenhum animal com este dado";

export function AnimalSearch({ onOpen }: { onOpen(id: string, animal: Animal): void }) {
  const domains = useZooDomains().data;
  const [ mode, setMode ] = useState<Mode>("microchip");
  const [ text, setText ] = useState("");
  const [ person, setPerson ] = useState<ZooPerson | null>(null);
  const [ items, setItems ] = useState<Animal[] | null>(null);
  const [ more, setMore ] = useState<string | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  const reset = () => { setItems(null); setMore(null); setProblem(null); };

  async function run(body: SearchBody, append: boolean) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await searchAnimals(body);
      setItems((prev) => (append && prev ? [ ...prev, ...r.items ] : r.items));
      setMore(r.next_before);
    } catch (err) {
      setProblem(zoonosesError(err));
    } finally {
      setBusy(false);
    }
  }

  function byNumber() {
    const v = text.trim();
    if (mode === "microchip") {
      if (!/^\d{15}$/.test(v)) { setProblem("microchip: 15 dígitos, sem espaço"); return; }
      void run({ microchip: v }, false);
    } else {
      if ([ ...v ].length < 1 || [ ...v ].length > 20) { setProblem("registro: de 1 a 20 caracteres"); return; }
      void run({ registry_number: v }, false);
    }
  }

  function picked(p: ZooPerson | null) {
    setPerson(p);
    reset();
    if (!p) return;
    if (mode === "tutor") void run({ tutor_patient_id: p.patient.id }, false);
    else if (p.household) void run({ household_id: p.household.id }, false);
  }

  function loadMore() {
    if (!person || !more) return;
    void run(mode === "tutor" ? { tutor_patient_id: person.patient.id, before: more } : { household_id: person.household!.id, before: more }, true);
  }

  const numeric = mode === "microchip" || mode === "registry";
  return (
    <section aria-label="Buscar animal" style={panel}>
      <strong>Buscar animal</strong>
      <SegmentedControl options={MODES} value={mode} onChange={(m) => { setMode(m); setText(""); setPerson(null); reset(); }} />
      {numeric ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={fieldLabel}>
            {mode === "microchip" ? "Número do microchip" : "Número de registro"}
            <input value={text} autoComplete="off" inputMode={mode === "microchip" ? "numeric" : "text"} style={inputStyle}
              onChange={(e) => { setText(e.target.value); reset(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (!busy) byNumber(); } }} />
          </label>
          <div style={row}><ActionButton busy={busy} onClick={byNumber}>Buscar</ActionButton></div>
        </div>
      ) : (
        <PersonLookup key={mode} value={person} onChange={picked} label={mode === "tutor" ? "Tutor" : "Morador do domicílio"} />
      )}
      {mode === "household" && person && !person.household && <p style={muted}>{NO_HOUSEHOLD}</p>}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {items && items.length === 0 && <p style={muted}>{NO_ANIMAL}</p>}
      {items && items.length > 0 && (
        <ul style={{ ...list, paddingLeft: 0, listStyle: "none" }} aria-label="Animais encontrados">
          {items.map((a) => (
            <li key={a.id} style={row}>
              <span>{animalDisplayName(a.name, a.species)} · {zooLabel(domains?.species, a.species)} · {zooLabel(domains?.animal_statuses, a.status)}</span>
              <ActionButton variant="secondary" onClick={() => onOpen(a.id, a)}>Abrir</ActionButton>
            </li>
          ))}
        </ul>
      )}
      {more && <div style={row}><ActionButton variant="secondary" busy={busy} onClick={loadMore}>Ver mais</ActionButton></div>}
    </section>
  );
}
