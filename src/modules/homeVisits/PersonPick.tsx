// src/modules/homeVisits/PersonPick.tsx
// A pessoa da visita e a de cada participante (módulo 24b, decisão 7A). Um campo "CPF ou CNS" (11 dígitos = CPF, 15 = CNS):
// achou → "Escolher <nome>"; ninguém → o registro rápido já com o documento. Sem documento → busca por nome e nascimento
// (duplicados) e, só depois de uma busca que voltou para exatamente o que está digitado, "É outra pessoa — registrar".
// As duas buscas são mutações no clique (o api guarda trilha), nunca reações ao que se digita; a resposta de uma busca
// velha, depois de trocar o texto, é ignorada. Dado pessoal só em corpo de POST e em estado local: nada em URL, storage,
// log ou mensagem (as frases não repetem o que foi enviado). Nada é repetido sozinho (429: o usuário tenta de novo).
// `restart`: o 409 `duplicate_suspected` da gravação reabre com a frase e os candidatos do 409, sem nova busca.
// `refusal`: recusa do api para a pessoa digitada (`new_patient.<campo>`) ou para a escolhida (`patient_id`).
// `unidentifiedIds`: cadastros provisórios da urgência — o api os recusa (`patient_unidentified`), a tela nem os oferece.
import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  findVisitDuplicates, lookupVisitPerson, type PatientSex, type PersonScope, type QuickPatient, type VisitCandidate, type VisitPerson
} from "../../lib/api";
import { isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { HOME_VISIT_ERRORS, homeVisitError } from "../../lib/homeVisits";
import { DUPLICATE_SUSPECTED_TEXT, NO_NAME, duplicateQueryProblem, fmtDay } from "../../lib/territoryRegistry";
import { CPF_TEXT } from "../../lib/territoryDictionaries";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, list, muted, row } from "../exams/styles";
import { QuickPatientForm, type QuickInitial, type QuickRefusal } from "./QuickPatientForm";

export type PickedPerson =
  | { kind: "patient"; patientId: string; displayName: string | null; hasCpf: boolean; hasCns: boolean; sex: PatientSex | null }
  | { kind: "new"; patient: QuickPatient; duplicatesReviewed: boolean };

interface Query { full_name: string; birth_date: string; mother_name?: string }
export interface PersonRestart { query: { full_name: string; birth_date: string; mother_name?: string | null }; candidates: VisitCandidate[] }

const DOC_TEXT = "informe o CPF (11 dígitos) ou o CNS (15 dígitos)";
export const candidateLine = (c: { display_name: string | null; birth_date: string | null; has_cpf: boolean }): string =>
  `${c.display_name ?? NO_NAME} · ${c.birth_date ? `nascido em ${fmtDay(c.birth_date)}` : "sem data de nascimento"} · ${c.has_cpf ? "com CPF" : "sem CPF"}`;

const sameQuery = (a: Query | null, b: Query) => !!a && a.full_name === b.full_name && a.birth_date === b.birth_date && (a.mother_name ?? "") === (b.mother_name ?? "");

