// src/modules/vectorControl/CadencesPanel.tsx
// Cadência de visita do controle vetorial (módulo 35a, F-35.4; contrato §5, §12; Q8, Q10). Linhas (bairro ou cidade, risco ou
// qualquer, ponto estratégico, dias) editadas em memória; "Salvar cadência" troca a lista INTEIRA (PUT /cadences, step-up). A tela
// recusa antes o que o VectorControl::SaveCadences recusaria: dias 7–365 inteiros (Catalog::CADENCE_DAYS), a mesma tripla
// (bairro, risco, PE) repetida e o ponto estratégico com risco (o seletor de risco trava em "qualquer"). Recusa do api com
// `path` items[i](.campo) cai na linha; bairro apagado no meio → a frase e UMA releitura dos bairros. Sem dado de pessoa.
import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getVectorDomains, listCadences, listPanelNeighborhoods, putCadences, type RiskClass, type VectorCadence } from "../../lib/api";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { sortByName } from "../../lib/territory";
import {
  RISK_CLASSES, STATIC_QUERY, VC_CADENCES_KEY, VC_DOMAINS_KEY, domainLabel, vectorError, vectorRefusals
} from "../../lib/vectorControl";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, muted, okText, row, stack } from "../exams/styles";

// Ordem de aplicação (VectorControl::Cadence.days_for; §5 com a Q10): da linha mais específica para a mais geral.
export const CADENCE_ORDER = "Ordem de aplicação — ponto estratégico: (bairro, PE) → (cidade, PE) → cadência do PE dos parâmetros (strategic_point_days); "
  + "demais: (bairro, risco) → (bairro, qualquer) → (cidade, risco) → (cidade, qualquer) → cadência padrão dos parâmetros (default_days).";
export const CADENCE_DAYS_TEXT = "dias de 7 a 365, só números inteiros";
export const CADENCE_REPEATED = (k: number | null) =>
  `linha repetida: mesmo bairro, risco e ponto estratégico ${k === null ? "de outra linha" : `da linha ${k}`}`;
export const CADENCE_NEIGHBORHOOD_GONE = "este bairro não existe mais — a lista de bairros foi relida";
export const CADENCE_PE_RISK = "o ponto estratégico não tem classe de risco";
export const CADENCE_SAVED = "cadência salva";

export type CadenceDraft = { neighborhood_id: string; risk_class: string; strategic_point: boolean; days: string };
type Row = CadenceDraft & { key: number };
export type CadenceField = "neighborhood_id" | "risk_class" | "days";
export type CadenceProblem = { index: number; field: CadenceField; text: string };

const DAYS = /^\d+$/;
const daysOf = (raw: string): number => (DAYS.test(raw.trim()) ? Number(raw.trim()) : NaN);
const tripleOf = (d: CadenceDraft) => `${d.neighborhood_id.toLowerCase()}|${d.strategic_point ? "" : d.risk_class}|${d.strategic_point}`;

// Na ordem do SaveCadences.check, linha a linha: PE com risco, dias, e por fim a tripla repetida (marcada no risco, a coluna
// que distingue a linha). O api devolve só o primeiro; aqui vão todos.
export function cadenceProblems(rows: CadenceDraft[]): CadenceProblem[] {
  const out: CadenceProblem[] = [];
  const seen = new Map<string, number>();
  rows.forEach((d, index) => {
    if (d.strategic_point && d.risk_class !== "") out.push({ index, field: "risk_class", text: CADENCE_PE_RISK });
    const days = daysOf(d.days);
    if (!Number.isInteger(days) || days < 7 || days > 365) out.push({ index, field: "days", text: CADENCE_DAYS_TEXT });
    const triple = tripleOf(d);
    const first = seen.get(triple);
    if (first !== undefined) out.push({ index, field: "risk_class", text: CADENCE_REPEATED(first + 1) });
    else seen.set(triple, index);
  });
  return out;
}

export const toCadences = (rows: CadenceDraft[]): VectorCadence[] => rows.map((d) => ({
  neighborhood_id: d.neighborhood_id === "" ? null : d.neighborhood_id,
  risk_class: d.strategic_point || d.risk_class === "" ? null : (d.risk_class as RiskClass),
  strategic_point: d.strategic_point,
  days: daysOf(d.days)
}));

let nextKey = 0;
const rowOf = (c: VectorCadence): Row => ({
  key: ++nextKey, neighborhood_id: c.neighborhood_id ?? "", risk_class: c.risk_class ?? "", strategic_point: c.strategic_point, days: String(c.days)
});

