// src/modules/zoonoses/ObservationDetail.tsx
// Detalhe da observação do animal agressor (módulo 35b, F-35.14). O detalhe grava a trilha de leitura (NOMINAL_QUERY: lido ao
// abrir e depois de uma ação). Ligar o animal vale em qualquer estado e uma vez só (o animal vem do resultado da busca, sem
// getAnimal); o desfecho só enquanto aberta. Toda escrita leva `expected_version`; 409 (observation_changed): a frase e UMA
// releitura, nenhum reenvio. O api decide o que `euthanized` exige (a eutanásia ligada a esta observação); a tela só avisa.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { closeObservation, getAnimal, linkObservationAnimal, getObservation, type Animal, type ObservationOutcome } from "../../lib/api";
import { fmtDay } from "../../lib/homeVisits";
import {
  NOMINAL_QUERY, ZOO_ANIMAL_KEY, ZOO_OBSERVATION_KEY, animalDisplayName, closeObservationProblems, isZoonosesStale, observationConditionLabel, observationDaysText, zooLabel, zoonosesRefusals
} from "../../lib/zoonoses";
import { ActionButton } from "../../components/ActionButton";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { inputStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, okText, panel, row, title } from "../exams/styles";
import { AnimalForm } from "./AnimalForm";
import { hasOpenStay } from "./AnimalHistory";
import { AnimalSearch } from "./AnimalSearch";
import { ContactDialog } from "./ContactDialog";
import { useZooDomains } from "./useZooDomains";

export const EUTHANASIA_HINT = "Eutanasiado só vale com a eutanásia desta observação gravada: registre antes a eutanásia em Canil e gatil.";
type Mode = null | "close" | "link";

