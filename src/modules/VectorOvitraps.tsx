// src/modules/VectorOvitraps.tsx
// "Ovitrampas" da coordenação de endemias e do laboratório de entomologia (módulo 35a, F-35.5; contrato §6, §10, §17; Q9, Q23,
// Q28). Papel: coordenação e laboratório (OvitrapReadingsController#reader!, OvitrapsController#neighborhood_scope; os dois
// contam, CountReading). Três abas, e só a aberta lê:
//   - "A contar": as palhetas a contar e as contadas (GET /ovitrap_readings?state=, sem domicílio nem pessoa: STATIC_QUERY,
//     relidas depois de cada contagem), uma lista por vez; "Contar" e "Corrigir contagem" abrem o CountForm. Tela velha relê UMA vez.
//   - "Ovitrampas": as do bairro, por status (GET /ovitraps?neighborhood_id=). A rota grava a trilha territory_registry com os
//     imóveis da página (ovitraps_controller#shown), então a leitura é NOMINAL: lida ao escolher bairro e status, nunca sozinha.
//     A tela mostra só número, quarteirão, status e última leitura — nem o endereço curto que o api manda.
//   - "Índices e mapa": a semana (padrão: a anterior à de hoje) e o bairro; o relatório `ovitraps` (OvitrapIndex: IPO, IDO, IDV;
//     só contagens) e o mapa da camada `ovitraps` (a única que o laboratório lê, `vectorMapLayers`; grava a trilha territory_map).
// O bairro escolhido vale para as duas últimas abas e fica só em memória. Nada em URL ou storage; nenhum polling.
import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getVectorReport, listOvitrapReadings, listOvitraps, listPanelNeighborhoods, type Ovitrap, type OvitrapReading, type OvitrapStatus,
  type VectorReport
} from "../lib/api";
import { cityIsoDate, fmtDateTime, fmtNumber } from "../lib/format";
import { fmtDay } from "../lib/homeVisits";
import { PANEL_NEIGHBORHOODS_KEY } from "../lib/neighborhoodFilter";
import { isSuppressed, suppressedLabel } from "../lib/smallCount";
import { epiWeekOf, previousEpiWeek, shiftEpiWeek, weekLabel, weekProblem } from "../lib/surveillance";
import { sortByName } from "../lib/territory";
import {
  STATIC_QUERY, VC_OVITRAPS_KEY, VC_READINGS_KEY, VC_REPORT_KEY, conditionLabel, ovitrapStatusLabel, vectorError, vectorMapLayers,
  type VectorRoles
} from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
import { CountForm } from "./vectorControl/CountForm";
import { VectorMapPanel } from "./vectorControl/VectorMapPanel";
import { usePaged, type Paged } from "./homeVisits/usePaged";
import { SegmentedControl } from "../shell/SegmentedControl";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

export const PICK_OVITRAP_NEIGHBORHOOD = "Escolha um bairro para ver as ovitrampas e os índices";
export const TO_COUNT_EMPTY = "nenhuma palheta a contar";
export const COUNTED_EMPTY = "nenhuma palheta contada";
export const NEIGHBORHOOD_OVITRAPS_EMPTY = "nenhuma ovitrampa neste bairro com este status";

type Tab = "count" | "ovitraps" | "indexes";
type ReadingState = "to_count" | "counted";

export function VectorOvitraps({ today }: { today?: string } = {}) {
  return (
    <VectorGate title="Ovitrampas" sub="endemias · ovitrampas do bairro e contagem de ovos" allow={(r) => r.coordinator || r.lab}>
      {(roles) => <OvitrapsScreen roles={roles} today={today ?? cityIsoDate()} />}
    </VectorGate>
  );
}

