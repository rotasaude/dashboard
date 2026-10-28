// src/modules/surveillance/ManualNotificationPanel.tsx
// Notificação manual da vigilância (módulo 25; F-25.4; contrato §5, K4, K6,
// K11, K15): a equipe notifica quem não passou por consulta. Passo 1, a
// pessoa: o PersonStart do 24a com a fonte da vigilância (rotas próprias, sem
// cadastro territorial). Passo 2, só para a pessoa nova: sexo, o motivo de
// não ter CPF e o CNS (e nome, nascimento e mãe quando ninguém foi achado
// pelo CPF). Passo 3, o caso: doença, data da suspeita, primeiros sintomas,
// unidade notificadora (qualquer ativa, A14) e residência fora do município.
// CPF, nome e mãe vão só no corpo dos POSTs; nada em storage, URL ou log.
// 409 duplicate_suspected volta ao passo 1 com a busca já feita (L28 do 24a);
// 409 already_notified oferece abrir a notificação existente.
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createManualNotification, errorCode, findSurveillanceDuplicates, listSurveillanceDiseases, listSurveillanceUnits,
  lookupSurveillancePerson, type ManualNotificationInput, type NewPatient, type PatientSex, type SurveillanceNotification
} from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { DOMAINS, newPatientProblem } from "../../lib/territoryDictionaries";
import {
  DISEASES_KEY, NOTIFICATIONS_KEY, NO_NAME, STATIC_QUERY, SURVEILLANCE_COUNT_KEY, UNITS_KEY,
  existingNotificationId, pastDateProblem, residenceProblem, surveillanceError, symptomsProblem
} from "../../lib/surveillance";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, panel, row, title } from "../exams/styles";
import { PersonStart, type PersonChoice, type PersonRestart, type PersonSource } from "../territory/PersonStart";

// A vigilância busca pelas rotas dela; as frases são as dela (códigos de pessoa caem no mapa do 24a).
export const SURVEILLANCE_PERSON_SOURCE: PersonSource = {
  lookup: (cpf) => lookupSurveillancePerson(cpf),
  duplicates: (q) => findSurveillanceDuplicates(q),
  describe: (err) => surveillanceError(err, "manual"),
  pickLabel: (name) => `Notificar ${name}`
};

interface Props {
  today?: string;
  onCreated(n: SurveillanceNotification): void;
  onOpenExisting(id: string): void;
  onCancel(): void;
}

// A pessoa no corpo: exatamente uma das três (duplicates_reviewed fica no nível de cima, ao lado de new_patient).
type PersonPart = { patient_id: string } | { citizen_id: string } | { new_patient: NewPatient; duplicates_reviewed?: boolean };
type Step = { kind: "person"; restart?: PersonRestart; round: number } | { kind: "case"; choice: PersonChoice; round: number };

export function ManualNotificationPanel({ today = todayInCity(), onCreated, onOpenExisting, onCancel }: Props) {
  const [ step, setStep ] = useState<Step>({ kind: "person", round: 0 });
  return (
    <section style={panel} aria-label="Notificação manual">
      <h3 style={title}>Notificação manual</h3>
      {step.kind === "person" ? (
        // A chave remonta a busca na volta do 409 (o PersonStart lê `initial` ao abrir).
        <PersonStart key={step.round} today={today} source={SURVEILLANCE_PERSON_SOURCE} initial={step.restart} onCancel={onCancel}
          onChoose={(choice) => setStep({ kind: "case", choice, round: step.round })} />
      ) : (
        <CaseForm choice={step.choice} today={today} onCreated={onCreated} onOpenExisting={onOpenExisting} onCancel={onCancel}
          onRestart={(restart) => setStep({ kind: "person", restart, round: step.round + 1 })}
          onChangePerson={() => setStep({ kind: "person", round: step.round + 1 })} />
      )}
    </section>
  );
}

const squish = (value: string) => value.replace(/\s+/g, " ").trim();
const SEX_OPTIONS: { code: PatientSex; label: string }[] = [ { code: "female", label: "Feminino" }, { code: "male", label: "Masculino" } ];

