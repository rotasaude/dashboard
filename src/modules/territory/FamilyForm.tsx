// src/modules/territory/FamilyForm.tsx
// Família do domicílio (contrato §4; preflight A14, C19). Corpo real:
// `{ responsible: { patient_id }, income_band: "3", members_count,
// living_since: "AAAA-MM", moved_out }` com a versão do DOMICÍLIO — cada
// gravação é uma versão nova dele, e a resposta é o domicílio inteiro. O
// responsável é um morador com cadastro, escolhido só na criação (nunca muda);
// a família nasce morando e "mudou-se" é definitivo. A gravação da família
// regrava o domicílio, então as regras dele (moradores ≥ soma das famílias,
// um responsável por família) também recusam aqui — com a frase que manda
// corrigir o domicílio. Sem rascunho; 409 stale_version como no domicílio.
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addFamily, errorCode, updateFamily, type Family, type FamilyInput, type Household, type HouseholdAddress } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { DOMAINS, familyProblem, householdProblem } from "../../lib/territoryDictionaries";
import { HOUSEHOLDS_KEY, HOUSEHOLD_KEY, NO_NAME, STALE_TEXT, errorPath, isStale, territoryError } from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, form, muted, row } from "../exams/styles";
import { useFieldFocus } from "./fieldFocus";

export interface FamilyCandidate { patient_id: string; display_name: string | null }

const FIX_HOUSEHOLD = "edite o domicílio antes de salvar a família";
const MOVED_OUT_WARNING = "a mudança é definitiva: a família sai do domicílio e não volta nem muda mais";
// Recusas do domicílio vindas da gravação da família (C19).
const HOUSEHOLD_PATH_TEXT: Record<string, string> = {
  "living_conditions.nu_moradores": `o número de moradores do domicílio é menor que a soma das famílias — ${FIX_HOUSEHOLD}`,
  families: "o domicílio não aceita esta família (recusa, tipo de imóvel ou responsável repetido) — confira o domicílio"
};
const FAMILY_FIELDS = [ "responsible.patient_id", "income_band", "members_count", "living_since", "moved_out" ];

// O domicílio como está gravado, para conferir as regras dele com a família no lugar.
function householdAsInput(h: Household) {
  return {
    micro_area_id: h.micro_area.id, address: h.address.street ? (h.address as HouseholdAddress) : null, property_type: h.property_type,
    living_conditions: h.living_conditions ?? null, contact_phone: h.contact_phone, refused: h.refused
  };
}

