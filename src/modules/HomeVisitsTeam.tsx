// src/modules/HomeVisitsTeam.tsx
// Tela "Visitas da equipe" (módulo 24b, F-24.10): folhas e visitas da equipe. Filtros (microárea, profissional, período, desfecho)
// só valem no "Atualizar". "Folhas" lê a lista sem pessoa; "Visitas" só lê ao abrir a aba (nominal, com trilha, nunca relida sozinha)
// e fica montada depois, para voltar a ela não ler de novo. As contagens (sem trilha) só aceitam equipe, microárea e período: o
// profissional e o desfecho nunca vão a elas, e o texto diz que são da equipe. Nada em storage; só ids, datas e filtros codificados.
import { useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  countHomeVisits, errorCode, getHomeVisitContext, listHomeVisitDays, listHomeVisits,
  type HomeVisit, type HomeVisitContext, type HomeVisitDay, type HomeVisitTeam
} from "../lib/api";
import {
  COUNT_QUERY, HOME_VISIT_ERRORS, HV_CONTEXT_KEY, HV_COUNT_KEY, HV_DAYS_KEY, HV_VISITS_KEY, NOMINAL_QUERY, STATIC_QUERY, homeVisitError
} from "../lib/homeVisits";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { DayDetail, DayList } from "./homeVisits/DayList";
import { VisitList } from "./homeVisits/VisitList";
import { VisitDetail } from "./homeVisits/VisitDetail";
import { EmptyState } from "../components/EmptyState";
import { StatTile } from "../components/StatTile";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

const NO_TEAM = "nenhuma equipe encontrada para você";
const PERIOD_INVERTED = "o fim do período não pode ser antes do início";
const COUNTS_NOTE = "Contagens da equipe no período — não seguem o filtro de profissional nem o de desfecho.";

export function HomeVisitsTeam(_props: { now?: Date }) {
  return (
    <HomeVisitGate title="Visitas da equipe" sub="visita domiciliar · folhas e visitas da equipe" feature={"home_visits"} allow={(r) => r.professional}>
      {() => <TeamBody />}
    </HomeVisitGate>
  );
}

function TeamBody() {
  const ctx = useQuery({ queryKey: [ HV_CONTEXT_KEY ], queryFn: getHomeVisitContext, ...STATIC_QUERY });
  const [ picked, setPicked ] = useState<string | null>(null);
  if (ctx.isError) return <p role="alert" style={alert}>{homeVisitError(ctx.error)}</p>;
  if (!ctx.data) return <p role="status" style={muted}>Carregando…</p>;
  const teams = ctx.data.teams;
  if (teams.length === 0) return <EmptyState title={NO_TEAM} />;
  const team = teams.find((t) => t.id === picked) ?? teams[0];
  return (
    <div style={stack}>
      {teams.length > 1 && (
        <label style={fieldLabel}>
          Equipe
          <select value={team.id} style={inputStyle} onChange={(e) => setPicked(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.ine}</option>)}
          </select>
        </label>
      )}
      <TeamPanel key={team.id} ctx={ctx.data} team={team} />
    </div>
  );
}

interface Filters { micro: string; professional: string; outcome: string; from: string; to: string }
type Page<T> = { items: T[]; next_before: string | null };

// Lista paginada por cursor. A ordem é a do api. Cursor antigo (`invalid_cursor`) recomeça da primeira página, com a frase.
function usePaged<T>(key: unknown[], fetchPage: (before: string | null) => Promise<Page<T>>, nominal: boolean, enabled: boolean) {
  const queryClient = useQueryClient();
  const [ note, setNote ] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: key, queryFn: ({ pageParam }) => fetchPage(pageParam), initialPageParam: null as string | null,
    getNextPageParam: (last: Page<T>) => last.next_before ?? undefined, enabled, ...(nominal ? NOMINAL_QUERY : STATIC_QUERY)
  });
  async function more() {
    setNote(null);
    const r = await q.fetchNextPage();
    if (!r.isError) return;
    if (errorCode(r.error) === "invalid_cursor") { setNote(HOME_VISIT_ERRORS.invalid_cursor); await queryClient.resetQueries({ queryKey: key }); }
    else setNote(homeVisitError(r.error));
  }
  const items = q.data ? q.data.pages.flatMap((p) => p.items) : null;
  return { items, error: q.isError && !q.data ? q.error : null, note, hasMore: !!q.hasNextPage, loadingMore: q.isFetchingNextPage, more };
}

const tabBase: CSSProperties = { padding: "4px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, letterSpacing: 0.3 };
const tabIdle: CSSProperties = { ...tabBase, border: "1px solid var(--rule2)", background: "transparent", color: "var(--ink2)" };
const tabActive: CSSProperties = { ...tabBase, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)" };
const tiles: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 };

