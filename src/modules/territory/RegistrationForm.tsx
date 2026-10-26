// src/modules/territory/RegistrationForm.tsx
// Ficha de cadastro individual (contrato §5; preflight A11, A12, C9–C13;
// errata 5.1, 5.3, 9, 10, 12). Cada "Salvar" é uma versão nova e uma ficha;
// sem rascunho: o que está na tela vive só aqui (nada em storage, URL ou log)
// e, ao reabrir, vem do servidor (getRegistration, NOMINAL_QUERY, uma vez).
//
// O corpo é o do api: pessoa nova em `new_patient` (só textos; CPF ou motivo);
// paciente existente por `patient_id`, par validado por `citizen_id`; no
// PATCH a pessoa é a do cadastro. Identidade digitada de quem não tem par
// validado em `patient` (só o que mudou); com par (identity_locked) é só
// leitura, "validados no posto". CPF de quem não tinha e CNS na raiz.
// Raça/cor e etnia só em `patient_demographics` (uma fonte: o paciente),
// etnia só com 05. Lugar: domicílio (+ família; is_responsible = é o
// responsável dela — pessoa nova nunca é) ou, fora de área, a equipe.
// Campo que depende de outra resposta só aparece com ela e, escondido, não
// vai no corpo — gestante e maternidade só com canBePregnant. Recusa: só a
// identificação e `refused: true` (seções vazias, rua nula); desmarcar
// devolve as seções vazias. Uma recusa por vez, com foco no campo (a seção
// recolhida reabre); 409 stale_version: a frase, o digitado fica e
// "Recarregar" relê.
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, createRegistration, errorCode, getRegistration, updateRegistration, type CodedSection, type NewPatient, type PatientIdentity,
  type PatientSex, type Registration, type RegistrationBody, type RegistrationInput, type RegistrationUpdate
} from "../../lib/api";
import { maskCpf, onlyDigits } from "../../lib/attendance";
import { todayInCity } from "../../lib/campaigns";
import { INDIGENOUS, RACE_COLORS } from "../../lib/demographics";
import { patientDocument } from "../../lib/patientDocument";
import {
  DOMAINS, SECTIONS, canBePregnant, dictLabel, patientFacts, registrationProblem, type FieldSpec, type RegistrationDraft
} from "../../lib/territoryDictionaries";
import { FIELD_LABELS, sectionFieldLabel } from "../../lib/territoryLabels";
import {
  IDENTITY_REVIEW_TEXT, NOMINAL_QUERY, REGISTRATION_KEY, REGISTRY_COUNT_KEY, REGISTRY_STATUS_KEY, RESIDENTS_KEY, STALE_TEXT, errorPath, fmtDay,
  isStale, territoryError
} from "../../lib/territoryRegistry";
import { Tag } from "../../components/Tag";
import { KeyValue } from "../../components/KeyValue";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, grid, legend, muted, row } from "../exams/styles";
import { useFieldFocus } from "./fieldFocus";
import { fromDraft, toDraft, type Draft } from "./sectionDraft";
import type { PersonChoice } from "./PersonStart";

export const REGISTRATION_SAVED = "Cadastro salvo. Nova versão enviada ao e-SUS.";
export const LOCKED_TEXT = "validados no posto";

// Domicílio do morador; responsiblePatientId = o responsável da família escolhida.
export interface RegistrationPlace { id: string; familyId: string | null; responsiblePatientId?: string | null }

