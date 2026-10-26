// src/modules/territory/HouseholdForm.tsx
// Ficha de cadastro domiciliar (contrato §4; preflight C7, C8; errata 5.2 e
// 5.3). Cada "Salvar" é uma versão nova do domicílio e uma ficha; sem
// rascunho: o que está na tela vive só neste componente (nada em storage,
// URL ou log). Endereço com o tipo de logradouro DNE à parte; bairro do
// cadastro de bairros (módulo 11) só se ativo e com até 30 letras — senão o
// bairro em texto. Moradia só para os tipos que a levam, e só os campos que
// cabem no tipo; trocar o tipo limpa o que deixou de caber (não esconde).
// Recusa: só o endereço (se houver), sem moradia. Uma recusa por vez, com
// foco no campo; 409 stale_version: a frase, o que foi digitado fica e
// "Recarregar" relê o domicílio. Sem step-up (só microárea pede).
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createHousehold, errorCode, listPanelNeighborhoods, updateHousehold, type CodedSection, type Household, type HouseholdAddress,
  type HouseholdInput
} from "../../lib/api";
import { onlyDigits } from "../../lib/attendance";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import {
  DOMAINS, SECTIONS, STRING_DOMAINS, allowsLivingConditions, householdProblem, livingFieldAllowed, usableNeighborhood, type FieldSpec
} from "../../lib/territoryDictionaries";
import { FIELD_LABELS, sectionFieldLabel } from "../../lib/territoryLabels";
import { HOUSEHOLDS_KEY, HOUSEHOLD_KEY, STALE_TEXT, STATIC_QUERY, errorPath, isStale, territoryError } from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { useFieldFocus } from "./fieldFocus";

// ─── Estado da tela (texto como digitado; o corpo converte) ────────────────
type AddressDraft = {
  zip: string; street_type: string; street: string; number: string; no_number: boolean; complement: string;
  neighborhood_id: string; district: string; reference: string;
};
// code → "83"; codes → number[]; bool → "" | "true" | "false"; count/texto → string; object → Draft.
type Draft = Record<string, unknown>;

const STREET_TYPE_DEFAULT = "081"; // Rua
const FAMILIES_TEXT = "o domicílio ainda tem famílias morando: só domicílio (tipo 01) sem recusa leva famílias — registre a mudança delas antes";

function addressDraft(address: Household["address"] | undefined): AddressDraft {
  const a = address ?? {};
  return {
    zip: a.zip ?? "", street_type: a.street_type ?? STREET_TYPE_DEFAULT, street: a.street ?? "", number: a.number ?? "",
    no_number: a.no_number === true, complement: a.complement ?? "", neighborhood_id: a.neighborhood_id ?? "", district: a.district ?? "",
    reference: a.reference ?? ""
  };
}

function toDraft(fields: FieldSpec[], values: CodedSection | null | undefined): Draft {
  const draft: Draft = {};
  for (const spec of fields) {
    const value = values?.[spec.key];
    if (value === null || value === undefined) continue;
    if (spec.type === "object") draft[spec.key] = toDraft(spec.fields ?? [], value as CodedSection);
    else if (spec.type === "codes") draft[spec.key] = Array.isArray(value) ? value : [];
    else draft[spec.key] = String(value);
  }
  return draft;
}

