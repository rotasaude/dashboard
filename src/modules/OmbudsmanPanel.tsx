// Tela "Painel da ouvidoria" (módulo 33; F-33.9): da equipe (`staff`). Período "De"/"Até" (padrão: do dia 1 do mês até hoje, no fuso
// da cidade), que só vai ao api no "Atualizar". Totais por tipo, canal, estado, assunto e unidade; no prazo, tempo médio,
// resolutividade e satisfação. A supressão é do api (api-shapes §2.7; Q28, Q53–Q55): célula escondida aparece "< 5" (inclusive o
// zero escondido), taxa ou média escondida "oculto", e `null` (sem caso) "—". A tela nunca soma células, nunca calcula taxa a partir
// das partes e nunca deduz um valor escondido. A aba "Por profissional" é só do ouvidor e só é lida ao abrir. Nada em storage.
import { useId, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getOmbudsmanDashboard, getOmbudsmanProfessionalsPanel,
  type OmbudsmanDashboard, type OmbudsmanKind, type ProfessionalPanelRow
} from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDay } from "../lib/careLines";
import { fmtNumber } from "../lib/format";
import { HIDDEN_LABEL, SUPPRESSED_LABEL, fmtCount, isSuppressed } from "../lib/smallCount";
import type { SmallCount } from "../lib/types";
import { OMB_DASHBOARD_KEY, STATIC_QUERY, channelLabel, kindLabel, ombudsmanError, stateLabel } from "../lib/ombudsman";
import { DataTable, type Column } from "../components/DataTable";
import { KpiGrid } from "../components/KpiGrid";
import { Panel } from "../components/Panel";
import { StatTile } from "../components/StatTile";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { OmbudsmanGate } from "./ombudsman/OmbudsmanGate";

export const PANEL_SUPPRESSED_NOTE =
  `Contagens de 1 a 4 aparecem como “${SUPPRESSED_LABEL}”; taxas e médias calculadas sobre elas aparecem como “${HIDDEN_LABEL}”. Sem caso, “—”.`;
const UNCLASSIFIED = "sem assunto";
const KINDS: OmbudsmanKind[] = [ "complaint", "report", "praise", "suggestion", "request" ];

// Taxa (`fmtCount(v, "%")`) e média: escondida → "oculto"; `null` → "—"; número → o formato do valor.
const hiddenOr = (v: SmallCount | null, fmt: (n: number) => string): string =>
  isSuppressed(v) ? HIDDEN_LABEL : typeof v === "number" ? fmt(v) : "—";
const rateText = (v: SmallCount | null): string => fmtCount(v, "%");
const daysText = (v: SmallCount | null): string => hiddenOr(v, (n) => `${fmtNumber(n)} dias`);
const scoreText = (v: SmallCount | null): string => hiddenOr(v, (n) => `${fmtNumber(n)} de 5`);

type CountRow = { key: string; label: string; count: SmallCount };
// As células de um objeto por código, na ordem do api, sem o `total` (que é o total geral, já à mostra).
const partition = (obj: Record<string, SmallCount>, label: (code: string) => string): CountRow[] =>
  Object.entries(obj).filter(([ code ]) => code !== "total").map(([ code, count ]) => ({ key: code, label: label(code), count }));

const byKind = (d: OmbudsmanDashboard) => partition(d.by_kind, kindLabel);
const byChannel = (d: OmbudsmanDashboard) => partition(d.by_channel, channelLabel);
const byState = (d: OmbudsmanDashboard) => partition(d.by_state, stateLabel);
const bySubject = (d: OmbudsmanDashboard): CountRow[] =>
  d.by_subject.map((s, i) => ({ key: s.id ?? `sem-assunto-${i}`, label: s.unclassified ? UNCLASSIFIED : s.name, count: s.count }));
const byUnit = (d: OmbudsmanDashboard): CountRow[] => d.by_health_unit.map((u) => ({ key: u.id, label: u.name, count: u.count }));

