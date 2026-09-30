// src/modules/analytics/Filters.tsx
// Seletores do Analytics (spec §8). O recorte é estado da aba, não da URL: o
// `?bairro=` dos painéis do módulo 11 não é tocado. Recorte vazio = null.
import { useQuery } from "@tanstack/react-query";
import { listAuthorProtocols, listPanelNeighborhoods, type AnalyticsUnit, type Granularity } from "../../lib/api";
import {
  ANALYTICS_PROTOCOLS_KEY, GRANULARITY_LABEL, RANGE_OPTIONS, protocolOptions, rangeLabel, withGranularity,
  type AnalyticsRange
} from "../../lib/analytics";
import { NONE, PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { sortByName } from "../../lib/territory";
import { inputStyle } from "../../components/formStyles";

export const filterRowStyle = { display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" as const };
const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 2, fontSize: 12, color: "var(--ink2)", minWidth: 180 };
const errorStyle = { fontSize: 11, color: "var(--down)" };

export function RangeControls({ value, onChange }: { value: AnalyticsRange; onChange(next: AnalyticsRange): void }) {
  return (
    <div role="group" aria-label="Período" style={filterRowStyle}>
      <label style={labelStyle}>
        Agrupar por
        <select value={value.granularity} style={inputStyle}
          onChange={(e) => onChange(withGranularity(value, e.target.value as Granularity))}>
          {(Object.keys(GRANULARITY_LABEL) as Granularity[]).map((g) => <option key={g} value={g}>{GRANULARITY_LABEL[g]}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        Intervalo
        <select value={String(value.count)} style={inputStyle}
          onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}>
          {RANGE_OPTIONS[value.granularity].map((n) => <option key={n} value={n}>{rangeLabel(value.granularity, n)}</option>)}
        </select>
      </label>
    </div>
  );
}

export function NeighborhoodSelect({ value, onChange }: { value: string | null; onChange(next: string | null): void }) {
  const list = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods });
  return (
    <label style={labelStyle}>
      Bairro
      <select value={value ?? ""} style={inputStyle} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Todos</option>
        <option value={NONE}>Sem bairro</option>
        {sortByName(list.data ?? []).map((n) => (
          <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>
        ))}
      </select>
      {list.isError && <span style={errorStyle}>não foi possível carregar os bairros</span>}
    </label>
  );
}

export function UnitSelect({ value, units, onChange }: { value: string | null; units: AnalyticsUnit[]; onChange(next: string | null): void }) {
  // `units` é o `data.units` da resposta (todas as unidades da cidade,
  // independentes do recorte). Enquanto a resposta não chega, a escolhida
  // continua visível.
  const missing = !!value && !units.some((u) => u.health_unit_id === value);
  return (
    <label style={labelStyle}>
      Unidade
      <select value={value ?? ""} style={inputStyle} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Todas</option>
        {missing && <option value={value ?? ""}>unidade selecionada</option>}
        {units.map((u) => (
          <option key={u.health_unit_id} value={u.health_unit_id}>{u.active ? u.name : `${u.name} (inativa)`}</option>
        ))}
      </select>
    </label>
  );
}

interface ProtocolSelectProps {
  name: string | null;
  version: number | null;
  withVersion: boolean;
  onChange(name: string | null, version: number | null): void;
}

export function ProtocolSelect({ name, version, withVersion, onChange }: ProtocolSelectProps) {
  const list = useQuery({ queryKey: ANALYTICS_PROTOCOLS_KEY, queryFn: listAuthorProtocols });
  const options = protocolOptions(list.data ?? []);
  const versions = options.find((o) => o.name === name)?.versions ?? [];
  return (
    <>
      <label style={labelStyle}>
        Protocolo
        {/* Trocar o protocolo sempre zera a versão: versão sozinha é 422 invalid_protocol. */}
        <select value={name ?? ""} style={inputStyle} onChange={(e) => onChange(e.target.value || null, null)}>
          <option value="">Todos</option>
          {options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
        </select>
        {list.isError && <span style={errorStyle}>não foi possível carregar os protocolos</span>}
      </label>
      {withVersion && (
        <label style={labelStyle}>
          Versão
          <select value={version === null ? "" : String(version)} disabled={!name} style={inputStyle}
            onChange={(e) => onChange(name, e.target.value ? Number(e.target.value) : null)}>
            <option value="">Todas</option>
            {versions.map((v) => <option key={v} value={v}>versão {v}</option>)}
          </select>
        </label>
      )}
    </>
  );
}