function OvitrapsScreen({ roles, today }: { roles: VectorRoles; today: string }) {
  const [ tab, setTab ] = useState<Tab>("count");
  const [ neighborhoodId, setNeighborhoodId ] = useState("");
  const options: { key: Tab; label: string }[] = [
    { key: "count", label: "A contar" }, { key: "ovitraps", label: "Ovitrampas" }, { key: "indexes", label: "Índices e mapa" }
  ];
  return (
    <div style={stack}>
      <div><SegmentedControl options={options} value={tab} onChange={setTab} /></div>
      {tab === "count" && <ReadingsTab />}
      {tab !== "count" && (
        <>
          <NeighborhoodSelect value={neighborhoodId} onChange={setNeighborhoodId} />
          {!neighborhoodId ? <EmptyState title={PICK_OVITRAP_NEIGHBORHOOD} />
            : tab === "ovitraps" ? <NeighborhoodOvitraps key={neighborhoodId} neighborhoodId={neighborhoodId} />
            : <IndexesTab neighborhoodId={neighborhoodId} today={today} roles={roles} />}
        </>
      )}
    </div>
  );
}

function NeighborhoodSelect({ value, onChange }: { value: string; onChange(id: string): void }) {
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, ...STATIC_QUERY });
  return (
    <>
      <label style={{ ...fieldLabel, maxWidth: 320 }}>
        Bairro
        <select value={value} disabled={neighborhoods.isPending} style={inputStyle} onChange={(e) => onChange(e.target.value)}>
          <option value="">escolha o bairro</option>
          {sortByName(neighborhoods.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>)}
        </select>
      </label>
      {neighborhoods.isError && <p role="alert" style={alert}>não foi possível carregar os bairros</p>}
    </>
  );
}

// ─── A contar ───────────────────────────────────────────────────────────────
function ReadingsTab() {
  const [ state, setState ] = useState<ReadingState>("to_count");
  const [ done, setDone ] = useState<string | null>(null);
  const [ note, setNote ] = useState<string | null>(null);
  const change = (s: ReadingState) => { setState(s); setDone(null); setNote(null); };
  return (
    <div style={stack}>
      <div>
        <SegmentedControl options={[ { key: "to_count" as const, label: "Palhetas a contar" }, { key: "counted" as const, label: "Contadas" } ]}
          value={state} onChange={change} />
      </div>
      <ReadingsList key={state} state={state} done={done} note={note} setDone={setDone} setNote={setNote} />
    </div>
  );
}

function ReadingsList({ state, done, note, setDone, setNote }: {
  state: ReadingState; done: string | null; note: string | null; setDone(t: string | null): void; setNote(t: string | null): void;
}) {
  const queryClient = useQueryClient();
  const key = [ VC_READINGS_KEY, state ];
  const list = usePaged<OvitrapReading>(key, (before) => listOvitrapReadings({ state, ...(before ? { before } : {}) }), false, true, vectorError);
  const [ open, setOpen ] = useState<OvitrapReading | null>(null);
  const corrected = state === "counted";

  // Uma releitura por ação: refaz as páginas já mostradas desta lista (a outra lê ao abrir).
  const finish = (doneText: string | null, noteText: string | null, again: boolean) => {
    setOpen(null); setDone(doneText); setNote(noteText);
    if (again) void queryClient.invalidateQueries({ queryKey: key });
  };
  const start = (r: OvitrapReading) => { setDone(null); setNote(null); setOpen(r); };

  const cols: Column<OvitrapReading>[] = [
    { label: "Ovitrampa", w: "1fr", card: "title", render: (r) => <strong>{r.ovitrap.number}</strong> },
    { label: "Quarteirão", w: "0.8fr", render: (r) => r.city_block.number },
    { label: "Bairro", w: "1.2fr", render: (r) => r.neighborhood.name },
    { label: "Instalada", w: "0.9fr", render: (r) => fmtDay(r.installed_on) },
    { label: "Coletada", w: "0.9fr", render: (r) => (r.collected_on ? fmtDay(r.collected_on) : "—") },
    { label: "Semana", w: "1.4fr", render: (r) => weekLabel(r.epi_week) },
    ...(corrected ? [
      { label: "Ovos", w: "0.6fr", align: "right" as const, render: (r: OvitrapReading) => (r.egg_count === null ? "—" : fmtNumber(r.egg_count)) },
      {
        label: "Contada em", w: "1.2fr", render: (r: OvitrapReading) => (
          <span style={row}>{fmtDateTime(r.counted_at)}{r.corrected && <Tag tone="neutral">corrigida</Tag>}</span>
        )
      }
    ] : []),
    {
      label: "Ação", w: "170px", card: "actions", render: (r) => (
        <button type="button" style={secondaryButtonStyle} aria-label={`${corrected ? "Corrigir contagem" : "Contar"} — ovitrampa ${r.ovitrap.number}`}
          onClick={() => start(r)}>
          {corrected ? "Corrigir contagem" : "Contar"}
        </button>
      )
    }
  ];

  const label = corrected ? "Palhetas contadas" : "Palhetas a contar";
  return (
    <>
      {open && (
        <Panel title={corrected ? "Corrigir contagem" : "Contar ovos"}>
          <div style={{ padding: 16 }}>
            <CountForm reading={open} corrected={corrected}
              onDone={(r) => finish(`contagem da ovitrampa ${r.ovitrap.number} ${corrected ? "corrigida" : "registrada"}: ${r.egg_count ?? 0} ovos`, null, true)}
              onStale={(text) => finish(null, text, true)}
              onCancel={() => finish(null, null, false)} />
          </div>
        </Panel>
      )}
      {/* A lista fica montada enquanto o formulário está aberto: fechar não a lê de novo. */}
      <div style={{ ...stack, display: open ? "none" : "flex" }}>
        {done && <p role="status" style={okText}>{done}</p>}
        {note && <p role="alert" style={alert}>{note}</p>}
        <Panel title={label}>
          <div style={{ padding: 16 }}>
            <ListBody list={list}>
              {(items) => <DataTable<OvitrapReading> label={label} cols={cols} rows={items} rowKey={(r) => r.id} empty={corrected ? COUNTED_EMPTY : TO_COUNT_EMPTY} />}
            </ListBody>
          </div>
        </Panel>
      </div>
    </>
  );
}

