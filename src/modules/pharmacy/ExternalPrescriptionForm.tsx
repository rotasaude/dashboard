// Receita externa e controlado de fora da rede (módulo 27a; F-27.6; contrato §7, D4, H3, H6). Passo 2 do PharmacyExternal, depois da
// pessoa (PersonStart da farmácia): paciente existente (`patient_id`) ou pessoa nova (`new_patient` + `duplicates_reviewed`, forma do 24a e
// da vigilância), profissional (nome, conselho CRM/CRO/COREN, UF, número), data da receita, número da notificação (só o farmacêutico
// digita; obrigatório com item de lista A ou B) e os itens do catálogo (quantidade prescrita, unidade — padrão a de dispensação —,
// posologia, uso contínuo). NÃO há campo de antimicrobiano nem de retenção: o api calcula `retention_required` pelo catálogo (H6).
// Controlado tem validade fixa de 30 dias, do api (H3). Todas as conferências de uma vez numa lista `role="alert"`; as do api voltam por
// `problems`, cujo `items[i]` é o índice no CORPO ENVIADO (aqui, todos os itens, na ordem da tela). 409 `duplicate_suspected` volta à busca
// de pessoa (L28 do 24a). Tudo digitado fica numa recusa. CPF, nome, medicamento e número da notificação vão só no corpo do POST; nada em
// URL, log ou storage.
import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createExternalPrescription, errorCode, type ExternalItemInput, type ExternalPrescriptionInput, type NewPatient, type PatientSex,
  type PharmacyLocation, type PrescriptionView, type StockItem
} from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { SEX_OPTIONS } from "../../lib/profile";
import {
  COUNCILS, NOTIFICATION_LISTS, NOTIFICATION_REQUIRED, UFS, issuedOnProblem, locationRoles, notificationNumberProblem, pharmacyRefusals,
  prescriberProblem, problemItemIndex, quantityProblem, toApiQuantity
} from "../../lib/pharmacy";
import { DOMAINS, newPatientProblem } from "../../lib/territoryDictionaries";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import type { PersonChoice, PersonRestart } from "../territory/PersonStart";
import { ItemSearch } from "./ItemSearch";

export const EXTERNAL_CONTROLLED_PHARMACIST_ONLY = "receita externa de controlado só o farmacêutico registra";
export const EXTERNAL_EXPIRED = "a receita já nasce vencida — confira a data da receita";
export const NO_ITEMS = "acrescente ao menos um medicamento";
export const CONTROLLED_VALIDITY_NOTE = "Controlado de fora da rede: a receita vale 30 dias a partir da data dela.";
const CITIZEN_ONLY = "esta pessoa só tem cadastro declarado pelo cidadão, sem validação presencial — valide a identidade antes";

// Códigos que, nesta tela, têm frase própria (a do `pharmacyError` fala de dispensação).
const EXTERNAL_TEXT: Record<string, string> = {
  prescription_expired: EXTERNAL_EXPIRED,
  controlled_requires_pharmacist: EXTERNAL_CONTROLLED_PHARMACIST_ONLY
};

interface Line { key: number; item: StockItem; quantity: string; unit: string; dosage: string; continuous: boolean }
interface Row { key: string; item?: string; text: string }

const squish = (value: string) => value.replace(/\s+/g, " ").trim();
type PersonPart = { patient_id: string } | { new_patient: NewPatient; duplicates_reviewed?: boolean };