export function ObservationDetail({ id, today, onChanged, onGoToShelter }: { id: string; today: string; onChanged(): void; onGoToShelter?(): void }) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const q = useQuery({ queryKey: [ ZOO_OBSERVATION_KEY, id ], queryFn: () => getObservation(id), ...NOMINAL_QUERY });
  const [ mode, setMode ] = useState<Mode>(null);
  const [ outcome, setOutcome ] = useState("");
  const [ outcomeOn, setOutcomeOn ] = useState("");
  const [ note, setNote ] = useState("");
  const [ picked, setPicked ] = useState<Animal | null>(null);
  const [ registering, setRegistering ] = useState(false);
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const o = q.data;
  // Só quando "eutanasiado" é escolhido e o animal está ligado: o histórico diz se há estada aberta (a eutanásia sai de uma estada, Q42).
  const hist = useQuery({
    queryKey: [ ZOO_ANIMAL_KEY, o?.animal_id ?? "" ], queryFn: () => getAnimal(o!.animal_id!), ...NOMINAL_QUERY,
    enabled: mode === "close" && outcome === "euthanized" && !!o?.animal_id
  });

  const reread = () => { void client.invalidateQueries({ queryKey: [ ZOO_OBSERVATION_KEY, id ] }); onChanged(); };
  const reset = (m: Mode) => { setMode(m); setProblems([]); setNotice(null); setOutcome(""); setOutcomeOn(""); setNote(""); setPicked(null); setRegistering(false); };

  async function run(write: () => Promise<unknown>, done: string) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setProblems([]);
    try {
      await write();
      reset(null);
      setNotice(done);
      reread();
    } catch (err) {
      const refusals = zoonosesRefusals(err);
      if (isZoonosesStale(err)) { reset(null); setNotice(refusals[0].text); reread(); }
      else setProblems([ ...new Set(refusals.map((r) => r.text)) ]);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  function sendClose() {
    if (!o) return;
    const found = closeObservationProblems({ outcome: outcome || null, outcomeOn, note }, o, today);
    if (found.length > 0) { setProblems(found.map((p) => p.text)); return; }
    const trimmed = note.trim();
    void run(() => closeObservation(id, {
      outcome: outcome as ObservationOutcome, outcome_on: outcomeOn, ...(trimmed ? { outcome_note: trimmed } : {}), expected_version: o.version
    }), "Desfecho registrado.");
  }
  function sendLink() {
    if (!o || !picked) return;
    void run(() => linkObservationAnimal(id, { animal_id: picked.id, expected_version: o.version }), "Animal ligado à observação.");
  }

  if (q.isLoading) return <p style={muted}>carregando…</p>;
  if (q.isError || !o) return <EmptyState title={q.error ? zoonosesRefusals(q.error)[0].text : "observação não encontrada"} />;
  const idle = !q.isFetching;
  const outcomes = (domains?.observation_outcomes ?? []).filter((x) => x.code !== "open");
  return (
    <section style={panel} aria-label="Observação">
      <strong style={title}>{zooLabel(domains?.species, o.species)} · {o.condition ? observationConditionLabel(o.condition) : "condição não informada"}</strong>
      <div style={row}>
        <Tag tone="neutral">{o.state === "open" ? "Em observação" : "Encerrada"}</Tag>
        <span style={muted}>{o.place === "shelter" ? "no canil" : "em casa"}</span>
      </div>
      <p style={muted}>Exposição em {fmtDay(o.exposure_on)} · fim da observação em {fmtDay(o.ends_on)}{o.state === "open" ? ` (${observationDaysText(o.ends_on, today)})` : ""}</p>
      {o.outcome && (
        <p style={muted}>
          Desfecho: {zooLabel(domains?.observation_outcomes, o.outcome)}{o.outcome_on ? ` em ${fmtDay(o.outcome_on)}` : ""}{o.outcome_note ? `: ${o.outcome_note}` : ""}
        </p>
      )}
      <p style={muted}>{o.animal_id ? "Animal ligado ao cadastro" : "Animal ainda não ligado ao cadastro"}</p>
      {notice && <p role="status" style={okText}>{notice}</p>}
      {mode === null && idle && (
        <div style={row}>
          <ContactDialog observationId={id} onStale={() => reread()} />
          {o.animal_id
            ? <span style={muted}>A ligação do animal vale uma vez só e já foi feita.</span>
            : <ActionButton variant="secondary" onClick={() => reset("link")}>Ligar animal</ActionButton>}
          {o.state === "open" && <ActionButton variant="secondary" onClick={() => reset("close")}>Registrar desfecho</ActionButton>}
        </div>
      )}
      {mode === "close" && (
        <form style={box} aria-label="Registrar desfecho" onSubmit={(e) => e.preventDefault()}>
          <label style={fieldLabel}>
            Desfecho
            <select value={outcome} disabled={busy} style={inputStyle} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">—</option>
              {outcomes.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
            </select>
          </label>
          {outcome === "euthanized" && <p style={muted}>{EUTHANASIA_HINT}</p>}
          {outcome === "euthanized" && onGoToShelter && hist.data && !hist.data.euthanasia && (
            <div style={row}>
              <ActionButton variant="secondary" onClick={onGoToShelter}>{hasOpenStay(hist.data) ? "Ir para Canil e gatil" : "Dar entrada no canil"}</ActionButton>
            </div>
          )}
          <label style={fieldLabel}>
            Data do desfecho
            <input type="date" value={outcomeOn} disabled={busy} style={inputStyle} onChange={(e) => setOutcomeOn(e.target.value)} />
          </label>
          <label style={fieldLabel}>
            Nota
            <textarea value={note} rows={3} disabled={busy} style={inputStyle} onChange={(e) => setNote(e.target.value)} />
          </label>
          {problems.map((p) => <p key={p} role="alert" style={alert}>{p}</p>)}
          <div style={row}>
            <ActionButton busy={busy} onClick={sendClose}>Enviar</ActionButton>
            <ActionButton variant="secondary" onClick={() => { if (!busy) reset(null); }}>Voltar</ActionButton>
          </div>
        </form>
      )}
      {mode === "link" && (
        <div style={box}>
          {!picked && !registering && (
            <>
              <AnimalSearch onOpen={(_id, a) => { setProblems([]); setPicked(a); }} />
              <div style={row}>
                <ActionButton variant="secondary" onClick={() => setRegistering(true)}>Cadastrar animal sem tutor</ActionButton>
                <ActionButton variant="secondary" onClick={() => reset(null)}>Voltar</ActionButton>
              </div>
            </>
          )}
          {!picked && registering && <AnimalForm onSaved={(a) => { setRegistering(false); setPicked(a); }} onCancel={() => setRegistering(false)} />}
          {picked && (
            <>
              <p style={{ margin: 0, fontSize: 13 }}>
                {animalDisplayName(picked.name, picked.species)} · {zooLabel(domains?.species, picked.species)}. A ligação vale uma vez só.
              </p>
              {problems.map((p) => <p key={p} role="alert" style={alert}>{p}</p>)}
              <div style={row}>
                <ActionButton busy={busy} onClick={sendLink}>Ligar este animal</ActionButton>
                <ActionButton variant="secondary" onClick={() => { if (!busy) { setPicked(null); setProblems([]); } }}>Trocar animal</ActionButton>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