// O corpo de uma lista paginada do 35a: a recusa pela tabela do 35a (nunca o código cru), carregando, itens e "Carregar mais".
function ListBody<T>({ list, children }: { list: Paged<T>; children(items: T[]): ReactNode }) {
  if (list.error) return <p role="alert" style={alert}>{vectorError(list.error)}</p>;
  if (!list.items) return <p role="status" style={muted}>Carregando…</p>;
  return (
    <div style={stack}>
      {list.note && <p role="status" style={muted}>{list.note}</p>}
      {children(list.items)}
      {list.hasMore && (
        <div>
          <button type="button" style={secondaryButtonStyle} disabled={list.loadingMore} onClick={() => void list.more()}>
            {list.loadingMore ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Ovitrampas do bairro ───────────────────────────────────────────────────
const STATUSES: OvitrapStatus[] = [ "active", "removed", "lost" ];
const STATUS_TONE: Record<string, "ok" | "neutral" | "warn"> = { active: "ok", removed: "neutral", lost: "warn" };

function lastReadingText(o: Ovitrap): string {
  const last = o.last_reading;
  if (!last) return "sem leitura";
  return [ fmtDay(last.collected_on), conditionLabel(last.condition), last.egg_count === null ? "ovos a contar" : `${last.egg_count} ovos` ].join(" · ");
}

function NeighborhoodOvitraps({ neighborhoodId }: { neighborhoodId: string }) {
  const [ status, setStatus ] = useState<OvitrapStatus | "">("");
  const list = usePaged<Ovitrap>([ VC_OVITRAPS_KEY, "neighborhood", neighborhoodId, status ],
    (before) => listOvitraps({ neighborhoodId, ...(status ? { status } : {}), ...(before ? { before } : {}) }), true, true, vectorError);
  const cols: Column<Ovitrap>[] = [
    { label: "Número", w: "1fr", card: "title", render: (o) => <strong>{o.number}</strong> },
    { label: "Quarteirão", w: "0.8fr", render: (o) => o.city_block.number },
    { label: "Status", w: "0.9fr", render: (o) => <Tag tone={STATUS_TONE[o.status] ?? "neutral"}>{ovitrapStatusLabel(o.status)}</Tag> },
    { label: "Última leitura", w: "2fr", render: (o) => lastReadingText(o) }
  ];
  return (
    <Panel title="Ovitrampas do bairro">
      <div style={{ ...stack, padding: 16 }}>
        <label style={{ ...fieldLabel, maxWidth: 240 }}>
          Status
          <select value={status} style={inputStyle} onChange={(e) => setStatus(e.target.value as OvitrapStatus | "")}>
            <option value="">todas</option>
            {STATUSES.map((s) => <option key={s} value={s}>{ovitrapStatusLabel(s)}</option>)}
          </select>
        </label>
        <ListBody list={list}>
          {(items) => <DataTable<Ovitrap> label="Ovitrampas do bairro" cols={cols} rows={items} rowKey={(o) => o.id} empty={NEIGHBORHOOD_OVITRAPS_EMPTY} />}
        </ListBody>
      </div>
    </Panel>
  );
}

// ─── Índices e mapa ─────────────────────────────────────────────────────────
type ReportRow = VectorReport["rows"][number];

// Contagem com o número da cidade; percentual e decimal chegam em texto ("37.5") e saem com vírgula; nulo vira "—".
function cellText(v: ReportRow[string], kind: VectorReport["columns"][number]["kind"]): string {
  if (v === null || v === undefined) return "—";
  if (isSuppressed(v)) return suppressedLabel(kind === "percent" ? "%" : undefined);
  if (typeof v === "number") return fmtNumber(v);
  return kind === "percent" || kind === "decimal" ? v.replace(".", ",") : v;
}

// A tabela simples desta tela (a Task 17 troca pelo ReportTable).
function ReportTableSimple({ report, label }: { report: VectorReport; label: string }) {
  const cols: Column<ReportRow>[] = report.columns.map((c, i) => ({
    label: c.label, w: c.kind === "text" ? "1.4fr" : "0.8fr", align: c.kind === "text" ? "left" : "right", ...(i === 0 ? { card: "title" as const } : {}),
    render: (r: ReportRow) => cellText(r[c.key], c.kind)
  }));
  return (
    <div style={stack}>
      <DataTable<ReportRow> label={label} cols={cols} rows={report.rows} rowKey={(_, i) => String(i)} empty="sem leituras nesta semana" />
      {(report.notes ?? []).map((n) => <p key={n} style={muted}>{n}</p>)}
    </div>
  );
}

function IndexesTab({ neighborhoodId, today, roles }: { neighborhoodId: string; today: string; roles: VectorRoles }) {
  const latest = epiWeekOf(today);
  const [ week, setWeek ] = useState(() => previousEpiWeek(today));
  const [ typed, setTyped ] = useState(week);
  const [ problem, setProblem ] = useState<string | null>(null);
  const report = useQuery({
    queryKey: [ VC_REPORT_KEY, "ovitraps", week, neighborhoodId ],
    queryFn: () => getVectorReport("ovitraps", { epi_weeks: [ week ], neighborhood_ids: [ neighborhoodId ] }), ...STATIC_QUERY
  });
  const go = (next: string) => { setWeek(next); setTyped(next); setProblem(null); };
  const view = () => {
    const p = weekProblem(typed.trim(), today);
    if (p) { setProblem(p); return; }
    go(typed.trim());
  };
  const next = shiftEpiWeek(week, 1);
  return (
    <div style={stack}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <button type="button" style={secondaryButtonStyle} onClick={() => go(shiftEpiWeek(week, -1))}>Semana anterior</button>
        <button type="button" style={next > latest ? disabledButtonStyle : secondaryButtonStyle} disabled={next > latest}
          onClick={() => go(next)}>Semana seguinte</button>
        <label style={fieldLabel}>
          Semana (AAAA-SS)
          <input value={typed} style={inputStyle} className="mono" placeholder="2026-45" onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") view(); }} />
        </label>
        <button type="button" style={secondaryButtonStyle} onClick={view}>Ver semana</button>
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <p className="mono" style={muted}>{weekLabel(week)}</p>
      <Panel title="Índices de ovitrampa">
        <div style={{ padding: 16 }}>
          {report.isError ? <p role="alert" style={alert}>{vectorError(report.error)}</p>
            : !report.data ? <p role="status" style={muted}>Carregando…</p>
            : <ReportTableSimple report={report.data} label="Índices de ovitrampa" />}
        </div>
      </Panel>
      {vectorMapLayers(roles).includes("ovitraps") && (
        <VectorMapPanel key={`${neighborhoodId}:${week}`} query={{ layer: "ovitraps", neighborhoodId, epiWeek: week }} title="Ovos por ovitrampa na semana" />
      )}
    </div>
  );
}
