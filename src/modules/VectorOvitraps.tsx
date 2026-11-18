// src/modules/VectorOvitraps.tsx
// "Ovitrampas" da coordenação de endemias e do laboratório de entomologia (módulo 35a, F-35.5; contrato §6, §10, §17; Q9, Q23,
// Q28). Papel: coordenação e laboratório (OvitrapReadingsController#reader!, OvitrapsController#neighborhood_scope; os dois
// contam, CountReading). Três abas: cada uma lê ao ser aberta pela primeira vez e depois fica montada e escondida (voltar a ela
// não relê a lista nominal nem o mapa, que gravariam a trilha de novo). A aba escondida nunca lê: o bairro dela só muda com ela
// aberta (`tabNb`), e trocar o bairro numa aba não mexe na outra até ela ser aberta.
//   - "A contar": as palhetas a contar e as contadas (GET /ovitrap_readings?state=, sem domicílio nem pessoa: STATIC_QUERY,
//     relidas depois de cada contagem), uma lista por vez; "Contar" e "Corrigir contagem" abrem o CountForm. Tela velha relê UMA vez.
//   - "Ovitrampas": as do bairro, por status (GET /ovitraps?neighborhood_id=). A rota grava a trilha territory_registry com os
//     imóveis da página (ovitraps_controller#shown), então a leitura é NOMINAL: lida ao escolher bairro e status, nunca sozinha.
//     A tela mostra só número, quarteirão, status e última leitura — nem o endereço curto que o api manda.
//   - "Índices e mapa": a semana (padrão: a anterior à de hoje) e o bairro; o relatório `ovitraps` (OvitrapIndex: IPO, IDO, IDV;
//     só contagens) e o mapa da camada `ovitraps` (a única que o laboratório lê, `vectorMapLayers`; grava a trilha territory_map).
// O bairro escolhido vale para as duas últimas abas e fica só em memória. Nada em URL ou storage; nenhum polling.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getVectorReport, listOvitrapReadings, listOvitraps, listPanelNeighborhoods, type Ovitrap, type OvitrapReading, type OvitrapStatus
} from "../lib/api";
import { cityIsoDate, fmtDateTime, fmtNumber } from "../lib/format";
import { fmtDay } from "../lib/homeVisits";
import { PANEL_NEIGHBORHOODS_KEY } from "../lib/neighborhoodFilter";
import { epiWeekOf, previousEpiWeek, shiftEpiWeek, weekLabel, weekProblem } from "../lib/surveillance";
import { sortByName } from "../lib/territory";
import {
  STATIC_QUERY, VC_OVITRAPS_KEY, VC_READINGS_KEY, VC_REPORT_KEY, conditionLabel, ovitrapStatusLabel, vectorError, vectorMapLayers,
  type VectorRoles
} from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
import { CountForm, eggsText } from "./vectorControl/CountForm";
import { VectorMapPanel } from "./vectorControl/VectorMapPanel";
import { ReportTable } from "./vectorControl/ReportTable";
import { usePaged } from "./homeVisits/usePaged";
import { VectorListBody } from "./vectorControl/VectorListBody";
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

type NbTab = Exclude<Tab, "count">;