function TeamPanel({ ctx, team }: { ctx: HomeVisitContext; team: HomeVisitTeam }) {
  const initial: Filters = { micro: "", professional: "", outcome: "", from: `${ctx.today.slice(0, 7)}-01`, to: ctx.today };
  const [ draft, setDraft ] = useState<Filters>(initial);
  const [ applied, setApplied ] = useState<Filters>(initial);
  const [ tab, setTab ] = useState<"days" | "visits">("days");
  const [ visitsOpened, setVisitsOpened ] = useState(false);
  const [ openDay, setOpenDay ] = useState<HomeVisitDay | null>(null);
  const [ openVisit, setOpenVisit ] = useState<HomeVisit | null>(null);
  const wholeTeam = team.reads_whole_team && team.professionals.length > 0;
  const inverted = draft.to < draft.from;
  const detailOpen = !!(openDay || openVisit);
  const set = (k: keyof Filters) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));

  const days = usePaged<HomeVisitDay>(
    [ HV_DAYS_KEY, team.id, applied.professional, applied.from, applied.to ],
    (before) => listHomeVisitDays({ team_id: team.id, ...(applied.professional && { professional_id: applied.professional }), from: applied.from, to: applied.to, ...(before && { before }) }),
    false, true);
  const visits = usePaged<HomeVisit>(
    [ HV_VISITS_KEY, team.id, applied.micro, applied.professional, applied.outcome, applied.from, applied.to ],
    (before) => listHomeVisits({
      team_id: team.id, ...(applied.micro && { micro_area_id: applied.micro }), ...(applied.professional && { professional_id: applied.professional }),
      from: applied.from, to: applied.to, ...(applied.outcome && { outcome: [ Number(applied.outcome) ] }), ...(before && { before }) }),
    true, visitsOpened);
  const counts = useQuery({
    queryKey: [ HV_COUNT_KEY, team.id, applied.micro, applied.from, applied.to ],
    queryFn: () => countHomeVisits({ team_id: team.id, ...(applied.micro && { micro_area_id: applied.micro }), from: applied.from, to: applied.to }),
    enabled: visitsOpened && tab === "visits", ...COUNT_QUERY
  });

  const show = (t: "days" | "visits") => { setTab(t); if (t === "visits") setVisitsOpened(true); setOpenDay(null); setOpenVisit(null); };
  const back = () => { setOpenDay(null); setOpenVisit(null); };

  return (
    <div style={stack}>
      <form style={{ ...row, alignItems: "flex-end" }} onSubmit={(e) => { e.preventDefault(); if (!inverted) setApplied(draft); }}>
        {tab === "visits" && team.micro_areas.length > 0 && (
          <label style={fieldLabel}>Microárea
            <select value={draft.micro} style={inputStyle} onChange={(e) => set("micro")(e.target.value)}>
              <option value="">Todas</option>
              {team.micro_areas.map((m) => <option key={m.id} value={m.id}>{m.name ? `${m.code} · ${m.name}` : m.code}</option>)}
            </select>
          </label>
        )}
        {wholeTeam && (
          <label style={fieldLabel}>Profissional
            <select value={draft.professional} style={inputStyle} onChange={(e) => set("professional")(e.target.value)}>
              <option value="">Todos</option>
              {team.professionals.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <label style={fieldLabel}>De<input type="date" value={draft.from} style={inputStyle} onChange={(e) => set("from")(e.target.value)} /></label>
        <label style={fieldLabel}>Até<input type="date" value={draft.to} style={inputStyle} onChange={(e) => set("to")(e.target.value)} /></label>
        {tab === "visits" && (
          <label style={fieldLabel}>Desfecho
            <select value={draft.outcome} style={inputStyle} onChange={(e) => set("outcome")(e.target.value)}>
              <option value="">Todos</option>
              {ctx.domains.desfecho.map((o) => <option key={o.code} value={String(o.code)}>{o.label}</option>)}
            </select>
          </label>
        )}
        <button type="submit" disabled={inverted} style={inverted ? disabledButtonStyle : buttonStyle}>Atualizar</button>
      </form>
      {inverted && <p role="alert" style={alert}>{PERIOD_INVERTED}</p>}

      {detailOpen ? (
        <div style={stack}>
          <div><button type="button" style={secondaryButtonStyle} onClick={back}>Voltar à lista</button></div>
          {openDay && <DayDetail key={openDay.id} summary={openDay} domains={ctx.domains} />}
          {openVisit && <VisitDetail key={openVisit.id} id={openVisit.id} domains={ctx.domains} />}
        </div>
      ) : (
        <div role="tablist" aria-label="Visitas da equipe" style={row}>
          <button type="button" role="tab" aria-selected={tab === "days"} className="mono" style={tab === "days" ? tabActive : tabIdle} onClick={() => show("days")}>Folhas</button>
          <button type="button" role="tab" aria-selected={tab === "visits"} className="mono" style={tab === "visits" ? tabActive : tabIdle} onClick={() => show("visits")}>Visitas</button>
        </div>
      )}

      <div hidden={detailOpen || tab !== "days"} style={stack}>
        <PagedBody list={days}>{(items) => <DayList days={items} onOpen={setOpenDay} />}</PagedBody>
      </div>
      {visitsOpened && (
        <div hidden={detailOpen || tab !== "visits"} style={stack}>
          <p style={muted}>{COUNTS_NOTE}</p>
          {counts.isError
            ? <p role="alert" style={alert}>{homeVisitError(counts.error)}</p>
            : (
              <div style={tiles}>
                <StatTile label="Realizadas" value={counts.data?.done} />
                <StatTile label="Recusadas" value={counts.data?.refused} />
                <StatTile label="Ausentes" value={counts.data?.absent} />
                <StatTile label="Retiradas" value={counts.data?.withdrawn} />
              </div>
            )}
          <PagedBody list={visits}>{(items) => <VisitList visits={items} onOpen={setOpenVisit} />}</PagedBody>
        </div>
      )}
    </div>
  );
}

function PagedBody<T>({ list, children }: { list: ReturnType<typeof usePaged<T>>; children(items: T[]): React.ReactNode }) {
  if (list.error) return <p role="alert" style={alert}>{homeVisitError(list.error)}</p>;
  if (!list.items) return <p role="status" style={muted}>Carregando…</p>;
  return (
    <div style={stack}>
      {list.note && <p role="status" style={muted}>{list.note}</p>}
      {children(list.items)}
      {list.hasMore && (
        <div><button type="button" style={secondaryButtonStyle} disabled={list.loadingMore} onClick={() => void list.more()}>{list.loadingMore ? "Carregando…" : "Carregar mais"}</button></div>
      )}
    </div>
  );
}
