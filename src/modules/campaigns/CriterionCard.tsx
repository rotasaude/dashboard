// src/modules/campaigns/CriterionCard.tsx
import type { AttendanceOutcome, CampaignOptions, Criterion, CriterionPeriod, NamedRef, RequestKind } from "../../lib/api";
import { CRITERION_LABEL, OUTCOME_LABEL, REQUEST_KIND_LABEL, validateCriterion } from "../../lib/campaigns";
import { sortByName } from "../../lib/territory";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alertStyle, cardStyle, checkStyle, fieldsetStyle, labelStyle, legendStyle, noteStyle, rowStyle } from "./styles";

// Um cartão por critério clínico (spec 2026-09-29 §7; construtor A, D10).
// Cada tipo tem os próprios campos, e o problema do cartão aparece nele,
// com a mesma regra que trava a contagem (validateCriterion).
export interface CriterionCardProps {
  criterion: Criterion;
  options: CampaignOptions;
  today: string;
  onChange(next: Criterion): void;
  onRemove(): void;
}

const REQUEST_KINDS: RequestKind[] = [ "return", "referral" ];

export function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [ ...list, value ];
}

export function CriterionCard({ criterion: c, options, today, onChange, onRemove }: CriterionCardProps) {
  const title = CRITERION_LABEL[c.kind];
  const problem = validateCriterion(c, today);

  return (
    <section aria-label={title} style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <button type="button" aria-label={`Remover ${title}`} onClick={onRemove} style={secondaryButtonStyle}>remover</button>
      </div>

      {c.kind === "protocol_period" && (
        options.protocols.length === 0
          ? <p style={noteStyle}>nenhum protocolo com triagem concluída ainda</p>
          : (
            <label style={labelStyle}>
              Protocolo
              <select value={c.protocol_name} onChange={(e) => onChange({ ...c, protocol_name: e.target.value })} style={inputStyle}>
                <option value="">escolha…</option>
                {options.protocols.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          )
      )}

      {c.kind === "triage_tier" && (
        <CheckboxGroup legend="Faixas" values={options.tiers} selected={c.tiers} label={(t) => t}
          emptyText="nenhuma faixa registrada ainda"
          onToggle={(t) => onChange({ ...c, tiers: toggleValue(c.tiers, t) })} />
      )}

      {c.kind === "attendance_outcome" && (
        <>
          <CheckboxGroup legend="Desfechos" values={options.outcomes} selected={c.outcomes}
            label={(o) => OUTCOME_LABEL[o] ?? o} emptyText="nenhum desfecho disponível"
            onToggle={(o) => onChange({ ...c, outcomes: toggleValue(c.outcomes, o as AttendanceOutcome) })} />
          <UnitSelect label="Unidade do atendimento (opcional)" value={c.health_unit_id} units={options.units}
            onChange={(id) => onChange({ ...c, health_unit_id: id })} />
        </>
      )}

      {c.kind === "appointment_request_open" && (
        <>
          <CheckboxGroup legend="Tipo do pedido (opcional — nenhum marcado vale os dois)" values={REQUEST_KINDS}
            selected={c.kinds ?? []} label={(k) => REQUEST_KIND_LABEL[k] ?? k}
            onToggle={(k) => onChange({ ...c, kinds: toggleValue<RequestKind>(c.kinds ?? [], k as RequestKind) })} />
          <UnitSelect label="Unidade de destino (opcional)" value={c.target_unit_id} units={options.units}
            onChange={(id) => onChange({ ...c, target_unit_id: id })} />
        </>
      )}

      {"from" in c && (
        <PeriodFields period={c} today={today} onChange={(p) => onChange({ ...c, ...p })} />
      )}

      {problem && <p role="alert" style={alertStyle}>{problem}</p>}
    </section>
  );
}

function CheckboxGroup({ legend, values, selected, label, emptyText, onToggle }: {
  legend: string; values: string[]; selected: string[]; label(v: string): string; emptyText?: string; onToggle(v: string): void;
}) {
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>{legend}</legend>
      {values.length === 0 && emptyText && <p style={noteStyle}>{emptyText}</p>}
      {values.map((v) => (
        <label key={v} style={checkStyle}>
          <input type="checkbox" checked={selected.includes(v)} onChange={() => onToggle(v)} />
          {label(v)}
        </label>
      ))}
    </fieldset>
  );
}

// "" = qualquer unidade: sai como undefined, e buildAudience tira a chave.
function UnitSelect({ label, value, units, onChange }: {
  label: string; value: string | undefined; units: NamedRef[]; onChange(id: string | undefined): void;
}) {
  // Unidade fora das opções (desativada): continua filtrando, então aparece
  // marcada como inativa, como no recorte do AudienceBuilder.
  const inactive = !!value && !units.some((u) => u.id === value);
  return (
    <label style={labelStyle}>
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} style={inputStyle}>
        <option value="">qualquer unidade</option>
        {inactive && <option value={value}>(unidade inativa)</option>}
        {sortByName(units).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </label>
  );
}

function PeriodFields({ period, today, onChange }: {
  period: CriterionPeriod; today: string; onChange(p: CriterionPeriod): void;
}) {
  return (
    <div style={rowStyle}>
      <label style={labelStyle}>
        De
        <input type="date" value={period.from} max={today}
          onChange={(e) => onChange({ from: e.target.value, to: period.to })} style={inputStyle} />
      </label>
      <label style={labelStyle}>
        Até
        <input type="date" value={period.to} max={today}
          onChange={(e) => onChange({ from: period.from, to: e.target.value })} style={inputStyle} />
      </label>
    </div>
  );
}