type Section = "identification" | "sociodemographic" | "health_conditions" | "street_situation";
const SECTION_TITLE: Record<Section, string> = {
  identification: "Identificação", sociodemographic: "Sociodemográfico", health_conditions: "Condições de saúde", street_situation: "Situação de rua"
};
// Ordem da tela: a dos rótulos.
const ordered = (section: Section) => {
  const order = Object.keys(FIELD_LABELS[section] ?? {});
  return [ ...SECTIONS[section] ].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
};
const FIELDS: Record<Section, FieldSpec[]> = {
  identification: ordered("identification"), sociodemographic: ordered("sociodemographic"),
  health_conditions: ordered("health_conditions"), street_situation: ordered("street_situation")
};
// Sim/não obrigatório (o api recusa sem): rádio. Pergunta da TRIA: sim/não/—.
// Os demais booleanos são marcações ("Tem diabetes").
const YES_NO: Record<string, [ string, string ]> = {
  status_deseja_informar_orientacao_sexual: [ "Sim", "Não" ],
  status_deseja_informar_identidade_genero: [ "Sim", "Não" ],
  status_situacao_rua: [ "Está em situação de rua", "Não está em situação de rua" ]
};
const QUESTIONS = [ "alimentos_acabaram_antes_ter_dinheiro_comprar_mais", "comeu_alguns_alimentos_que_tinha_dinheiro_acabou" ];
const BRAZILIAN = "1";
const NATURALIZED = "2";
const FOREIGN = "3";
const BRAZIL = 31;
const SEX_LABEL: Record<PatientSex, string> = { female: "Feminino", male: "Masculino" };

type Subject =
  | { kind: "new"; cpf?: string }
  | { kind: "patient"; patientId: string; displayName?: string | null; hasCpf?: boolean }
  | { kind: "citizen"; citizenId: string; displayName?: string | null }
  | { kind: "edit"; registration: Registration };
// O corpo sem o que é só de paciente existente (com new_patient, patient/cpf/cns não vão).
type Shared = Omit<RegistrationBody, "patient" | "cpf" | "cns">;
type Identity = { full_name: string; birth_date: string; sex: string; mother_name: string };
// O que a tela sabe da pessoa (undefined = não sabe; o api confere).
type Known = { sex: PatientSex | null | undefined; birth: string | null | undefined; motherPresent: boolean | undefined };

const squish = (value: string) => value.replace(/\s+/g, " ").trim();
// Dígitos: o que se digita de separador sai; letra fica para a regra recusar.
const digitsOnly = (value: unknown) => (typeof value === "string" ? value.replace(/[\s().-]/g, "") : value);

function yearsOld(birth: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
  const [ by, bm, bd ] = birth.split("-").map(Number);
  const [ y, m, d ] = today.split("-").map(Number);
  return y - by - (m > bm || (m === bm && d >= bd) ? 0 : 1);
}

export function RegistrationForm({ today = todayInCity(), household, teamId, choice, registrationId, onSaved, onCancel }: {
  today?: string; household?: RegistrationPlace; teamId?: string; choice?: PersonChoice; registrationId?: string;
  onSaved(r: Registration): void; onCancel(): void;
}) {
  const initialId = registrationId ?? (choice?.kind === "patient" ? choice.registrationId : null) ?? null;
  // "Abrir cadastro" (already_registered com o id) troca a criação pela edição do ativo.
  const [ openId, setOpenId ] = useState<string | null>(initialId);
  const common = { today, household, teamId, onSaved, onCancel };
  if (openId) return <EditLoader id={openId} {...common} />;
  if (!choice) return null;
  const subject: Subject = choice.kind === "new" ? { kind: "new", cpf: choice.cpf }
    : choice.kind === "citizen" ? { kind: "citizen", citizenId: choice.citizenId, displayName: choice.displayName }
    : { kind: "patient", patientId: choice.patientId, displayName: choice.displayName, hasCpf: choice.hasCpf };
  const identity = choice.kind === "new" ? choice.identity : {};
  return <FormBody subject={subject} identity={identity} onOpen={setOpenId} {...common} />;
}

type Common = { today: string; household?: RegistrationPlace; teamId?: string; onSaved(r: Registration): void; onCancel(): void };