export function PersonPick({ scope, today, onChoose, onCancel, restart, refusal, unidentifiedIds, initialNew }: {
  scope: PersonScope; today: string; onChoose(c: PickedPerson): void; onCancel(): void; restart?: PersonRestart;
  refusal?: QuickRefusal | null; unidentifiedIds?: readonly string[]; initialNew?: QuickInitial;
}) {
  // O que está aberto: a busca por documento, a busca por nome ou o registro rápido (com o que já se sabe).
  const [ mode, setMode ] = useState<"doc" | "name">(restart ? "name" : "doc");
  const [ quick, setQuick ] = useState<{ initial: QuickInitial; reviewed: boolean } | null>(initialNew ? { initial: initialNew, reviewed: false } : null);
  // A frase de "ninguém com este documento" segue na tela do registro rápido.
  const [ notice, setNotice ] = useState<string | null>(null);
  const done = (patient: QuickPatient) => onChoose({ kind: "new", patient, duplicatesReviewed: quick?.reviewed ?? false });

  if (quick) {
    return (
      <div style={form}>
        {notice && <p role="alert" style={alert}>{notice}</p>}
        {refusal && !refusal.path.startsWith("new_patient.") && <p role="alert" style={alert}>{refusal.text}</p>}
        <QuickPatientForm initial={quick.initial} today={today} refusal={refusal?.path.startsWith("new_patient.") ? refusal : null} onDone={done}
          onCancel={() => { setQuick(null); setNotice(null); }} />
      </div>
    );
  }
  return (
    <div style={form}>
      {refusal && !refusal.path.startsWith("new_patient.") && <p role="alert" style={alert}>{refusal.text}</p>}
      {mode === "doc"
        ? <ByDocument scope={scope} unidentifiedIds={unidentifiedIds} onChoose={onChoose} onMissing={(initial) => { setNotice(HOME_VISIT_ERRORS.person_not_found); setQuick({ initial, reviewed: false }); }}
            onNoDocument={() => setMode("name")} onCancel={onCancel} />
        : <ByName scope={scope} today={today} unidentifiedIds={unidentifiedIds} restart={restart} onChoose={onChoose}
            onOther={(initial) => setQuick({ initial, reviewed: true })} onBack={() => setMode("doc")} onCancel={onCancel} />}
    </div>
  );
}

function ByDocument({ scope, unidentifiedIds, onChoose, onMissing, onNoDocument, onCancel }: {
  scope: PersonScope; unidentifiedIds?: readonly string[]; onChoose(c: PickedPerson): void; onMissing(initial: QuickInitial): void;
  onNoDocument(): void; onCancel(): void;
}) {
  const [ doc, setDoc ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ found, setFound ] = useState<VisitPerson | null>(null);
  const seq = useRef(0);
  const lookup = useMutation({
    gcTime: 0,
    mutationFn: ({ digits }: { digits: string; n: number }) =>
      lookupVisitPerson(scope, digits.length === 11 ? { cpf: digits } : { cns: digits }),
    onSuccess: (person, { digits, n }) => {
      if (n !== seq.current) return;
      if (person) { setFound(person); return; }
      onMissing(digits.length === 11 ? { cpf: digits } : { cns: digits });
    },
    onError: (err, { n }) => { if (n === seq.current) setProblem(homeVisitError(err)); }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (lookup.isPending) return;
    setFound(null);
    const digits = onlyDigits(doc);
    if (digits.length === 11 && !isValidCpf(digits)) { setProblem(CPF_TEXT); return; }
    if (digits.length !== 11 && digits.length !== 15) { setProblem(DOC_TEXT); return; }
    setProblem(null);
    seq.current += 1;
    lookup.mutate({ digits, n: seq.current });
  }

  const blocked = !!found && !!unidentifiedIds?.includes(found.patient_id);
  const name = found?.display_name ?? NO_NAME;
  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Buscar pessoa pelo documento">
      <label style={fieldLabel}>
        CPF ou CNS
        <input value={doc} style={inputStyle} autoComplete="off" inputMode="numeric"
          onChange={(e) => { const d = onlyDigits(e.target.value); setDoc(d.length <= 11 ? maskCpf(d) : d); seq.current += 1; setFound(null); setProblem(null); }} />
      </label>
      <div style={row}>
        <button type="submit" style={lookup.isPending ? disabledButtonStyle : buttonStyle} disabled={lookup.isPending}>Buscar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onNoDocument}>Não tem o documento</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {found && (
        <div style={row}>
          <span id="person-found">{candidateLine(found)}</span>
          {blocked
            ? <p role="alert" style={alert}>{HOME_VISIT_ERRORS.patient_unidentified}</p>
            : <button type="button" style={buttonStyle} aria-describedby="person-found"
                onClick={() => { setDoc(""); onChoose({ kind: "patient", patientId: found.patient_id, displayName: found.display_name, hasCpf: found.has_cpf, hasCns: found.cns_masked !== null, sex: found.sex }); }}>
                {`Escolher ${name}`}
              </button>}
        </div>
      )}
    </form>
  );
}