export function CadencesPanel({ onGoToSecurity }: { onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const cadences = useQuery({ queryKey: [ VC_CADENCES_KEY ], queryFn: listCadences, ...STATIC_QUERY });
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ formKey, setFormKey ] = useState(0);

  async function saved(result: VectorCadence[]) {
    setNotice(CADENCE_SAVED);
    queryClient.setQueryData([ VC_CADENCES_KEY ], result);
    setFormKey((k) => k + 1);
    // O PUT já devolve a lista gravada ({ items }, na ordem do api): ela fica na tela, sem reler as cadências. Os domínios levam
    // a cadência ao boletim: relidos.
    await queryClient.invalidateQueries({ queryKey: [ VC_DOMAINS_KEY ] });
  }

  return (
    <Panel title="Cadência de visita" sub="dias entre duas visitas ao imóvel">
      <div style={stack}>
        <p style={muted}>{CADENCE_ORDER}</p>
        {cadences.isError ? (
          <div style={row}>
            <p role="alert" style={alert}>{vectorError(cadences.error)}</p>
            <button type="button" style={secondaryButtonStyle} disabled={cadences.isFetching} onClick={() => void cadences.refetch()}>Tentar de novo</button>
          </div>
        ) : !cadences.data ? <p role="status" style={muted}>Carregando…</p>
          : (
            <>
              {notice && <p role="status" style={okText}>{notice}</p>}
              <CadenceForm key={formKey} loaded={cadences.data} onEdit={() => setNotice(null)} onSaved={saved} onGoToSecurity={onGoToSecurity} />
            </>
          )}
      </div>
    </Panel>
  );
}

