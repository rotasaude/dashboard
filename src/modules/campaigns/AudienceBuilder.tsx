// src/modules/campaigns/AudienceBuilder.tsx
import { Fragment, useState } from "react";
import type { AudienceGeo, CampaignOptions, Criterion, CriterionKind, NamedRef } from "../../lib/api";
import {
  CRITERION_KINDS, CRITERION_LABEL, MAX_CRITERIA, MAX_NEIGHBORHOODS, newCriterion, nextCriterionKey, validateGeo,
  type AudienceDraft
} from "../../lib/campaigns";
import { normalizeName, sortByName } from "../../lib/territory";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CriterionCard, toggleValue } from "./CriterionCard";
import { alertStyle, checkStyle, columnStyle, fieldsetStyle, labelStyle, legendStyle, noteStyle } from "./styles";

// Construtor A (spec 2026-09-29 §7; D3, D10): 1. recorte geográfico, 2. zero a
// sete critérios clínicos somados por E. Controlado: o rascunho mora no editor.
export interface AudienceBuilderProps {
  draft: AudienceDraft;
  options: CampaignOptions;
  today: string;
  onChange(next: AudienceDraft): void;
}

const SCOPES: { scope: AudienceGeo["scope"]; label: string }[] = [
  { scope: "city", label: "Cidade toda" },
  { scope: "unit", label: "Unidade de referência" },
  { scope: "neighborhoods", label: "Bairros" }
];

function geoFor(scope: AudienceGeo["scope"]): AudienceGeo {
  if (scope === "unit") return { scope, health_unit_id: "" };
  if (scope === "neighborhoods") return { scope, neighborhood_ids: [] };
  return { scope: "city" };
}