function personLine(choice: PersonChoice): string {
  if (choice.kind === "new") {
    return choice.identity.full_name ? `Pessoa nova: ${choice.identity.full_name}` : "Pessoa nova com o CPF informado";
  }
  return `Pessoa: ${choice.displayName ?? NO_NAME}`;
}

function CaseForm({ choice, today, onCreated, onOpenExisting, onCancel, onRestart, onChangePerson }: Omit<Props, "today"> & {
  choice: PersonChoice; today: string; onRestart(restart: PersonRestart): void; onChangePerson(): void;
}) {
  const client = useQueryClient();
  const diseases = useQuery({ queryKey: [ DISEASES_KEY ], queryFn: listSurveillanceDiseases, ...STATIC_QUERY });
  const units = useQuery({ queryKey: [ UNITS_KEY ], queryFn: listSurveillanceUnits, ...STATIC_QUERY });

  const isNew = choice.kind === "new";
  const identity = isNew ? choice.identity : {};
  const cpf = isNew ? choice.cpf : undefined;
  // Revisada na busca de duplicados: nome, nascimento e mãe são os buscados (não mudam aqui).
  const typing = isNew && !choice.duplicatesReviewed;
  const [ fullName, setFullName ] = useState(identity.full_name ?? "");
  const [ birth, setBirth ] = useState(identity.birth_date ?? "");
  const [ mother, setMother ] = useState(identity.mother_name ?? "");
  const [ sex, setSex ] = useState<string>(identity.sex ?? "");
  const [ reason, setReason ] = useState("");
  const [ cns, setCns ] = useState("");

  const [ disease, setDisease ] = useState("");
  const [ suspected, setSuspected ] = useState(today);
  const [ symptoms, setSymptoms ] = useState("");
  const [ unit, setUnit ] = useState("");
  const [ elsewhere, setElsewhere ] = useState(false);
  const [ ibge, setIbge ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ existingId, setExistingId ] = useState<string | null>(null);

  function newPatient(): NewPatient {
    const np: NewPatient = { full_name: squish(fullName), birth_date: birth, sex: sex as PatientSex };
    if (squish(mother)) np.mother_name = squish(mother);
    if (cpf) np.cpf = cpf;
    else if (reason) np.no_cpf_reason = reason;
    const cnsDigits = cns.replace(/\s/g, "");
    if (cnsDigits) np.cns = cnsDigits;
    return np;
  }

  function person(): PersonPart {
    if (choice.kind === "patient") return { patient_id: choice.patientId };
    if (choice.kind === "citizen") return { citizen_id: choice.citizenId };
    return { new_patient: newPatient(), ...(choice.duplicatesReviewed ? { duplicates_reviewed: true } : {}) };
  }

  const create = useMutation({
    mutationFn: (input: ManualNotificationInput) => createManualNotification(input),
    onSuccess: (created) => {
      for (const key of [ NOTIFICATIONS_KEY, SURVEILLANCE_COUNT_KEY ]) void client.invalidateQueries({ queryKey: [ key ] });
      onCreated(created);
    },
    onError: (err, input) => {
      // K4 (L28 do 24a): nome e nascimento de um paciente existente — de volta à busca, com a frase e os candidatos.
      if (errorCode(err) === "duplicate_suspected" && "new_patient" in input) {
        const np = input.new_patient;
        onRestart({ query: { full_name: np.full_name, birth_date: np.birth_date, ...(np.mother_name ? { mother_name: np.mother_name } : {}) },
          ...(np.cpf ? { cpf: np.cpf } : {}), search: true });
        return;
      }
      setExistingId(existingNotificationId(err));
      setProblem(surveillanceError(err, "manual"));
    }
  });

  function localProblem(input: ManualNotificationInput): string | null {
    if ("new_patient" in input) {
      const typed = newPatientProblem(input.new_patient, today);
      if (typed) return typed.message;
    }
    if (!disease) return "escolha a doença ou agravo";
    return pastDateProblem(suspected, "data da suspeita", today, true)
      ?? symptomsProblem(symptoms, suspected, today)
      ?? (unit ? null : "escolha a unidade notificadora")
      ?? residenceProblem(elsewhere, ibge.trim());
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    setExistingId(null);
    const input: ManualNotificationInput = { ...person(), disease_code: disease, suspected_on: suspected, unit_id: unit };
    if (symptoms) input.symptoms_on = symptoms;
    if (elsewhere) { input.resident_elsewhere = true; input.residence_ibge = ibge.trim(); }
    const local = localProblem(input);
    if (local) { setProblem(local); return; }
    setProblem(null);
    create.mutate(input);
  }

  const edited = <T,>(set: (v: T) => void) => (value: T) => { set(value); setProblem(null); setExistingId(null); };
  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label style={fieldLabel}>
      {label}
      <input type={type} value={value} style={inputStyle} autoComplete="off" onChange={(e) => edited(set)(e.target.value)} />
    </label>
  );

  // Doença local desativada não entra numa notificação nova; a nota explica a doença sem CID (K13c).
  const diseaseOptions = (diseases.data ?? []).filter((d) => d.active !== false);
  const chosen = diseaseOptions.find((d) => d.code === disease);
  const unitOptions = units.data ?? [];

  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Dados da notificação manual">
      <div style={row}>
        <span>{personLine(choice)}</span>
        <button type="button" style={secondaryButtonStyle} onClick={onChangePerson}>Trocar pessoa</button>
      </div>
      {isNew && (
        <fieldset style={fieldset}>
          <legend style={legend}>Pessoa nova</legend>
          {typing && (
            <div style={row}>
              {field("Nome completo", fullName, setFullName)}
              {field("Data de nascimento", birth, setBirth, "date")}
              {field("Nome da mãe", mother, setMother)}
            </div>
          )}
          <div style={row}>
            <label style={fieldLabel}>
              Sexo
              <select value={sex} style={inputStyle} onChange={(e) => edited(setSex)(e.target.value)}>
                <option value="">Escolha</option>
                {SEX_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
              </select>
            </label>
            {!cpf && (
              <label style={fieldLabel}>
                Motivo de não ter CPF
                <select value={reason} style={inputStyle} onChange={(e) => edited(setReason)(e.target.value)}>
                  <option value="">Escolha</option>
                  {DOMAINS.justificativa_nao_possui_cpf.map((o) => <option key={o.code} value={String(o.code)}>{o.label}</option>)}
                </select>
              </label>
            )}
            {field("CNS (opcional)", cns, setCns)}
          </div>
        </fieldset>
      )}
      <fieldset style={fieldset}>
        <legend style={legend}>Caso</legend>
        {diseases.isError && <p role="alert" style={alert}>{surveillanceError(diseases.error, "manual")}</p>}
        {units.isError && <p role="alert" style={alert}>{surveillanceError(units.error, "manual")}</p>}
        <div style={row}>
          <label style={fieldLabel}>
            Doença ou agravo
            <select value={disease} style={inputStyle} onChange={(e) => edited(setDisease)(e.target.value)}>
              <option value="">{diseases.isPending ? "carregando…" : "Escolha"}</option>
              {diseaseOptions.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          </label>
          {field("Data da suspeita", suspected, setSuspected, "date")}
          {field("Primeiros sintomas (opcional)", symptoms, setSymptoms, "date")}
        </div>
        {chosen?.notes && <p style={muted}>{chosen.notes}</p>}
        <label style={fieldLabel}>
          Unidade notificadora
          <select value={unit} style={inputStyle} onChange={(e) => edited(setUnit)(e.target.value)}>
            <option value="">{units.isPending ? "carregando…" : "Escolha"}</option>
            {unitOptions.map((u) => <option key={u.id} value={u.id}>{u.cnes ? `${u.name} · CNES ${u.cnes}` : u.name}</option>)}
          </select>
        </label>
        <label style={checkLabel}>
          <input type="checkbox" checked={elsewhere} onChange={(e) => edited(setElsewhere)(e.target.checked)} />
          Mora em outro município
        </label>
        {elsewhere && field("Código IBGE do município de residência", ibge, setIbge)}
      </fieldset>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {existingId && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} onClick={() => onOpenExisting(existingId)}>Abrir a notificação existente</button>
        </div>
      )}
      <div style={row}>
        <button type="submit" style={create.isPending ? disabledButtonStyle : buttonStyle} disabled={create.isPending}>Registrar notificação</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