function OvitrapsScreen({ roles, today }: { roles: VectorRoles; today: string }) {
  const [ tab, setTab ] = useState<Tab>("count");
  const [ visited, setVisited ] = useState<ReadonlySet<Tab>>(() => new Set<Tab>([ "count" ]));
  // O bairro do seletor (compartilhado) e o que cada aba mostra: este só muda com a aba aberta.
  const [ neighborhoodId, setNeighborhoodId ] = useState("");
  const [ tabNb, setTabNb ] = useState<Record<NbTab, string>>({ ovitraps: "", indexes: "" });
  const options: { key: Tab; label: string }[] = [
    { key: "count", label: "A contar" }, { key: "ovitraps", label: "Ovitrampas" }, { key: "indexes", label: "Índices e mapa" }
  ];
  const open = (t: Tab) => {
    setTab(t);
    setVisited((v) => (v.has(t) ? v : new Set([ ...v, t ])));
    if (t !== "count") setTabNb((m) => (m[t] === neighborhoodId ? m : { ...m, [t]: neighborhoodId }));
  };
  const pick = (id: string) => {
    setNeighborhoodId(id);
    if (tab !== "count") setTabNb((m) => ({ ...m, [tab]: id }));
  };
  const pane = (shown: boolean) => ({ ...stack, display: shown ? "flex" : "none" });
  const label = (t: Tab) => options.find((o) => o.key === t)!.label;
  const nbBody = (t: NbTab) => (!tabNb[t] ? <EmptyState title={PICK_OVITRAP_NEIGHBORHOOD} />
    : t === "ovitraps" ? <NeighborhoodOvitraps key={tabNb[t]} neighborhoodId={tabNb[t]} />
    : <IndexesTab neighborhoodId={tabNb[t]} today={today} roles={roles} />);
  return (
    <div style={stack}>
      <div><SegmentedControl options={options} value={tab} onChange={open} /></div>
      <div role="tabpanel" aria-label={label("count")} style={pane(tab === "count")}><ReadingsTab /></div>
      {(visited.has("ovitraps") || visited.has("indexes")) && (
        <div style={pane(tab !== "count")}><NeighborhoodSelect value={neighborhoodId} onChange={pick} /></div>
      )}
      {([ "ovitraps", "indexes" ] as const).map((t) => visited.has(t) && <div key={t} role="tabpanel" aria-label={label(t)} style={pane(tab === t)}>{nbBody(t)}</div>)}
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
  // Q36: depois do 409 reading_changed a lista é relida com o formulário aberto; ele recebe a leitura relida (version nova).
  const current = open ? list.items?.find((r) => r.id === open.id) : undefined;

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
            <CountForm reading={current ?? open} corrected={corrected}
              onDone={(r) => finish(`contagem da ovitrampa ${r.ovitrap.number} ${corrected ? "corrigida" : "registrada"}: ${eggsText(r.egg_count ?? 0)}`, null, true)}
              onStale={(text) => finish(null, text, true)}
              onReread={() => void queryClient.invalidateQueries({ queryKey: key })}
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
            <VectorListBody list={list}>
              {(items) => <DataTable<OvitrapReading> label={label} cols={cols} rows={items} rowKey={(r) => r.id} empty={corrected ? COUNTED_EMPTY : TO_COUNT_EMPTY} />}
            </VectorListBody>
          </div>
        </Panel>
      </div>
    </>
  );
}

// ─── Ovitrampas do bairro ───────────────────────────────────────────────────
const STATUSES: OvitrapStatus[] = [ "active", "removed", "lost" ];
const STATUS_TONE: Record<string, "ok" | "neutral" | "warn"> = { active: "ok", removed: "neutral", lost: "warn" };

function lastReadingText(o: Ovitrap): string {
  const last = o.last_reading;
  if (!last) return "sem leitura";
  return [ fmtDay(last.collected_on), conditionLabel(last.condition), last.egg_count === null ? "ovos a contar" : eggsText(last.egg_count) ].join(" · ");
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
        <VectorListBody list={list}>
          {(items) => <DataTable<Ovitrap> label="Ovitrampas do bairro" cols={cols} rows={items} rowKey={(o) => o.id} empty={NEIGHBORHOOD_OVITRAPS_EMPTY} />}
        </VectorListBody>
      </div>
    </Panel>
  );
}

// ─── Índices e mapa ─────────────────────────────────────────────────────────
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
            : <ReportTable report={report.data} label="Índices de ovitrampa" empty="sem leituras nesta semana" />}
        </div>
      </Panel>
      {vectorMapLayers(roles).includes("ovitraps") && (
        <VectorMapPanel key={`${neighborhoodId}:${week}`} query={{ layer: "ovitraps", neighborhoodId, epiWeek: week }} title="Ovos por ovitrampa na semana" />
      )}
    </div>
  );
}