export function ExternalPrescriptionForm({ choice, location, today = todayInCity(), delayMs, onCreated, onRestart, onChangePerson }: {
  choice: PersonChoice; location: PharmacyLocation; today?: string; delayMs?: number;
  onCreated(p: PrescriptionView): void; onRestart(restart: PersonRestart): void; onChangePerson(): void;
}) {
  const pharmacist = locationRoles(location).pharmacist;
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

  const [ prescriberName, setPrescriberName ] = useState("");
  const [ council, setCouncil ] = useState("");
  const [ councilState, setCouncilState ] = useState("");
  const [ councilNumber, setCouncilNumber ] = useState("");
  const [ issuedOn, setIssuedOn ] = useState("");
  const [ notification, setNotification ] = useState("");
  const [ lines, setLines ] = useState<Line[]>([]);
  const [ rows, setRows ] = useState<Row[]>([]);
  const nextKey = useRef(1);

  function newPatient(): NewPatient {
    const np: NewPatient = { full_name: squish(fullName), birth_date: birth, sex: sex as PatientSex };
    if (squish(mother)) np.mother_name = squish(mother);
    if (cpf) np.cpf = cpf;
    else if (reason) np.no_cpf_reason = reason;
    const cnsDigits = cns.replace(/\s/g, "");
    if (cnsDigits) np.cns = cnsDigits;
    return np;
  }

  function person(): PersonPart | null {
    if (choice.kind === "patient") return { patient_id: choice.patientId };
    if (choice.kind === "new") return { new_patient: newPatient(), ...(choice.duplicatesReviewed ? { duplicates_reviewed: true } : {}) };
    return null;
  }

  const create = useMutation({
    gcTime: 0,
    mutationFn: (input: ExternalPrescriptionInput) => createExternalPrescription(input),
    onSuccess: (created) => onCreated(created),
    onError: (err, input) => {
      // K4 (L28 do 24a): nome e nascimento de um paciente existente — de volta à busca, com a frase e os candidatos.
      if (errorCode(err) === "duplicate_suspected" && "new_patient" in input) {
        const np = input.new_patient;
        onRestart({ query: { full_name: np.full_name, birth_date: np.birth_date, ...(np.mother_name ? { mother_name: np.mother_name } : {}) },
          ...(np.cpf ? { cpf: np.cpf } : {}), search: true });
        return;
      }
      const sent = lines.map((l) => l.item);
      setRows(pharmacyRefusals(err).map((r, n) => {
        const index = problemItemIndex(r.path);
        return { key: `${n}-${r.path}-${r.code}`, text: EXTERNAL_TEXT[r.code] ?? r.text, item: index !== null ? sent[index]?.name : undefined };
      }));
    }
  });

  function problems(input: PersonPart | null): Row[] {
    const out: Row[] = [];
    const add = (text: string | null, item?: string) => { if (text) out.push({ key: String(out.length), text, item }); };
    if (input === null) add(CITIZEN_ONLY);
    else if ("new_patient" in input) add(newPatientProblem(input.new_patient, today)?.message ?? null);
    add(prescriberProblem({ name: prescriberName, council, council_state: councilState, council_number: councilNumber }));
    add(issuedOnProblem(issuedOn, today));
    if (pharmacist) {
      add(notificationNumberProblem(notification));
      const listed = lines.some((l) => l.item.controlled && NOTIFICATION_LISTS.includes(l.item.controlled_list ?? ""));
      if (listed && notification.trim() === "") add(NOTIFICATION_REQUIRED);
    }
    if (lines.length === 0) add(NO_ITEMS);
    for (const l of lines) {
      const name = l.item.name;
      add(quantityProblem(l.quantity, "a quantidade prescrita"), name);
      const unit = squish(l.unit).length;
      if (unit < 1 || unit > 30) add("a unidade tem de 1 a 30 caracteres", name);
      const dosage = squish(l.dosage).length;
      if (dosage < 3 || dosage > 500) add("a posologia tem de 3 a 500 caracteres", name);
      if (l.item.controlled && !pharmacist) add(EXTERNAL_CONTROLLED_PHARMACIST_ONLY, name);
    }
    return out;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const who = person();
    const found = problems(who);
    if (found.length > 0 || who === null) { setRows(found); return; }
    setRows([]);
    const items: ExternalItemInput[] = lines.map((l) => ({
      catalog_item_id: l.item.catalog_item_id, quantity: toApiQuantity(l.quantity), quantity_unit: squish(l.unit),
      dosage_instructions: squish(l.dosage), continuous: l.continuous
    }));
    const input: ExternalPrescriptionInput = {
      ...who,
      location_id: location.id,
      prescriber: { name: squish(prescriberName), council, council_state: councilState, council_number: councilNumber.trim() },
      issued_on: issuedOn,
      ...(pharmacist && notification.trim() ? { notification_number: notification.trim() } : {}),
      items
    };
    create.mutate(input);
  }

  const edited = <T,>(set: (v: T) => void) => (value: T) => { set(value); setRows([]); };
  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label style={fieldLabel}>
      {label}
      <input type={type} value={value} style={inputStyle} autoComplete="off" onChange={(e) => edited(set)(e.target.value)} />
    </label>
  );
  const patch = (key: number, over: Partial<Line>) => { setRows([]); setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...over } : l))); };
  function add(item: StockItem) {
    setRows([]);
    setLines((cur) => [ ...cur, { key: nextKey.current++, item, quantity: "", unit: item.dispensing_unit, dosage: "", continuous: false } ]);
  }

  const hasControlled = lines.some((l) => l.item.controlled);
  const personLine = choice.kind === "new"
    ? (choice.identity.full_name ? `Pessoa nova: ${choice.identity.full_name}` : "Pessoa nova com o CPF informado")
    : `Paciente: ${choice.displayName ?? "sem nome"}`;

  return (
    <form style={form} onSubmit={submit} noValidate aria-label="Dados da receita externa">
      <div style={row}>
        <span>{personLine}</span>
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
                {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
        <legend style={legend}>Profissional e receita</legend>
        <div style={row}>
          {field("Nome do profissional", prescriberName, setPrescriberName)}
          <label style={fieldLabel}>
            Conselho
            <select value={council} style={inputStyle} onChange={(e) => edited(setCouncil)(e.target.value)}>
              <option value="">Escolha</option>
              {COUNCILS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            UF do conselho
            <select value={councilState} style={inputStyle} onChange={(e) => edited(setCouncilState)(e.target.value)}>
              <option value="">Escolha</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          {field("Número no conselho", councilNumber, setCouncilNumber)}
        </div>
        <div style={row}>
          {field("Data da receita", issuedOn, setIssuedOn, "date")}
          {pharmacist && field("Número da notificação", notification, setNotification)}
        </div>
        {hasControlled && <small style={muted}>{CONTROLLED_VALIDITY_NOTE}</small>}
      </fieldset>
      <fieldset style={fieldset}>
        <legend style={legend}>Medicamentos</legend>
        <ItemSearch label="Acrescentar medicamento" delayMs={delayMs} disabled={create.isPending} onPick={add} />
        {lines.map((l) => (
          <fieldset key={l.key} style={fieldset}>
            <legend style={legend}>{l.item.name}</legend>
            {l.item.controlled && <Tag tone="warn">{`controlado · lista ${l.item.controlled_list ?? "—"}`}</Tag>}
            <div style={row}>
              {field("Quantidade prescrita", l.quantity, (v) => patch(l.key, { quantity: v }))}
              {field("Unidade", l.unit, (v) => patch(l.key, { unit: v }))}
            </div>
            {field("Posologia", l.dosage, (v) => patch(l.key, { dosage: v }))}
            <label style={checkLabel}>
              <input type="checkbox" checked={l.continuous} onChange={(e) => patch(l.key, { continuous: e.target.checked })} />
              Uso contínuo
            </label>
            <div style={row}>
              <button type="button" style={secondaryButtonStyle} disabled={create.isPending}
                onClick={() => { setRows([]); setLines((cur) => cur.filter((x) => x.key !== l.key)); }}>Remover</button>
            </div>
          </fieldset>
        ))}
      </fieldset>
      {rows.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {rows.map((r) => <li key={r.key}>{r.item && <span>{`${r.item}: `}</span>}{r.text}</li>)}
          </ul>
        </div>
      )}
      <div style={row}>
        <button type="submit" style={create.isPending ? disabledButtonStyle : buttonStyle} disabled={create.isPending}>Registrar receita externa</button>
      </div>
    </form>
  );
}