export function FamilyForm({ household, initial, candidates, onSaved, onCancel, today = todayInCity() }: {
  household: Household; initial?: Family; candidates: FamilyCandidate[]; onSaved(h: Household): void; onCancel(): void; today?: string;
}) {
  const client = useQueryClient();
  const focus = useFieldFocus();
  const [ responsible, setResponsible ] = useState("");
  const [ income, setIncome ] = useState(initial?.income_band ?? "");
  const [ members, setMembers ] = useState(initial?.members_count === null || initial?.members_count === undefined ? "" : String(initial.members_count));
  const [ since, setSince ] = useState(initial?.living_since ?? "");
  const [ movedOut, setMovedOut ] = useState(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);

  const reject = (message: string, path: string | null) => { setStale(false); setProblem(message); focus.mark(path); };

  function input(): FamilyInput {
    const count = members.trim();
    return {
      ...(initial ? {} : { responsible: { patient_id: responsible } }),
      income_band: income || null,
      // Não inteiro (NaN, 2.5) a regra recusa antes de enviar; nunca arredondado.
      members_count: count === "" ? null : Number(count),
      living_since: since.trim() || null,
      moved_out: movedOut
    };
  }

  const save = useMutation({
    mutationFn: (body: FamilyInput) => (initial
      ? updateFamily(initial.id, body, household.version)
      : addFamily(household.id, body as FamilyInput & { responsible: { patient_id: string } }, household.version)),
    onSuccess: (h) => {
      void client.invalidateQueries({ queryKey: [ HOUSEHOLDS_KEY ] });
      void client.invalidateQueries({ queryKey: [ HOUSEHOLD_KEY ] });
      onSaved(h);
    },
    onError: (err) => {
      if (isStale(err)) { setProblem(null); focus.mark(null); setStale(true); return; }
      const path = errorPath(err);
      if (errorCode(err) === "invalid_household") return reject(HOUSEHOLD_PATH_TEXT[path ?? ""] ?? `o domicílio tem um campo a corrigir — ${FIX_HOUSEHOLD}`, null);
      reject(territoryError(err), path);
    }
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (save.isPending) return;
    const body = input();
    const own = familyProblem(body, { propertyType: household.property_type, today, isNew: !initial });
    if (own) return reject(own.message, own.path);
    const changed = { members_count: body.members_count, moved_out: movedOut,
      responsible: { patient_id: initial ? initial.responsible.patient_id : responsible } };
    const families = initial ? household.families.map((f) => (f.id === initial.id ? { ...f, ...changed } : f)) : [ ...household.families, changed ];
    const rules = householdProblem(householdAsInput(household), families);
    if (rules) return reject(FAMILY_FIELDS.includes(rules.path) ? rules.message : `${rules.message} — ${FIX_HOUSEHOLD}`, null);
    setProblem(null);
    focus.mark(null);
    save.mutate(body);
  }

  function reload() {
    void client.invalidateQueries({ queryKey: [ HOUSEHOLD_KEY ] });
    void client.invalidateQueries({ queryKey: [ HOUSEHOLDS_KEY ] });
    onCancel();
  }

  return (
    <form style={form} onSubmit={submit} noValidate aria-label={initial ? "Editar família" : "Nova família"}>
      {initial ? <p style={{ margin: 0 }}>{`Responsável: ${initial.responsible.display_name ?? NO_NAME}`}</p> : (
        <label style={fieldLabel}>
          Responsável
          <select ref={focus.reg("responsible.patient_id")} value={responsible} style={inputStyle}
            aria-invalid={focus.invalid("responsible.patient_id")} onChange={(e) => setResponsible(e.target.value)}>
            <option value="">— escolha —</option>
            {candidates.map((c) => <option key={c.patient_id} value={c.patient_id}>{c.display_name ?? NO_NAME}</option>)}
          </select>
        </label>
      )}
      {!initial && candidates.length === 0 && <p style={muted}>nenhum morador com cadastro disponível — cadastre o responsável antes</p>}
      <div style={row}>
        <label style={fieldLabel}>
          Renda familiar
          <select ref={focus.reg("income_band")} value={income} style={inputStyle} aria-invalid={focus.invalid("income_band")}
            onChange={(e) => setIncome(e.target.value)}>
            <option value="">não informada</option>
            {DOMAINS.renda_familiar.map((r) => <option key={r.code} value={String(r.code)}>{r.label}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Número de membros
          <input ref={focus.reg("members_count")} value={members} style={inputStyle} inputMode="numeric" autoComplete="off"
            aria-invalid={focus.invalid("members_count")} onChange={(e) => setMembers(e.target.value)} />
        </label>
        <label style={fieldLabel}>
          Reside desde
          <input ref={focus.reg("living_since")} type="month" value={since} style={inputStyle} max={today.slice(0, 7)}
            aria-invalid={focus.invalid("living_since")} onChange={(e) => setSince(e.target.value)} />
        </label>
      </div>
      {initial && (
        <>
          <label style={checkLabel}>
            <input ref={focus.reg("moved_out")} type="checkbox" checked={movedOut} onChange={(e) => setMovedOut(e.target.checked)} />
            Mudou-se
          </label>
          {movedOut && <p style={alert}>{MOVED_OUT_WARNING}</p>}
        </>
      )}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {stale && (
        <div style={row}>
          <p role="alert" style={alert}>{STALE_TEXT}</p>
          <button type="button" style={secondaryButtonStyle} onClick={reload}>Recarregar</button>
        </div>
      )}
      <div style={row}>
        <button type="submit" style={save.isPending ? disabledButtonStyle : buttonStyle} disabled={save.isPending}>Salvar família</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