function CadenceForm({ loaded, onEdit, onSaved, onGoToSecurity }: {
  loaded: VectorCadence[]; onEdit(): void; onSaved(r: VectorCadence[]): Promise<void>; onGoToSecurity?: () => void;
}) {
  const queryClient = useQueryClient();
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, ...STATIC_QUERY });
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, ...STATIC_QUERY });
  const [ rows, setRows ] = useState<Row[]>(() => loaded.map(rowOf));
  const [ problems, setProblems ] = useState<CadenceProblem[]>([]);
  const [ confirming, setConfirming ] = useState(false);
  const result = useRef<VectorCadence[] | null>(null);
  const baseId = useId();

  // Mexer numa linha fecha a confirmação aberta: o que se confirma é sempre o que está na tela.
  function changed(next: Row[]) {
    setRows(next);
    setConfirming(false);
    onEdit();
  }
  function set(key: number, patch: Partial<CadenceDraft>, field: CadenceField) {
    const index = rows.findIndex((r) => r.key === key);
    changed(rows.map((r) => (r.key === key ? { ...r, ...patch, ...(patch.strategic_point ? { risk_class: "" } : {}) } : r)));
    // O campo mexido perde a marca; bairro, risco e PE mudam a tripla, então também a marca de linha repetida.
    setProblems((list) => list.filter((p) => !(p.index === index && (p.field === field || (field !== "days" && p.field !== "days")))));
  }
  function remove(key: number) {
    changed(rows.filter((r) => r.key !== key));
    setProblems([]);
  }
  function add() {
    changed([ ...rows, { key: ++nextKey, neighborhood_id: "", risk_class: "", strategic_point: false, days: "" } ]);
  }
  function review() {
    const found = cadenceProblems(rows);
    setProblems(found);
    setConfirming(found.length === 0);
  }

  const errId = (index: number, field: CadenceField) => `${baseId}-${index}-${field}`;
  const problem = (index: number, field: CadenceField) => problems.find((p) => p.index === index && p.field === field)?.text ?? null;
  const aria = (index: number, field: CadenceField) =>
    (problem(index, field) ? { "aria-invalid": true as const, "aria-describedby": errId(index, field) } : {});
  const err = (index: number, field: CadenceField) => {
    const text = problem(index, field);
    return text ? <span id={errId(index, field)} style={alert}>{text}</span> : null;
  };

  const nbList = sortByName(neighborhoods.data ?? []);
  const nbKnown = new Set(nbList.map((n) => n.id));
  const risks = domains.data?.risk_classes ?? RISK_CLASSES.map((code) => ({ code, label: code }));
  const riskText = (code: string) => (domains.data ? domainLabel(domains.data.risk_classes, code) : code);
  const indexed = rows.map((r, index) => ({ ...r, index }));

  return (
    <div style={stack}>
      {neighborhoods.isError && <p role="alert" style={alert}>{vectorError(neighborhoods.error)}</p>}
      <DataTable label="Linhas da cadência" rows={indexed} rowKey={(r) => String(r.key)} empty="nenhuma linha — vale a cadência dos parâmetros" cols={[
        { label: "Bairro", w: "2fr", card: "pair", render: (r) => (
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <select aria-label={`Bairro da linha ${r.index + 1}`} value={r.neighborhood_id} style={inputStyle} {...aria(r.index, "neighborhood_id")}
              onChange={(e) => set(r.key, { neighborhood_id: e.target.value }, "neighborhood_id")}>
              <option value="">cidade</option>
              {/* O bairro gravado aparece mesmo fora da lista (ainda carregando ou apagado): código cru. */}
              {r.neighborhood_id !== "" && !nbKnown.has(r.neighborhood_id) && <option value={r.neighborhood_id}>{r.neighborhood_id}</option>}
              {nbList.map((n) => <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>)}
            </select>
            {err(r.index, "neighborhood_id")}
          </span>
        ) },
        { label: "Risco", w: "2fr", card: "pair", render: (r) => (
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <select aria-label={`Risco da linha ${r.index + 1}`} value={r.strategic_point ? "" : r.risk_class} disabled={r.strategic_point}
              style={inputStyle} {...aria(r.index, "risk_class")} onChange={(e) => set(r.key, { risk_class: e.target.value }, "risk_class")}>
              <option value="">qualquer</option>
              {r.risk_class !== "" && !risks.some((k) => k.code === r.risk_class) && <option value={r.risk_class}>{riskText(r.risk_class)}</option>}
              {risks.map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
            </select>
            {err(r.index, "risk_class")}
          </span>
        ) },
        { label: "Ponto estratégico", card: "pair", render: (r) => (
          <label style={checkLabel}>
            <input type="checkbox" aria-label={`Ponto estratégico da linha ${r.index + 1}`} checked={r.strategic_point}
              onChange={(e) => set(r.key, { strategic_point: e.target.checked }, "risk_class")} />
            PE
          </label>
        ) },
        { label: "Dias", card: "pair", render: (r) => (
          <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <input aria-label={`Dias da linha ${r.index + 1}`} value={r.days} inputMode="numeric" style={inputStyle} {...aria(r.index, "days")}
              onChange={(e) => set(r.key, { days: e.target.value }, "days")} />
            {err(r.index, "days")}
          </span>
        ) },
        { label: "Ações", card: "actions", render: (r) => (
          <button type="button" style={secondaryButtonStyle} onClick={() => remove(r.key)}>{`Remover linha ${r.index + 1}`}</button>
        ) }
      ]} />
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} onClick={add}>Adicionar linha</button>
        <button type="button" style={buttonStyle} onClick={review}>Salvar cadência</button>
      </div>
      {confirming && (
        <SensitiveAction
          title="Salvar a cadência de visita"
          description={`Troca a lista inteira (${rows.length} ${rows.length === 1 ? "linha" : "linhas"}); a linha que saiu deixa de valer.`}
          requiresStepUp
          run={async () => { result.current = await putCadences(toCadences(rows)); }}
          onDone={() => { setConfirming(false); if (result.current) void onSaved(result.current); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => {
            const refusal = vectorRefusals(e)[0];
            const m = /^items\[(\d+)\](?:\.(\w+))?$/.exec(refusal.path);
            if (refusal.code !== "invalid_request" || !m) return refusal.text;
            const index = Number(m[1]);
            const key = m[2];
            let mark: CadenceProblem;
            if (key === "neighborhood_id") {
              mark = { index, field: "neighborhood_id", text: CADENCE_NEIGHBORHOOD_GONE };
              void queryClient.invalidateQueries({ queryKey: PANEL_NEIGHBORHOODS_KEY });
            } else if (key === "days") mark = { index, field: "days", text: CADENCE_DAYS_TEXT };
            else if (key === "risk_class") mark = { index, field: "risk_class", text: CADENCE_PE_RISK };
            else if (key === undefined) mark = { index, field: "risk_class", text: CADENCE_REPEATED(null) };
            else return refusal.text;
            setProblems([ mark ]);
            return mark.text;
          }}
        />
      )}
    </div>
  );
}