export function AudienceBuilder({ draft, options, today, onChange }: AudienceBuilderProps) {
  const [ adding, setAdding ] = useState(false);
  const geo = draft.geo;
  const geoProblem = validateGeo(geo);
  const full = draft.criteria.length >= MAX_CRITERIA;
  // Mesma regra do bairro inativo: a unidade do rascunho que saiu de `options`
  // continua selecionada e nomeada, em vez de o select mostrar "escolha…" e o
  // público seguir com um id que a pessoa não vê.
  const inactiveUnit = geo.scope === "unit" && geo.health_unit_id !== "" &&
    !options.units.some((u) => u.id === geo.health_unit_id);

  function setGeo(next: AudienceGeo) {
    onChange({ ...draft, geo: next });
  }
  function add(kind: CriterionKind) {
    setAdding(false);
    onChange({ ...draft, criteria: [ ...draft.criteria, { key: nextCriterionKey(), criterion: newCriterion(kind, today) } ] });
  }
  function replace(key: string, criterion: Criterion) {
    onChange({ ...draft, criteria: draft.criteria.map((d) => (d.key === key ? { key, criterion } : d)) });
  }
  function remove(key: string) {
    onChange({ ...draft, criteria: draft.criteria.filter((d) => d.key !== key) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <fieldset style={{ ...fieldsetStyle, flexDirection: "column", flexWrap: "nowrap" }}>
        <legend style={legendStyle}>1. Recorte geográfico</legend>
        <div role="radiogroup" aria-label="Recorte geográfico" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {SCOPES.map((s) => (
            <label key={s.scope} style={checkStyle}>
              <input type="radio" name="campaign-geo-scope" checked={geo.scope === s.scope}
                onChange={() => { if (geo.scope !== s.scope) setGeo(geoFor(s.scope)); }} />
              {s.label}
            </label>
          ))}
        </div>
        {geo.scope === "unit" && (
          <label style={{ ...labelStyle, maxWidth: 360 }}>
            Unidade
            <select value={geo.health_unit_id} onChange={(e) => setGeo({ scope: "unit", health_unit_id: e.target.value })} style={inputStyle}>
              <option value="">escolha…</option>
              {inactiveUnit && <option value={geo.health_unit_id}>(unidade inativa)</option>}
              {sortByName(options.units).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
        {inactiveUnit && <p role="alert" style={alertStyle}>a unidade deste rascunho não está mais ativa — escolha outra</p>}
        {geo.scope === "neighborhoods" && (
          <NeighborhoodChecklist selected={geo.neighborhood_ids} neighborhoods={options.neighborhoods}
            onChange={(ids) => setGeo({ scope: "neighborhoods", neighborhood_ids: ids })} />
        )}
        {geoProblem && <p role="alert" style={alertStyle}>{geoProblem}</p>}
      </fieldset>

      <section aria-label="2. Critérios clínicos" style={columnStyle}>
        <strong style={{ fontSize: 13 }}>2. Critérios clínicos</strong>
        <p style={noteStyle}>opcional — quem entra precisa atender a todos os critérios ao mesmo tempo</p>
        {draft.criteria.map((d, i) => (
          <Fragment key={d.key}>
            {i > 0 && <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink3)", textAlign: "center" }}>e também</p>}
            <CriterionCard criterion={d.criterion} options={options} today={today}
              onChange={(c) => replace(d.key, c)} onRemove={() => remove(d.key)} />
          </Fragment>
        ))}
        {adding ? (
          <div role="group" aria-label="Tipos de critério" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {CRITERION_KINDS.map((kind) => (
              <button key={kind} type="button" style={secondaryButtonStyle} onClick={() => add(kind)}>{CRITERION_LABEL[kind]}</button>
            ))}
            <button type="button" style={secondaryButtonStyle} onClick={() => setAdding(false)}>Fechar lista</button>
          </div>
        ) : (
          <div>
            <button type="button" disabled={full} style={full ? disabledButtonStyle : buttonStyle} onClick={() => setAdding(true)}>
              Adicionar critério clínico
            </button>
          </div>
        )}
        {full && <p style={noteStyle}>no máximo {MAX_CRITERIA} critérios</p>}
      </section>
    </div>
  );
}

// Bairro do rascunho que não está mais em `options` (desativado depois) fica
// VISÍVEL e desmarcável: sumir da tela e continuar no público seria contar
// gente que a pessoa não vê.
function NeighborhoodChecklist({ selected, neighborhoods, onChange }: {
  selected: string[]; neighborhoods: NamedRef[]; onChange(ids: string[]): void;
}) {
  const [ filter, setFilter ] = useState("");
  const known = new Set(neighborhoods.map((n) => n.id));
  const unknown = selected.filter((id) => !known.has(id));
  const key = normalizeName(filter);
  const visible = sortByName(neighborhoods).filter((n) => !key || normalizeName(n.name).includes(key));
  const full = selected.length >= MAX_NEIGHBORHOODS;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ ...labelStyle, maxWidth: 320 }}>
        Filtrar bairros
        <input value={filter} onChange={(e) => setFilter(e.target.value)} style={inputStyle} />
      </label>
      <p className="mono" style={noteStyle}>{selected.length} de no máximo {MAX_NEIGHBORHOODS} escolhidos</p>
      {unknown.length > 0 && (
        <div role="group" aria-label="Bairros fora da lista" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <p style={alertStyle}>bairros deste rascunho que não estão mais ativos — desmarque para tirar do público</p>
          {unknown.map((id) => (
            <label key={id} style={checkStyle}>
              <input type="checkbox" checked onChange={() => onChange(selected.filter((x) => x !== id))} />
              (bairro inativo)
            </label>
          ))}
        </div>
      )}
      <div role="group" aria-label="Lista de bairros"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 6 }}>
        {visible.map((n) => {
          const checked = selected.includes(n.id);
          return (
            <label key={n.id} style={checkStyle}>
              <input type="checkbox" checked={checked} disabled={!checked && full}
                onChange={() => onChange(toggleValue(selected, n.id))} />
              {n.name}
            </label>
          );
        })}
        {visible.length === 0 && (
          <p style={noteStyle}>
            {neighborhoods.length === 0 ? "nenhum bairro ativo — cadastre em Cidade → Território" : "nenhum bairro com esse nome"}
          </p>
        )}
      </div>
    </div>
  );
}