// O que vai no corpo: só o preenchido; contagem que não é inteiro vai como
// veio para a regra recusar com a frase dela (nunca cortada nem arredondada).
function fromDraft(fields: FieldSpec[], draft: Draft, visible: (key: string) => boolean = () => true): CodedSection | null {
  const out: CodedSection = {};
  for (const spec of fields) {
    if (!visible(spec.key)) continue;
    const raw = draft[spec.key];
    if (raw === undefined) continue;
    if (spec.type === "object") {
      const nested = fromDraft(spec.fields ?? [], raw as Draft);
      if (nested) out[spec.key] = nested;
      continue;
    }
    if (spec.type === "codes") {
      if (Array.isArray(raw) && raw.length > 0) out[spec.key] = raw as number[];
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    if (spec.type === "bool") out[spec.key] = text === "true";
    else if (spec.type === "code") out[spec.key] = Number(text);
    else if (spec.type === "count") out[spec.key] = /^\d+$/.test(text) ? Number(text) : text;
    else out[spec.key] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}

const LIVING = SECTIONS.living_conditions;
// Ordem da tela: a dos rótulos (localização e situação primeiro).
const LIVING_ORDER = Object.keys(FIELD_LABELS.living_conditions ?? {});
const LIVING_FIELDS = [ ...LIVING ].sort((a, b) => LIVING_ORDER.indexOf(a.key) - LIVING_ORDER.indexOf(b.key));

// Campos que dependem de outra resposta só aparecem com ela.
function livingVisible(type: string, draft: Draft, key: string): boolean {
  if (!livingFieldAllowed(type, key)) return false;
  if (key === "tipo_origem_energia_eletrica") return draft.st_disponibilidade_energia_eletrica === "true";
  if (key === "animais_no_domicilio" || key === "quantos_animais_no_domicilio") return draft.st_animais_no_domicilio === "true";
  return true;
}

function keepAllowed(type: string, draft: Draft): Draft {
  return Object.fromEntries(Object.entries(draft).filter(([ key ]) => livingFieldAllowed(type, key)));
}

function addressBody(a: AddressDraft): HouseholdAddress {
  const text = (value: string) => value.trim() || null;
  return {
    zip: onlyDigits(a.zip), street_type: a.street_type, street: a.street.trim(), number: a.no_number ? null : text(a.number),
    no_number: a.no_number, complement: text(a.complement), neighborhood_id: a.neighborhood_id || null,
    district: a.neighborhood_id ? null : text(a.district), reference: text(a.reference)
  };
}

const addressBlank = (a: AddressDraft) =>
  !a.no_number && [ a.zip, a.street, a.number, a.complement, a.neighborhood_id, a.district, a.reference ].every((v) => !v.trim());

export function HouseholdForm({ microAreaId, initial, onSaved, onCancel }: {
  microAreaId: string; initial?: Household; onSaved(h: Household): void; onCancel(): void;
}) {
  const client = useQueryClient();
  const focus = useFieldFocus();
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, ...STATIC_QUERY });
  const [ address, setAddress ] = useState<AddressDraft>(() => addressDraft(initial?.address));
  const [ propertyType, setPropertyType ] = useState(initial?.property_type ?? "");
  const [ living, setLiving ] = useState<Draft>(() => toDraft(LIVING, initial?.living_conditions));
  const [ phone, setPhone ] = useState(initial?.contact_phone ?? "");
  const [ refused, setRefused ] = useState(initial?.refused ?? false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);

  const showLiving = !refused && allowsLivingConditions(propertyType);
  const all = neighborhoods.data ?? [];
  const usable = all.filter(usableNeighborhood);
  // O bairro gravado que deixou de servir aparece marcado (a regra explica e pede o texto).
  const unusable = all.find((n) => n.id === address.neighborhood_id && !usableNeighborhood(n));

  const setA = (patch: Partial<AddressDraft>) => setAddress((a) => ({ ...a, ...patch }));
  const reject = (message: string, path: string | null) => { setStale(false); setProblem(message); focus.mark(path); };

  function input(): HouseholdInput {
    return {
      micro_area_id: initial?.micro_area.id ?? microAreaId,
      address: refused && addressBlank(address) ? null : addressBody(address),
      property_type: propertyType,
      living_conditions: showLiving ? fromDraft(LIVING, living, (key) => livingVisible(propertyType, living, key)) : null,
      contact_phone: onlyDigits(phone) || null,
      refused
    };
  }

  const save = useMutation({
    mutationFn: (body: HouseholdInput) => (initial ? updateHousehold(initial.id, body, initial.version) : createHousehold(body)),
    onSuccess: (h) => {
      void client.invalidateQueries({ queryKey: [ HOUSEHOLDS_KEY ] });
      void client.invalidateQueries({ queryKey: [ HOUSEHOLD_KEY ] });
      onSaved(h);
    },
    onError: (err) => {
      if (isStale(err)) { setProblem(null); focus.mark(null); setStale(true); return; }
      const path = errorPath(err);
      reject(errorCode(err) === "invalid_household" && path === "families" ? FAMILIES_TEXT : territoryError(err), path);
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    const body = input();
    const local = householdProblem(body, initial?.families ?? [], { neighborhoods: neighborhoods.data });
    if (local) return reject(local.message, local.path);
    setProblem(null);
    focus.mark(null);
    save.mutate(body);
  }

  function reload() {
    void client.invalidateQueries({ queryKey: [ HOUSEHOLD_KEY ] });
    void client.invalidateQueries({ queryKey: [ HOUSEHOLDS_KEY ] });
    onCancel();
  }

  function changeType(type: string) {
    setPropertyType(type);
    setLiving((l) => (allowsLivingConditions(type) ? keepAllowed(type, l) : {}));
  }

  function changeRefused(value: boolean) {
    setRefused(value);
    if (value) setLiving({});
  }

  const text = (label: string, path: string, value: string, onChange: (v: string) => void, extra: { inputMode?: "numeric" | "tel" } = {}) => (
    <label style={fieldLabel}>
      {label}
      <input ref={focus.reg(path)} value={value} style={inputStyle} autoComplete="off" inputMode={extra.inputMode}
        aria-invalid={focus.invalid(path)} onChange={(e) => onChange(e.target.value)} />
    </label>
  );

  return (
    <form style={form} onSubmit={submit} noValidate aria-label={initial ? "Editar domicílio" : "Novo domicílio"}>
      <fieldset style={fieldset}>
        <legend style={legend}>Endereço</legend>
        <div style={row}>
          {text("CEP", "address.zip", address.zip, (v) => setA({ zip: v }), { inputMode: "numeric" })}
          <label style={fieldLabel}>
            Tipo de logradouro
            <select ref={focus.reg("address.street_type")} value={address.street_type} style={inputStyle}
              aria-invalid={focus.invalid("address.street_type")} onChange={(e) => setA({ street_type: e.target.value })}>
              <option value="">— escolha —</option>
              {STRING_DOMAINS.tipo_logradouro.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
            </select>
          </label>
          {text("Logradouro", "address.street", address.street, (v) => setA({ street: v }))}
        </div>
        <p style={muted}>o nome do logradouro sem o tipo: “das Flores”, não “Rua das Flores”</p>
        <div style={row}>
          {!address.no_number && text("Número", "address.number", address.number, (v) => setA({ number: v }))}
          <label style={checkLabel}>
            <input type="checkbox" checked={address.no_number} onChange={(e) => setA({ no_number: e.target.checked, number: "" })} />
            Sem número
          </label>
          {text("Complemento", "address.complement", address.complement, (v) => setA({ complement: v }))}
        </div>
        <div style={row}>
          <label style={fieldLabel}>
            Bairro
            <select ref={focus.reg("address.neighborhood_id")} value={address.neighborhood_id} style={inputStyle}
              aria-invalid={focus.invalid("address.neighborhood_id")} onChange={(e) => setA({ neighborhood_id: e.target.value })}>
              <option value="">— escrever o bairro —</option>
              {usable.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
              {unusable && <option value={unusable.id}>{`${unusable.name} (não serve para a ficha)`}</option>}
            </select>
          </label>
          {!address.neighborhood_id && text("Bairro (texto)", "address.district", address.district, (v) => setA({ district: v }))}
        </div>
        {neighborhoods.isError && <p style={muted}>não foi possível ler os bairros — escreva o bairro no campo de texto</p>}
        <div style={row}>
          {text("Ponto de referência", "address.reference", address.reference, (v) => setA({ reference: v }))}
          {text("Telefone de contato", "contact_phone", phone, setPhone, { inputMode: "tel" })}
        </div>
      </fieldset>

      <label style={fieldLabel}>
        Tipo de imóvel
        <select ref={focus.reg("property_type")} value={propertyType} style={inputStyle} aria-invalid={focus.invalid("property_type")}
          onChange={(e) => changeType(e.target.value)}>
          <option value="">— escolha —</option>
          {DOMAINS.tipo_de_imovel.map((t) => <option key={t.code} value={String(t.code)}>{t.label}</option>)}
        </select>
      </label>

      {showLiving && (
        <fieldset style={fieldset}>
          <legend style={legend}>Condições de moradia</legend>
          <LivingFields type={propertyType} value={living} onChange={setLiving} focus={focus} />
        </fieldset>
      )}

      <fieldset style={fieldset}>
        <legend style={legend}>Recusa</legend>
        <label style={checkLabel}>
          <input ref={focus.reg("refused")} type="checkbox" checked={refused} onChange={(e) => changeRefused(e.target.checked)} />
          O morador recusou o cadastro do domicílio
        </label>
        {refused && <p style={muted}>com a recusa, a ficha leva só o endereço (se houver); condições de moradia e famílias não vão</p>}
      </fieldset>

      {problem && <p role="alert" style={alert}>{problem}</p>}
      {stale && (
        <div style={row}>
          <p role="alert" style={alert}>{STALE_TEXT}</p>
          <button type="button" style={secondaryButtonStyle} onClick={reload}>Recarregar</button>
        </div>
      )}
      <div style={row}>
        <button type="submit" style={save.isPending ? disabledButtonStyle : buttonStyle} disabled={save.isPending}>Salvar domicílio</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

type Focus = ReturnType<typeof useFieldFocus>;

function LivingFields({ type, value, onChange, focus }: { type: string; value: Draft; onChange(d: Draft): void; focus: Focus }) {
  const fields = LIVING_FIELDS.filter((spec) => livingVisible(type, value, spec.key));
  return (
    <>
      {fields.map((spec) => (
        <Field key={spec.key} spec={spec} path={`living_conditions.${spec.key}`} label={sectionFieldLabel("living_conditions", spec.key)}
          value={value[spec.key]} onChange={(v) => onChange({ ...value, [spec.key]: v })} focus={focus} />
      ))}
    </>
  );
}

function Field({ spec, path, label, value, onChange, focus }: {
  spec: FieldSpec; path: string; label: string; value: unknown; onChange(v: unknown): void; focus: Focus;
}) {
  const common = { ref: focus.reg(path), style: inputStyle, "aria-invalid": focus.invalid(path) };
  if (spec.type === "object") {
    const nested = (value as Draft | undefined) ?? {};
    // O obrigatório primeiro (o foco de uma recusa do objeto cai nele).
    const fields = [ ...(spec.fields ?? []) ].sort((a, b) => Number(!!b.required) - Number(!!a.required));
    return (
      <fieldset style={fieldset}>
        <legend style={legend}>{label}</legend>
        {fields.map((sub) => (
          <Field key={sub.key} spec={sub} path={`${path}.${sub.key}`}
            label={sectionFieldLabel("living_conditions", `${spec.key}.${sub.key}`)}
            value={nested[sub.key]} onChange={(v) => onChange({ ...nested, [sub.key]: v })} focus={focus} />
        ))}
      </fieldset>
    );
  }
  if (spec.type === "codes") {
    const chosen = Array.isArray(value) ? (value as number[]) : [];
    return (
      <fieldset style={fieldset}>
        <legend style={legend}>{label}</legend>
        <div style={row}>
          {(spec.domain ? DOMAINS[spec.domain] : []).map((option, i) => (
            <label key={option.code} style={checkLabel}>
              <input ref={i === 0 ? focus.reg(path) : undefined} type="checkbox" checked={chosen.includes(option.code)}
                onChange={(e) => onChange(e.target.checked ? [ ...chosen, option.code ] : chosen.filter((c) => c !== option.code))} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const current = typeof value === "string" ? value : "";
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
  const numeric = spec.type === "count" || spec.type === "digits";
  return (
    <label style={fieldLabel}>
      {label}
      <input {...common} value={current} autoComplete="off" inputMode={numeric ? "numeric" : undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