function ByName({ scope, today, unidentifiedIds, restart, onChoose, onOther, onBack, onCancel }: {
  scope: PersonScope; today: string; unidentifiedIds?: readonly string[]; restart?: PersonRestart; onChoose(c: PickedPerson): void;
  onOther(initial: QuickInitial): void; onBack(): void; onCancel(): void;
}) {
  const [ fullName, setFullName ] = useState(restart?.query.full_name ?? "");
  const [ birth, setBirth ] = useState(restart?.query.birth_date ?? "");
  const [ mother, setMother ] = useState(restart?.query.mother_name ?? "");
  const [ problem, setProblem ] = useState<string | null>(restart ? DUPLICATE_SUSPECTED_TEXT : null);
  const seq = useRef(0);
  const [ result, setResult ] = useState<{ query: Query; candidates: VisitCandidate[] } | null>(
    restart ? { query: { full_name: restart.query.full_name.trim(), birth_date: restart.query.birth_date, ...(restart.query.mother_name?.trim() ? { mother_name: restart.query.mother_name.trim() } : {}) }, candidates: restart.candidates } : null);

  const typed = (): Query => {
    const q: Query = { full_name: fullName.trim(), birth_date: birth };
    if (mother.trim()) q.mother_name = mother.trim();
    return q;
  };
  const search = useMutation({
    gcTime: 0,
    mutationFn: ({ q }: { q: Query; n: number }) => findVisitDuplicates(scope, q),
    onSuccess: (candidates, { q, n }) => { if (n === seq.current) setResult({ query: q, candidates }); },
    onError: (err, { n }) => { if (n === seq.current) setProblem(homeVisitError(err)); }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (search.isPending) return;
    const q = typed();
    const local = duplicateQueryProblem({ full_name: q.full_name, birth_date: q.birth_date }, today);
    if (local) { setProblem(local); return; }
    setProblem(null);
    setResult(null);
    seq.current += 1;
    search.mutate({ q, n: seq.current });
  }

  const current = result && sameQuery(result.query, typed()) ? result : null;
  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label style={fieldLabel}>
      {label}
      <input type={type} value={value} style={inputStyle} autoComplete="off" onChange={(e) => { set(e.target.value); setProblem(null); seq.current += 1; }} />
    </label>
  );

  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Buscar possíveis duplicados">
      <p style={muted}>Sem o documento, procure antes quem já é paciente com o mesmo nome, nascimento e mãe.</p>
      {field("Nome completo", fullName, setFullName)}
      {field("Data de nascimento", birth, setBirth, "date")}
      {field("Nome da mãe (opcional)", mother, setMother)}
      <div style={row}>
        <button type="submit" style={search.isPending ? disabledButtonStyle : buttonStyle} disabled={search.isPending}>Buscar possíveis duplicados</button>
        <button type="button" style={secondaryButtonStyle} onClick={onBack}>Buscar pelo documento</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {current && (
        <section aria-label="Possíveis duplicados" style={{ ...form, maxWidth: "none" }}>
          {current.candidates.length === 0 ? <p style={muted}>Nenhum paciente parecido.</p> : (
            <ul style={list}>
              {current.candidates.map((c) => {
                const blocked = !!unidentifiedIds?.includes(c.patient_id);
                return (
                  <li key={c.patient_id} style={row}>
                    <span id={`candidate-${c.patient_id}`}>{candidateLine(c)}</span>
                    {blocked ? <span role="alert" style={alert}>{HOME_VISIT_ERRORS.patient_unidentified}</span> : (
                      <button type="button" style={secondaryButtonStyle} aria-describedby={`candidate-${c.patient_id}`}
                        onClick={() => onChoose({ kind: "patient", patientId: c.patient_id, displayName: c.display_name, hasCpf: c.has_cpf, hasCns: c.has_cns, sex: c.sex })}>
                        {`Escolher ${c.display_name ?? NO_NAME}`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div style={row}>
            <button type="button" style={buttonStyle}
              onClick={() => onOther({ full_name: current.query.full_name, birth_date: current.query.birth_date, ...(current.query.mother_name ? { mother_name: current.query.mother_name } : {}) })}>
              É outra pessoa — registrar
            </button>
          </div>
        </section>
      )}
    </form>
  );
}