type SatRow = { key: string; label: string; value: string };
const satisfactionRows = (d: OmbudsmanDashboard): SatRow[] => {
  const s = d.satisfaction;
  return [
    { key: "responses", label: "Pesquisas respondidas", value: fmtCount(s.responses) },
    { key: "met-yes", label: "Demanda atendida: sim", value: fmtCount(s.met.yes) },
    { key: "met-partly", label: "Demanda atendida: em parte", value: fmtCount(s.met.partly) },
    { key: "met-no", label: "Demanda atendida: não", value: fmtCount(s.met.no) },
    { key: "clear-yes", label: "Resposta clara: sim", value: fmtCount(s.clear.yes) },
    { key: "clear-no", label: "Resposta clara: não", value: fmtCount(s.clear.no) },
    { key: "avg", label: "Nota média", value: scoreText(s.avg_score) }
  ];
};

// Os números como pares rótulo/valor: o painel e a impressão do relatório anual usam os mesmos, só com o que o api mandou.
export function numbersRows(d: OmbudsmanDashboard): [ string, string ][] {
  const counts = (prefix: string, rows: CountRow[]): [ string, string ][] => rows.map((r) => [ `${prefix}: ${r.label}`, fmtCount(r.count) ]);
  return [
    [ "Período", `${fmtDay(d.period.from)} a ${fmtDay(d.period.to)}` ],
    [ "Total de manifestações", fmtNumber(d.total) ],
    ...counts("Tipo", byKind(d)),
    ...counts("Canal", byChannel(d)),
    ...counts("Estado", byState(d)),
    ...counts("Assunto", bySubject(d)),
    ...counts("Unidade", byUnit(d)),
    [ "Respondidas no prazo", rateText(d.on_time_rate) ],
    [ "Tempo médio até a conclusão", daysText(d.avg_days_to_conclude) ],
    [ "Resolutividade", rateText(d.resolution_rate) ],
    ...satisfactionRows(d).map((r): [ string, string ] => [ r.label, r.value ])
  ];
}

const countCols = (first: string): Column<CountRow>[] => [
  { label: first, w: "2fr", card: "title", render: (r) => r.label },
  { label: "Manifestações", w: "1fr", align: "right", render: (r) => <span className="mono">{fmtCount(r.count)}</span> }
];
const satCols: Column<SatRow>[] = [
  { label: "Pergunta", w: "2fr", card: "title", render: (r) => r.label },
  { label: "Respostas", w: "1fr", align: "right", render: (r) => <span className="mono">{r.value}</span> }
];

function CountPanel({ title, first, rows, empty }: { title: string; first: string; rows: CountRow[]; empty: string }) {
  return (
    <Panel title={title}>
      <DataTable label={title} cols={countCols(first)} rows={rows} rowKey={(r) => r.key} empty={empty} />
    </Panel>
  );
}

function Summary({ d }: { d: OmbudsmanDashboard }) {
  return (
    <div style={stack}>
      <p style={muted}>{`Período: ${fmtDay(d.period.from)} a ${fmtDay(d.period.to)}`}</p>
      <KpiGrid min={180}>
        <StatTile label="Manifestações" value={d.total} />
        <StatTile label="Respondidas no prazo" value={rateText(d.on_time_rate)} />
        <StatTile label="Tempo médio até a conclusão" value={daysText(d.avg_days_to_conclude)} />
        <StatTile label="Resolutividade" value={rateText(d.resolution_rate)} />
      </KpiGrid>
      <CountPanel title="Por tipo" first="Tipo" rows={byKind(d)} empty="nenhuma manifestação no período" />
      <CountPanel title="Por canal" first="Canal" rows={byChannel(d)} empty="nenhuma manifestação no período" />
      <CountPanel title="Por estado" first="Estado" rows={byState(d)} empty="nenhuma manifestação no período" />
      <CountPanel title="Por assunto" first="Assunto" rows={bySubject(d)} empty="nenhuma manifestação no período" />
      <CountPanel title="Por unidade" first="Unidade" rows={byUnit(d)} empty="nenhuma unidade referida no período" />
      <Panel title="Satisfação">
        <DataTable label="Satisfação" cols={satCols} rows={satisfactionRows(d)} rowKey={(r) => r.key} />
      </Panel>
      <p style={muted}>{PANEL_SUPPRESSED_NOTE}</p>
    </div>
  );
}

