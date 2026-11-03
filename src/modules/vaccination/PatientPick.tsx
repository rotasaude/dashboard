// Quem é a pessoa na sala de vacina (módulo 29; F-29.2; contrato §15 V3/V21): o PersonStart do 24a com as rotas DA SALA (a busca
// autoriza pela equipe dela). Paciente achado → `{ patient_id }`; ninguém (recém-nascido sem cadastro, D3) → o NewPersonForm →
// `{ new_patient, duplicates_reviewed? }` no corpo da caderneta. O 409 duplicate_suspected da caderneta volta aqui por `restart`
// (a tela de cima remonta com a busca de duplicados já feita, molde do ManualNotificationPanel do 25). Nada em storage, URL ou log.
import { useState, type FormEvent } from "react";
import { findVaccinationDuplicates, lookupVaccinationPerson, type CardRequest, type NewPatient, type PatientSex } from "../../lib/api";
import { DOMAINS, newPatientProblem } from "../../lib/territoryDictionaries";
import { vaccinationError } from "../../lib/vaccination";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { PersonStart, type PersonChoice, type PersonRestart, type PersonSource } from "../territory/PersonStart";

// A fonte depende da sala: busca e duplicados são rotas dela.
export function vaccinationPersonSource(roomId: string): PersonSource {
  return {
    lookup: (cpf) => lookupVaccinationPerson(roomId, cpf),
    duplicates: (q) => findVaccinationDuplicates(roomId, q),
    describe: vaccinationError,
    pickLabel: (name) => `Abrir a caderneta de ${name}`
  };
}

type NewChoice = Extract<PersonChoice, { kind: "new" }>;
type Step = { kind: "person"; round: number } | { kind: "new"; choice: NewChoice; round: number };

// `onCancel`: a pessoa desistiu da busca em curso (a tela de cima descarta a caderneta que ainda esteja chegando).
export function PatientPick({ roomId, today, onPick, restart, busy = false, onCancel }: {
  roomId: string; today: string; onPick(req: CardRequest): void; restart?: PersonRestart; busy?: boolean; onCancel?(): void;
}) {
  const [ step, setStep ] = useState<Step>({ kind: "person", round: 0 });
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ source ] = useState(() => vaccinationPersonSource(roomId));

  function choose(choice: PersonChoice) {
    setProblem(null);
    if (choice.kind === "patient") onPick({ patient_id: choice.patientId });
    else if (choice.kind === "new") setStep({ kind: "new", choice, round: step.round });
    // A busca da sala sempre devolve `patient_id` (o par validado vira paciente no api, V3); `citizen` não chega, mas não some calado.
    else setProblem("não foi possível abrir esta pessoa — busque de novo");
  }

  if (step.kind === "new") {
    return <NewPersonForm choice={step.choice} today={today} onPick={onPick} busy={busy} onBack={() => { onCancel?.(); setStep({ kind: "person", round: step.round + 1 }); }} />;
  }
  return (
    <div style={form}>
      {/* Só a primeira montagem usa o `restart` (a volta do 409); "Cancelar" recomeça em branco. */}
      <PersonStart key={step.round} today={today} source={source} initial={step.round === 0 ? restart : undefined}
        onChoose={choose} onCancel={() => { onCancel?.(); setProblem(null); setStep({ kind: "person", round: step.round + 1 }); }} />
      {problem && <p role="alert" style={alert}>{problem}</p>}
    </div>
  );
}

const squish = (value: string) => value.replace(/\s+/g, " ").trim();
const SEX_OPTIONS: { code: PatientSex; label: string }[] = [ { code: "female", label: "Feminino" }, { code: "male", label: "Masculino" } ];

// Pessoa nova (recém-nascido sem cadastro). Revisada na busca de duplicados: nome, nascimento e mãe são os buscados (não mudam aqui).
export function NewPersonForm({ choice, today, onPick, onBack, busy = false }: {
  choice: NewChoice; today: string; onPick(req: CardRequest): void; onBack(): void; busy?: boolean;
}) {
  const typing = !choice.duplicatesReviewed;
  const [ fullName, setFullName ] = useState(choice.identity.full_name ?? "");
  const [ birth, setBirth ] = useState(choice.identity.birth_date ?? "");
  const [ mother, setMother ] = useState(choice.identity.mother_name ?? "");
  const [ sex, setSex ] = useState<string>(choice.identity.sex ?? "");
  const [ reason, setReason ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);

  function newPatient(): NewPatient {
    const np: NewPatient = { full_name: squish(fullName), birth_date: birth, sex: sex as PatientSex };
    if (squish(mother)) np.mother_name = squish(mother);
    if (choice.cpf) np.cpf = choice.cpf;
    else if (reason) np.no_cpf_reason = reason;
    return np;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const np = newPatient();
    const local = newPatientProblem(np, today);
    if (local) { setProblem(local.message); return; }
    setProblem(null);
    onPick({ new_patient: np, ...(choice.duplicatesReviewed ? { duplicates_reviewed: true } : {}) });
  }

  const edited = (set: (v: string) => void) => (value: string) => { set(value); setProblem(null); };
  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label style={fieldLabel}>
      {label}
      <input type={type} value={value} style={inputStyle} autoComplete="off" onChange={(e) => edited(set)(e.target.value)} />
    </label>
  );

  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Pessoa nova">
      <fieldset style={fieldset}>
        <legend style={legend}>Pessoa nova</legend>
        <p style={muted}>{choice.cpf ? "Pessoa nova com o CPF informado." : "Pessoa nova sem CPF."}</p>
        {typing ? (
          <div style={row}>
            {field("Nome completo", fullName, setFullName)}
            {field("Data de nascimento", birth, setBirth, "date")}
            {field("Nome da mãe", mother, setMother)}
          </div>
        ) : <p style={muted}>{fullName}</p>}
        <div style={row}>
          <label style={fieldLabel}>
            Sexo
            <select value={sex} style={inputStyle} onChange={(e) => edited(setSex)(e.target.value)}>
              <option value="">Escolha</option>
              {SEX_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </label>
          {!choice.cpf && (
            <label style={fieldLabel}>
              Motivo de não ter CPF
              <select value={reason} style={inputStyle} onChange={(e) => edited(setReason)(e.target.value)}>
                <option value="">Escolha</option>
                {DOMAINS.justificativa_nao_possui_cpf.map((o) => <option key={o.code} value={String(o.code)}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>
      </fieldset>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Abrir a caderneta</button>
        <button type="button" style={secondaryButtonStyle} onClick={onBack}>Voltar à busca</button>
      </div>
    </form>
  );
}