function EditLoader({ id, ...common }: Common & { id: string }) {
  const query = useQuery({ queryKey: [ REGISTRATION_KEY, id ], queryFn: () => getRegistration(id), ...NOMINAL_QUERY });
  if (query.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (query.isError) {
    return (
      <div style={row}>
        <p role="alert" style={alert}>{territoryError(query.error)}</p>
        <button type="button" style={secondaryButtonStyle} onClick={common.onCancel}>Fechar</button>
      </div>
    );
  }
  const r = query.data;
  const identity: PatientIdentity = { full_name: r.patient.full_name ?? undefined, birth_date: r.patient.birth_date ?? undefined,
    sex: r.patient.sex ?? undefined, mother_name: r.patient.mother_name };
  // Relida (Recarregar) ou salva: o formulário renasce da versão do servidor.
  return <FormBody key={query.dataUpdatedAt} subject={{ kind: "edit", registration: r }} identity={identity} onReload={() => void query.refetch()}
    {...common} />;
}

function FormBody({ subject, identity: given, today, household, teamId, onSaved, onCancel, onOpen, onReload }: Common & {
  subject: Subject; identity: PatientIdentity; onOpen?(id: string): void; onReload?(): void;
}) {
  const client = useQueryClient();
  const focus = useFieldFocus();
  const r = subject.kind === "edit" ? subject.registration : null;
  const locked = r ? r.patient.identity_locked : subject.kind === "citizen";
  // Identidade na tela: pessoa nova, ou cadastro de paciente sem par validado.
  const typedIdentity = subject.kind === "new" || (r !== null && !locked);
  const idPrefix = subject.kind === "new" ? "new_patient" : "patient";

  const [ person, setPerson ] = useState<Identity>({ full_name: given.full_name ?? "", birth_date: given.birth_date ?? "", sex: given.sex ?? "",
    mother_name: given.mother_name ?? "" });
  const [ socialName, setSocialName ] = useState("");
  const [ noCpfReason, setNoCpfReason ] = useState("");
  const [ cns, setCns ] = useState("");
  const [ newCpf, setNewCpf ] = useState("");
  const [ race, setRace ] = useState(r?.patient_demographics.race_color ?? "");
  const [ ethnicity, setEthnicity ] = useState(r?.patient_demographics.ethnicity ?? "");
  const [ sections, setSections ] = useState<Record<Section, Draft>>(() => ({
    identification: r ? toDraft(SECTIONS.identification, r.identification) : { nacionalidade_cidadao: BRAZILIAN },
    sociodemographic: toDraft(SECTIONS.sociodemographic, r?.sociodemographic),
    health_conditions: toDraft(SECTIONS.health_conditions, r?.health_conditions),
    street_situation: toDraft(SECTIONS.street_situation, r?.street_situation)
  }));
  const [ refused, setRefused ] = useState(r?.refused ?? false);
  const [ closed, setClosed ] = useState<Set<Section>>(new Set());
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ activeId, setActiveId ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);

  // ─── O que a tela sabe da pessoa (visibilidade; a regra usa patientFacts) ──
  const known: Known = typedIdentity
    ? { sex: (person.sex || null) as PatientSex | null, birth: person.birth_date || null, motherPresent: !!person.mother_name.trim() }
    : r ? { sex: r.patient.sex, birth: r.patient.birth_date, motherPresent: !!r.patient.mother_name }
    : { sex: undefined, birth: undefined, motherPresent: undefined };
  const place = placeOf(subject, household, teamId);
  const years = known.birth ? yearsOld(known.birth, today) : null;
  const pregnancy = known.sex !== "male" && (known.birth === undefined || canBePregnant(known.sex, known.birth, today));
  const hasCpf = r ? r.patient.has_cpf : subject.kind === "patient" ? subject.hasCpf : undefined;
  const askCpf = hasCpf === false;
  const askCns = subject.kind === "new" || (r !== null && !r.patient.cns_masked);

  function visible(section: Section, key: string): boolean {
    const d = sections[section];
    const yes = (k: string) => d[k] === "true";
    switch (section) {
    case "identification": {
      const nat = d.nacionalidade_cidadao;
      if (key === "codigo_ibge_municipio_nascimento") return nat === BRAZILIAN;
      if (key === "pais_nascimento" || key === "dt_entrada_brasil") return nat === FOREIGN;
      if (key === "dt_naturalizacao" || key === "portaria_naturalizacao") return nat === NATURALIZED;
      if (key === "nome_pai_cidadao") return !yes("desconhece_nome_pai");
      if (key === "desconhece_nome_mae") return known.motherPresent !== true;
      return true;
    }
    case "sociodemographic":
      if (key === "orientacao_sexual_cidadao") return yes("status_deseja_informar_orientacao_sexual");
      if (key === "identidade_genero_cidadao") return yes("status_deseja_informar_identidade_genero");
      if (key === "deficiencias_cidadao") return yes("status_tem_alguma_deficiencia");
      if (key === "co_povo_comunidade_tradicional") return yes("status_membro_povo_comunidade_tradicional");
      if (key === "relacao_parentesco_cidadao") return !place.is_responsible;
      if (key === "responsavel_por_crianca") return years !== null && years < 10;
      return true;
    case "health_conditions":
      if (key === "status_eh_gestante") return pregnancy;
      if (key === "maternidade_de_referencia") return pregnancy && yes("status_eh_gestante");
      if (key === "doenca_cardiaca") return yes("status_teve_doenca_cardiaca");
      if (key === "doenca_respiratoria") return yes("status_tem_doenca_respiratoria");
      if (key === "doenca_rins") return yes("status_tem_teve_doencas_rins");
      if (key === "descricao_causa_internacao_em12_meses") return yes("status_teve_internado_em12_meses");
      if (key === "descricao_plantas_medicinais_usadas") return yes("status_usa_planta_medicinais");
      return true;
    case "street_situation":
      if (key === "status_situacao_rua") return true;
      if (!yes("status_situacao_rua")) return false;
      if (key === "grau_parentesco_familiar_frequentado") return yes("status_visita_familiar_frequentemente");
      if (key === "higiene_pessoal_situacao_rua") return yes("status_tem_acesso_higiene_pessoal_situacao_rua");
      if (key === "outra_instituicao_que_acompanha") return yes("status_acompanhado_por_outra_instituicao");
      return true;
    }
  }

  function section(name: Section): CodedSection {
    const draft = Object.fromEntries(Object.entries(sections[name]).map(([ key, value ]) => {
      const spec = FIELDS[name].find((f) => f.key === key);
      return [ key, spec?.type === "digits" ? digitsOnly(value) : value ];
    }));
    const out = fromDraft(FIELDS[name], draft, (key) => visible(name, key)) ?? {};
    if (name === "identification" && sections.identification.nacionalidade_cidadao === BRAZILIAN) out.pais_nascimento = BRAZIL;
    return out;
  }

  function body(): RegistrationInput | RegistrationUpdate {
    const common: Shared = {};
    if (race) common.patient_demographics = race === INDIGENOUS && ethnicity.trim() ? { race_color: race, ethnicity: ethnicity.trim() } : { race_color: race };
    Object.assign(common, place);
    common.identification = section("identification");
    if (refused) Object.assign(common, { sociodemographic: {}, health_conditions: {}, street_situation: null });
    else Object.assign(common, { sociodemographic: section("sociodemographic"), health_conditions: section("health_conditions"),
      street_situation: section("street_situation") });
    common.refused = refused;
    if (subject.kind === "new") return { new_patient: newPatient(), ...common };
    const extra: Pick<RegistrationBody, "patient" | "cpf" | "cns"> = {};
    if (r && typedIdentity) {
      const changed = changedIdentity(person, r);
      if (changed) extra.patient = changed;
    }
    if (askCpf && newCpf.trim()) extra.cpf = onlyDigits(newCpf);
    if (r && askCns && cns.trim()) extra.cns = cns.replace(/\s/g, "");
    if (subject.kind === "patient") return { patient_id: subject.patientId, ...extra, ...common };
    if (subject.kind === "citizen") return { citizen_id: subject.citizenId, ...extra, ...common };
    return { ...extra, ...common };
  }

  function newPatient(): NewPatient {
    const np: NewPatient = { full_name: squish(person.full_name), birth_date: person.birth_date, sex: person.sex as PatientSex };
    if (squish(socialName)) np.social_name = squish(socialName);
    if (squish(person.mother_name)) np.mother_name = squish(person.mother_name);
    if (subject.kind === "new" && subject.cpf) np.cpf = subject.cpf;
    else if (noCpfReason) np.no_cpf_reason = noCpfReason;
    if (cns.trim()) np.cns = cns.replace(/\s/g, "");
    return np;
  }

  const reject = (message: string, path: string | null) => {
    setStale(false);
    setProblem(message);
    const name = path?.split(".")[0] as Section | undefined;
    if (name && closed.has(name)) setClosed((c) => { const next = new Set(c); next.delete(name); return next; });
    focus.mark(path);
  };

  const save = useMutation({
    mutationFn: (input: RegistrationInput | RegistrationUpdate) =>
      (r ? updateRegistration(r.id, input as RegistrationUpdate, r.version) : createRegistration(input as RegistrationInput)),
    onSuccess: (saved) => {
      for (const key of [ RESIDENTS_KEY, REGISTRY_STATUS_KEY, REGISTRY_COUNT_KEY ]) void client.invalidateQueries({ queryKey: [ key ] });
      if (r) client.setQueryData([ REGISTRATION_KEY, r.id ], saved);
      onSaved(saved);
    },
    onError: (err) => {
      if (isStale(err)) { setProblem(null); focus.mark(null); setStale(true); return; }
      const code = errorCode(err);
      if (code === "already_registered") {
        const id = err instanceof ApiError ? (err.body as { registration_id?: unknown } | null)?.registration_id : null;
        setActiveId(typeof id === "string" ? id : null);
      }
      const path = code === "cpf_taken" ? (askCpf ? "cpf" : null)
        : code === "cns_taken" ? (subject.kind === "new" ? "new_patient.cns" : "cns")
        : code === "cpf_or_reason_required" ? "new_patient.no_cpf_reason"
        : errorPath(err);
      reject(territoryError(err), path);
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    setActiveId(null);
    const input = body();
    const local = registrationProblem(input as RegistrationDraft, today, r ? patientFacts(r) : null);
    if (local) return reject(local.message, local.path);
    setProblem(null);
    focus.mark(null);
    save.mutate(input);
  }

  function setField(name: Section, key: string, value: unknown) {
    setSections((s) => ({ ...s, [name]: { ...s[name], [key]: value } }));
  }

  function changeRefused(value: boolean) {
    setRefused(value);
    if (value) setSections((s) => ({ ...s, sociodemographic: {}, health_conditions: {}, street_situation: {} }));
  }

  const toggle = (name: Section) => setClosed((c) => {
    const next = new Set(c);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const text = (label: string, path: string, value: string, onChange: (v: string) => void, type = "text", inputMode?: "numeric") => (
    <label style={fieldLabel}>
      {label}
      <input ref={focus.reg(path)} type={type} value={value} style={inputStyle} autoComplete="off" inputMode={inputMode}
        aria-invalid={focus.invalid(path)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
  const sectionFields = (name: Section, skip: string[] = []) => FIELDS[name]
    .filter((spec) => !skip.includes(spec.key) && visible(name, spec.key))
    .map((spec) => (
      <Field key={spec.key} spec={spec} path={`${name}.${spec.key}`} label={sectionFieldLabel(name, spec.key)} value={sections[name][spec.key]}
        onChange={(v) => setField(name, spec.key, v)} focus={focus} />
    ));

  const motherUnknown = visible("identification", "desconhece_nome_mae") && (
    <label style={checkLabel}>
      <input type="checkbox" checked={sections.identification.desconhece_nome_mae === "true"}
        ref={(el) => { focus.reg("identification.desconhece_nome_mae")(el); if (!typedIdentity) focus.reg("patient.mother_name")(el); }}
        aria-invalid={focus.invalid("identification.desconhece_nome_mae")}
        onChange={(e) => setField("identification", "desconhece_nome_mae", e.target.checked ? "true" : "false")} />
      {sectionFieldLabel("identification", "desconhece_nome_mae")}
    </label>
  );

  return (
    <form style={form} onSubmit={submit} noValidate aria-label={r ? "Atualizar cadastro individual" : "Novo cadastro individual"}>
      {r?.identity_review_pending && (
        <div style={row}>
          <Tag tone="warn">{IDENTITY_REVIEW_TEXT}</Tag>
          {r.identity_changed_at && (
            <p role="note" style={muted}>
              {`Os dados de identificação foram atualizados pela validação no posto em ${fmtDay(r.identity_changed_at)}; confira e salve para gerar a nova versão.`}
            </p>
          )}
        </div>
      )}

      <CollapsibleSection title={SECTION_TITLE.identification} closed={closed.has("identification")} onToggle={() => toggle("identification")}>
        {typedIdentity ? (
          <>
            <div style={row}>
              {text("Nome completo", `${idPrefix}.full_name`, person.full_name, (v) => setPerson((p) => ({ ...p, full_name: v })))}
              {subject.kind === "new" && text("Nome social", "new_patient.social_name", socialName, setSocialName)}
            </div>
            <div style={row}>
              {text("Data de nascimento", `${idPrefix}.birth_date`, person.birth_date, (v) => setPerson((p) => ({ ...p, birth_date: v })), "date")}
              <label style={fieldLabel}>
                Sexo
                <select ref={focus.reg(`${idPrefix}.sex`)} value={person.sex} style={inputStyle} aria-invalid={focus.invalid(`${idPrefix}.sex`)}
                  onChange={(e) => setPerson((p) => ({ ...p, sex: e.target.value }))}>
                  <option value="">—</option>
                  <option value="female">Feminino</option>
                  <option value="male">Masculino</option>
                </select>
              </label>
            </div>
            <div style={row}>
              {text("Nome da mãe", `${idPrefix}.mother_name`, person.mother_name, (v) => setPerson((p) => ({ ...p, mother_name: v })))}
              {motherUnknown}
            </div>
          </>
        ) : (
          <>
            <div style={grid}>
              {r ? (
                <>
                  <KeyValue k="Nome" v={r.patient.full_name ?? r.patient.display_name ?? "—"} mono={false} />
                  <KeyValue k="Nascimento" v={fmtDay(r.patient.birth_date)} />
                  <KeyValue k="Sexo" v={r.patient.sex ? SEX_LABEL[r.patient.sex] : "—"} mono={false} />
                  <KeyValue k="Mãe" v={r.patient.mother_name ?? "—"} mono={false} />
                  <KeyValue k="Documento" v={patientDocument(r.patient).v} />
                </>
              ) : (
                <KeyValue k="Pessoa" v={(subject.kind === "patient" || subject.kind === "citizen" ? subject.displayName : null) ?? "pessoa sem nome no cadastro"}
                  mono={false} />
              )}
              {locked && <span><Tag tone="ok" mono={false}>{LOCKED_TEXT}</Tag></span>}
            </div>
            <p style={muted}>
              {locked ? "Nome, nascimento, sexo e mãe vêm da validação presencial e não se alteram aqui."
                : "Nome, nascimento, sexo e mãe são os do cadastro do paciente; depois de salvar, abra o cadastro para corrigi-los."}
            </p>
            {motherUnknown && <div style={row}>{motherUnknown}</div>}
          </>
        )}
        <div style={row}>
          {subject.kind === "new" && subject.cpf && <KeyValue k="CPF" v={maskCpf(subject.cpf)} />}
          {subject.kind === "new" && !subject.cpf && (
            <label style={fieldLabel}>
              Motivo de não ter CPF
              <select ref={focus.reg("new_patient.no_cpf_reason")} value={noCpfReason} style={inputStyle}
                aria-invalid={focus.invalid("new_patient.no_cpf_reason")} onChange={(e) => setNoCpfReason(e.target.value)}>
                <option value="">— escolha —</option>
                {DOMAINS.justificativa_nao_possui_cpf.map((o) => <option key={o.code} value={String(o.code)}>{o.label}</option>)}
              </select>
            </label>
          )}
          {r && !r.patient.has_cpf && r.patient.no_cpf_reason && (
            <KeyValue k="Motivo de não ter CPF" v={dictLabel("justificativa_nao_possui_cpf", r.patient.no_cpf_reason)} mono={false} />
          )}
          {askCpf && text("Informar CPF", "cpf", newCpf, (v) => setNewCpf(maskCpf(v)), "text", "numeric")}
          {askCns && text("CNS", subject.kind === "new" ? "new_patient.cns" : "cns", cns, setCns, "text", "numeric")}
        </div>
        <div style={row}>
          <label style={fieldLabel}>
            Raça/cor
            <select ref={focus.reg("patient_demographics.race_color")} value={race} style={inputStyle}
              aria-invalid={focus.invalid("patient_demographics.race_color")} onChange={(e) => setRace(e.target.value)}>
              <option value="">— escolha —</option>
              {RACE_COLORS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>
          {race === INDIGENOUS && text("Etnia (código)", "patient_demographics.ethnicity", ethnicity, setEthnicity, "text", "numeric")}
        </div>
        {sectionFields("identification", [ "desconhece_nome_mae" ])}
      </CollapsibleSection>

      {!refused && ([ "sociodemographic", "health_conditions", "street_situation" ] as const).map((name) => (
        <CollapsibleSection key={name} title={SECTION_TITLE[name]} closed={closed.has(name)} onToggle={() => toggle(name)}>
          {sectionFields(name)}
        </CollapsibleSection>
      ))}

      <fieldset style={fieldset}>
        <legend style={legend}>Recusa</legend>
        <label style={checkLabel}>
          <input ref={focus.reg("refused")} type="checkbox" checked={refused} onChange={(e) => changeRefused(e.target.checked)} />
          O cidadão recusou o cadastro (termo de recusa)
        </label>
        {refused && <p style={muted}>com a recusa, a ficha leva só a identificação; sociodemográfico, condições de saúde e situação de rua não vão</p>}
      </fieldset>

      {problem && <p role="alert" style={alert}>{problem}</p>}
      {activeId && onOpen && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} onClick={() => onOpen(activeId)}>Abrir cadastro</button>
        </div>
      )}
      {stale && (
        <div style={row}>
          <p role="alert" style={alert}>{STALE_TEXT}</p>
          {onReload && <button type="button" style={secondaryButtonStyle} onClick={onReload}>Recarregar</button>}
        </div>
      )}
      <div style={row}>
        <button type="submit" style={save.isPending ? disabledButtonStyle : buttonStyle} disabled={save.isPending}>Salvar cadastro</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

// Lugar do cadastro (L7): o domicílio dado (morador novo ou que se muda para
// ele), o do próprio cadastro (edição) ou, sem domicílio, a equipe.
function placeOf(subject: Subject, household: RegistrationPlace | undefined, teamId: string | undefined): Shared & { is_responsible: boolean } {
  const r = subject.kind === "edit" ? subject.registration : null;
  const patientId = r ? r.patient.id : subject.kind === "patient" ? subject.patientId : null;
  if (household) {
    const same = r && r.household_id === household.id && r.family_id === household.familyId;
    const responsible = same ? r.is_responsible
      : !!household.familyId && !!patientId && household.responsiblePatientId === patientId;
    return { household_id: household.id, ...(household.familyId ? { family_id: household.familyId } : {}), is_responsible: responsible };
  }
  if (r?.household_id) return { household_id: r.household_id, ...(r.family_id ? { family_id: r.family_id } : {}), is_responsible: r.is_responsible };
  const team = r ? r.team.id : teamId;
  return { ...(team ? { team_id: team } : {}), is_responsible: false };
}

// Só o que mudou na identidade (o api grava no paciente sem par validado).
function changedIdentity(person: Identity, r: Registration): PatientIdentity | null {
  const p = r.patient;
  const out: PatientIdentity = {};
  if (squish(person.full_name) !== (p.full_name ?? "")) out.full_name = squish(person.full_name);
  if (person.birth_date !== (p.birth_date ?? "")) out.birth_date = person.birth_date;
  if (person.sex !== (p.sex ?? "")) out.sex = person.sex as PatientSex;
  if (squish(person.mother_name) !== (p.mother_name ?? "")) out.mother_name = squish(person.mother_name);
  return Object.keys(out).length > 0 ? out : null;
}

function CollapsibleSection({ title, closed, onToggle, children }: { title: string; closed: boolean; onToggle(): void; children: ReactNode }) {
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>{title}</legend>
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} aria-expanded={!closed} aria-label={`${closed ? "Mostrar" : "Recolher"} ${title}`}
          onClick={onToggle}>
          {closed ? "Mostrar" : "Recolher"}
        </button>
      </div>
      {!closed && children}
    </fieldset>
  );
}

type Focus = ReturnType<typeof useFieldFocus>;

function Field({ spec, path, label, value, onChange, focus }: {
  spec: FieldSpec; path: string; label: string; value: unknown; onChange(v: unknown): void; focus: Focus;
}) {
  const name = useId();
  const current = typeof value === "string" ? value : "";
  const key = path.split(".").pop() as string;
  if (spec.type === "codes") {
    const chosen = Array.isArray(value) ? (value as number[]) : [];
    return (
      <fieldset style={fieldset}>
        <legend style={legend}>{label}</legend>
        <div style={row}>
          {(spec.domain ? DOMAINS[spec.domain] : []).map((option, i) => (
            <label key={option.code} style={checkLabel}>
              <input ref={i === 0 ? focus.reg(path) : undefined} type="checkbox" checked={chosen.includes(option.code)}
                aria-invalid={i === 0 ? focus.invalid(path) : undefined}
                onChange={(e) => onChange(e.target.checked ? [ ...chosen, option.code ] : chosen.filter((c) => c !== option.code))} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (spec.type === "bool" && YES_NO[key]) {
    const [ yes, no ] = YES_NO[key];
    return (
      <fieldset style={fieldset}>
        <legend style={legend}>{label}</legend>
        <div style={row}>
          <label style={checkLabel}>
            <input ref={focus.reg(path)} type="radio" name={name} checked={current === "true"} aria-invalid={focus.invalid(path)}
              onChange={() => onChange("true")} />
            {yes}
          </label>
          <label style={checkLabel}>
            <input type="radio" name={name} checked={current === "false"} onChange={() => onChange("false")} />
            {no}
          </label>
        </div>
      </fieldset>
    );
  }
  if (spec.type === "bool" && !QUESTIONS.includes(key)) {
    return (
      <label style={checkLabel}>
        <input ref={focus.reg(path)} type="checkbox" checked={current === "true"} aria-invalid={focus.invalid(path)}
          onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
        {label}
      </label>
    );
  }
  const common = { ref: focus.reg(path), style: inputStyle, "aria-invalid": focus.invalid(path) };
  if (spec.type === "code" || spec.type === "bool") {
    const options = spec.type === "bool"
      ? [ { value: "true", label: "Sim" }, { value: "false", label: "Não" } ]
      : (spec.domain ? DOMAINS[spec.domain] : []).map((o) => ({ value: String(o.code), label: o.label }));
    return (
      <label style={fieldLabel}>
        {label}
        <select {...common} value={current} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    );
  }
  return (
    <label style={fieldLabel}>
      {label}
      <input {...common} type={spec.type === "date" ? "date" : "text"} value={current} autoComplete="off"
        inputMode={spec.type === "digits" ? "numeric" : undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
