// src/modules/territory/PersonStart.tsx
// Passo 1 da ficha individual (contrato §5, L3; spec decisão 2): quem é a
// pessoa. Com CPF, a busca pelo CPF (sem envelope): paciente (com o cadastro
// ativo → atualizar), par validado sem paciente (citizen), ninguém (404 →
// pessoa nova com o CPF) ou par só declarado (409, frase). Sem CPF, a busca de
// possíveis duplicados por nome, nascimento e mãe ANTES de criar: "Criar
// pessoa sem CPF" só aparece depois de uma busca que voltou para exatamente o
// que está digitado (mudou qualquer um dos três → buscar de novo). As duas
// buscas são mutações no clique (gravam trilha), nunca reações ao que se
// digita; tudo vai no corpo, nada em storage, URL ou log. Candidato que já
// tem cadastro ativo (registration_id, L29) abre esse cadastro em vez da ficha
// nova; o 409 already_registered segue como rede de segurança.
// Volta da ficha (I1, L28): "Corrigir (refaz a busca)" reabre a busca sem CPF
// com o que foi buscado; o 409 duplicate_suspected reabre com a frase e a
// busca já feita (o clique foi o Salvar), levando o CPF da pessoa nova, se havia.
// Fonte trocável (módulo 25): `source` diz por onde buscar, que frase dar a
// uma recusa e o rótulo de "escolher esta pessoa"; o padrão é o do 24a.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { errorCode, findDuplicates, lookupTerritoryPerson, type DuplicateCandidate, type DuplicateQuery, type PatientIdentity, type TerritoryPerson } from "../../lib/api";
import { maskCpf, onlyDigits } from "../../lib/attendance";
import { todayInCity } from "../../lib/campaigns";
import { DUPLICATE_SUSPECTED_TEXT, NO_NAME, cpfProblem, duplicateQueryProblem, fmtDay, territoryError } from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, list, muted, row } from "../exams/styles";

// A pessoa escolhida. `displayName`/`hasCpf`: o que a busca mostrou (a ficha
// não relê o paciente); `identity` do paciente: só a mãe digitada na busca de
// duplicados (nome e nascimento já casaram com o candidato — mandá-los
// regravaria o nome em acento ou caixa). `new`: a identidade digitada
// e, com CPF, o CPF (só dígitos); `duplicatesReviewed`: passou pela busca de
// duplicados e confirmou que é outra pessoa (L28).
export type PersonChoice =
  | { kind: "patient"; patientId: string; registrationId: string | null; displayName?: string | null; hasCpf?: boolean; identity?: PatientIdentity;
      // Volta do 409 com CPF e candidato sem CPF: o CPF digitado vem para "Informar CPF" (editável).
      cpf?: string }
  | { kind: "citizen"; citizenId: string; displayName?: string | null }
  | { kind: "new"; identity: PatientIdentity; cpf?: string; duplicatesReviewed?: boolean };
// Volta à busca de duplicados: o que foi buscado (ou digitado), o CPF da
// pessoa nova (se havia) e `search` (409 duplicate_suspected: busca e frase ao abrir).
export interface PersonRestart { query: DuplicateQuery; cpf?: string; search?: boolean }

const sameQuery = (a: DuplicateQuery | null, b: DuplicateQuery) =>
  !!a && a.full_name === b.full_name && a.birth_date === b.birth_date && (a.mother_name ?? "") === (b.mother_name ?? "");

// Candidato com cadastro ativo legível (L29): a ação abre o cadastro dele.
export const REGISTERED_OPEN = "Já tem cadastro — abrir";

export function candidateLine(c: DuplicateCandidate): string {
  return `${c.display_name} · nascido em ${fmtDay(c.birth_date)} · ${c.has_cpf ? "com CPF" : "sem CPF"}`;
}

// Por onde a pessoa é buscada e como a tela fala dela (o 24a e a vigilância têm rotas e frases próprias).
export interface PersonSource {
  lookup(cpf: string): Promise<TerritoryPerson>;
  duplicates(q: DuplicateQuery): Promise<DuplicateCandidate[]>;
  describe(err: unknown): string;
  // O botão que escolhe o paciente sem cadastro ou o par validado achado pelo CPF.
  pickLabel(name: string): string;
}
export const TERRITORY_PERSON_SOURCE: PersonSource = {
  lookup: (cpf) => lookupTerritoryPerson(cpf),
  duplicates: (q) => findDuplicates(q),
  describe: territoryError,
  pickLabel: (name) => `Cadastrar ${name}`
};