// Sem supressão (o api manda só ao ouvidor): os números como vieram, uma linha por profissional.
function ByProfessional({ period }: { period: Period }) {
  const q = useQuery({
    queryKey: [ OMB_DASHBOARD_KEY, "professionals", period.from, period.to ],
    queryFn: () => getOmbudsmanProfessionalsPanel(period), ...STATIC_QUERY
  });
  const cols: Column<ProfessionalPanelRow>[] = [
    { label: "Profissional", w: "2fr", card: "title", render: (r) => r.professional.name },
    ...KINDS.map((k): Column<ProfessionalPanelRow> => ({
      label: kindLabel(k), w: "1fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.by_kind[k])}</span>
    })),
    { label: "Total", w: "1fr", align: "right", render: (r) => <span className="mono">{fmtNumber(r.total)}</span> }
  ];
  return (
    <Panel title="Por profissional" sub="só o ouvidor vê este recorte">
      {q.isPending && <p className="mono" style={muted}>carregando…</p>}
      {q.isError && <p role="alert" style={alert}>{ombudsmanError(q.error)}</p>}
      {q.data && (
        <DataTable label="Por profissional" cols={cols} rows={q.data} rowKey={(r) => r.professional.id}
          empty="nenhum profissional referido no período" />
      )}
    </Panel>
  );
}

type Period = { from: string; to: string };
type Tab = "summary" | "professionals";

function periodProblem(p: Period): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to)) return "informe o início e o fim";
  return p.from > p.to ? "o início vem antes do fim" : null;
}

function PanelBody({ lead, today }: { lead: boolean; today: string }) {
  const initial: Period = { from: `${today.slice(0, 8)}01`, to: today };
  const [ draft, setDraft ] = useState<Period>(initial);
  const [ applied, setApplied ] = useState<Period>(initial);
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ tab, setTab ] = useState<Tab>("summary");
  const queryClient = useQueryClient();
  const uid = useId();
  const tabId = (key: Tab) => `${uid}-tab-${key}`;
  const panelId = `${uid}-panel`;
  const panel = useQuery({
    queryKey: [ OMB_DASHBOARD_KEY, applied.from, applied.to ],
    queryFn: () => getOmbudsmanDashboard(applied), ...STATIC_QUERY
  });

  function apply() {
    const found = periodProblem(draft);
    setProblem(found);
    if (found) return;
    // Mesmo período: a chave não muda, então "Atualizar" relê à mão o resumo e, se aberto, o recorte por profissional.
    if (draft.from === applied.from && draft.to === applied.to) void queryClient.refetchQueries({ queryKey: [ OMB_DASHBOARD_KEY ], type: "active" });
    else setApplied(draft);
  }

  const tabs: { key: Tab; label: string }[] = [ { key: "summary", label: "Resumo" }, ...(lead ? [ { key: "professionals" as const, label: "Por profissional" } ] : []) ];
  return (
    <div style={stack}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>
          De
          <input type="date" value={draft.from} style={inputStyle} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </label>
        <label style={fieldLabel}>
          Até
          <input type="date" value={draft.to} style={inputStyle} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </label>
        <button type="button" style={buttonStyle} onClick={apply}>Atualizar</button>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div role="tablist" aria-label="Recortes do painel" style={tabList}>
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <button key={t.key} id={tabId(t.key)} type="button" role="tab" aria-selected={active} aria-controls={active ? panelId : undefined}
              className="mono" style={active ? tabActive : tabIdle}
              onClick={() => setTab(t.key)}>{t.label}</button>
          );
        })}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} style={stack}>
        {tab === "summary" && (
          <>
            {panel.isPending && <p className="mono" style={muted}>carregando…</p>}
            {panel.isError && <p role="alert" style={alert}>{ombudsmanError(panel.error)}</p>}
            {panel.data && <Summary d={panel.data} />}
          </>
        )}
        {tab === "professionals" && lead && <ByProfessional period={applied} />}
      </div>
    </div>
  );
}

export function OmbudsmanPanel({ now }: { now?: Date } = {}) {
  return (
    <OmbudsmanGate title="Painel da ouvidoria" sub="volume, prazos, resolutividade e satisfação" allow={(r) => r.staff}>
      {(roles) => <PanelBody lead={roles.lead} today={todayInCity(now ?? new Date())} />}
    </OmbudsmanGate>
  );
}

// Mesmos estilos das abas de SurveillanceQueue/RegulationQueue (cópias locais lá também; nenhum é exportado).
const tabList: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4 };
const tabBase: CSSProperties = { padding: "4px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 0.3 };
const tabIdle: CSSProperties = { ...tabBase, border: "1px solid var(--rule2)", background: "transparent", color: "var(--ink2)" };
const tabActive: CSSProperties = { ...tabBase, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)" };