export function PersonStart({ today = todayInCity(), onChoose, onCancel, initial, source = TERRITORY_PERSON_SOURCE }: {
  today?: string; onChoose(choice: PersonChoice): void; onCancel(): void; initial?: PersonRestart; source?: PersonSource;
}) {
  const [ hasCpf, setHasCpf ] = useState(!initial);
  // A volta vale só até trocar o "Tem CPF?" (trocar recomeça em branco, sem buscar sozinho de novo).
  const [ restart, setRestart ] = useState(initial);
  const choose = (value: boolean) => { setRestart(undefined); setHasCpf(value); };
  return (
    <div style={form}>
      <fieldset style={fieldset}>
        <legend style={legend}>Tem CPF?</legend>
        <div style={row}>
          <label style={checkLabel}><input type="radio" name="person-has-cpf" checked={hasCpf} onChange={() => choose(true)} />Tem CPF</label>
          <label style={checkLabel}><input type="radio" name="person-has-cpf" checked={!hasCpf} onChange={() => choose(false)} />Não tem CPF</label>
        </div>
      </fieldset>
      {hasCpf ? <ByCpf onChoose={onChoose} source={source} /> : <WithoutCpf today={today} onChoose={onChoose} initial={restart} source={source} />}
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

function ByCpf({ onChoose, source = TERRITORY_PERSON_SOURCE }: { onChoose(choice: PersonChoice): void; source?: PersonSource }) {
  const [ cpf, setCpf ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  // A resposta vale para o CPF buscado; trocar o número a apaga.
  const [ found, setFound ] = useState<{ cpf: string; person: TerritoryPerson | null } | null>(null);
  const lookup = useMutation({
    gcTime: 0,
    mutationFn: (digits: string) => source.lookup(digits),
    onSuccess: (person, digits) => setFound({ cpf: digits, person }),
    onError: (err, digits) => {
      if (errorCode(err) === "person_not_found") { setFound({ cpf: digits, person: null }); setProblem(source.describe(err)); return; }
      setProblem(source.describe(err));
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (lookup.isPending) return;
    setFound(null);
    const local = cpfProblem(cpf);
    if (local) { setProblem(local); return; }
    setProblem(null);
    lookup.mutate(onlyDigits(cpf));
  }

  const p = found?.person;
  const name = p?.display_name ?? NO_NAME;
  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Buscar pelo CPF">
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          CPF
          <input value={cpf} style={inputStyle} autoComplete="off" inputMode="numeric"
            onChange={(e) => { setCpf(maskCpf(e.target.value)); setFound(null); setProblem(null); }} />
        </label>
        <button type="submit" style={lookup.isPending ? disabledButtonStyle : buttonStyle} disabled={lookup.isPending}>Buscar pelo CPF</button>
      </div>
      {problem && <p role="alert" style={found ? muted : alert}>{problem}</p>}
      {found && !p && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => onChoose({ kind: "new", identity: {}, cpf: found.cpf })}>
            Cadastrar pessoa nova com este CPF
          </button>
        </div>
      )}
      {p && (
        <div style={row}>
          {p.patient_id && p.registration_id ? (
            <button type="button" style={buttonStyle}
              onClick={() => onChoose({ kind: "patient", patientId: p.patient_id as string, registrationId: p.registration_id, displayName: p.display_name, hasCpf: true })}>
              {`Atualizar o cadastro de ${name}`}
            </button>
          ) : p.patient_id ? (
            <button type="button" style={buttonStyle}
              onClick={() => onChoose({ kind: "patient", patientId: p.patient_id as string, registrationId: null, displayName: p.display_name, hasCpf: true })}>
              {source.pickLabel(name)}
            </button>
          ) : p.citizen_id && (
            <button type="button" style={buttonStyle}
              onClick={() => onChoose({ kind: "citizen", citizenId: p.citizen_id as string, displayName: p.display_name })}>
              {source.pickLabel(name)}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

function WithoutCpf({ today, onChoose, initial, source = TERRITORY_PERSON_SOURCE }: {
  today: string; onChoose(choice: PersonChoice): void; initial?: PersonRestart; source?: PersonSource;
}) {
  const [ fullName, setFullName ] = useState(initial?.query.full_name ?? "");
  const [ birth, setBirth ] = useState(initial?.query.birth_date ?? "");
  const [ mother, setMother ] = useState(initial?.query.mother_name ?? "");
  const [ problem, setProblem ] = useState<string | null>(initial?.search ? DUPLICATE_SUSPECTED_TEXT : null);
  const cpf = initial?.cpf;
  const started = useRef(false);
  const [ result, setResult ] = useState<{ query: DuplicateQuery; candidates: DuplicateCandidate[] } | null>(null);

  const typed = (): DuplicateQuery => {
    const q: DuplicateQuery = { full_name: fullName.trim(), birth_date: birth };
    if (mother.trim()) q.mother_name = mother.trim();
    return q;
  };
  const search = useMutation({
    gcTime: 0,
    mutationFn: (q: DuplicateQuery) => source.duplicates(q),
    onSuccess: (candidates, query) => setResult({ query, candidates }),
    onError: (err) => setProblem(source.describe(err))
  });

  // 409 duplicate_suspected: a busca do que foi salvo roda uma vez ao abrir (a ação foi o Salvar).
  useEffect(() => {
    if (!initial?.search || started.current) return;
    started.current = true;
    search.mutate(typed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (search.isPending) return;
    const q = typed();
    const local = duplicateQueryProblem({ full_name: q.full_name, birth_date: q.birth_date }, today);
    if (local) { setProblem(local); return; }
    setProblem(null);
    setResult(null);
    search.mutate(q);
  }

  // A busca só vale para o que está digitado agora.
  const current = result && sameQuery(result.query, typed()) ? result : null;
  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label style={fieldLabel}>
      {label}
      <input type={type} value={value} style={inputStyle} autoComplete="off" onChange={(e) => { set(e.target.value); setProblem(null); }} />
    </label>
  );

  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Buscar possíveis duplicados">
      <p style={muted}>
        {cpf ? "Antes de criar a pessoa nova com o CPF informado, confira quem já é paciente com o mesmo nome, nascimento e mãe."
          : "Antes de criar uma pessoa sem CPF, procure quem já é paciente com o mesmo nome, nascimento e mãe."}
      </p>
      <div style={row}>
        {field("Nome completo", fullName, setFullName)}
        {field("Data de nascimento", birth, setBirth, "date")}
        {field("Nome da mãe", mother, setMother)}
      </div>
      <div style={row}>
        <button type="submit" style={search.isPending ? disabledButtonStyle : buttonStyle} disabled={search.isPending}>Buscar possíveis duplicados</button>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {current && (
        <section aria-label="Possíveis duplicados" style={{ ...form, maxWidth: "none" }}>
          {current.candidates.length === 0 ? <p style={muted}>Nenhum paciente parecido.</p> : (
            <ul style={list}>
              {current.candidates.map((c) => (
                <li key={c.patient_id} style={row}>
                  <span id={`candidate-${c.patient_id}`}>{candidateLine(c)}</span>
                  {c.registration_id ? (
                    // L29: já tem cadastro ativo que o usuário lê — abre o cadastro (o caminho do "Abrir cadastro" do 409);
                    // na volta do 409 com CPF, o CPF digitado vai junto para o candidato sem CPF (I2).
                    <button type="button" style={secondaryButtonStyle} aria-describedby={`candidate-${c.patient_id}`}
                      onClick={() => onChoose({ kind: "patient", patientId: c.patient_id, registrationId: c.registration_id, displayName: c.display_name,
                        hasCpf: c.has_cpf, ...(cpf && !c.has_cpf ? { cpf } : {}) })}>
                      {REGISTERED_OPEN}
                    </button>
                  ) : (
                    <button type="button" style={secondaryButtonStyle} aria-describedby={`candidate-${c.patient_id}`}
                      onClick={() => onChoose({ kind: "patient", patientId: c.patient_id, registrationId: null, displayName: c.display_name, hasCpf: c.has_cpf,
                        identity: current.query.mother_name ? { mother_name: current.query.mother_name } : {}, ...(cpf && !c.has_cpf ? { cpf } : {}) })}>
                      É esta pessoa
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div style={row}>
            {current.candidates.length > 0 && <span style={muted}>Nenhuma destas? É outra pessoa:</span>}
            <button type="button" style={buttonStyle}
              onClick={() => onChoose({ kind: "new", identity: { ...current.query }, ...(cpf ? { cpf } : {}), duplicatesReviewed: true })}>
              {cpf ? "Criar pessoa nova com o CPF" : "Criar pessoa sem CPF"}
            </button>
          </div>
        </section>
      )}
    </form>
  );
}
