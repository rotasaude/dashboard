// src/modules/HomeVisitDay.tsx
// Tela "Folha do dia" (módulo 24b, F-24.10): as folhas de hoje da equipe do profissional e a "Nova visita". A lista de hoje não traz
// pessoa nem grava trilha; a folha ABERTA com visitas é lida por `getHomeVisitDay` (nominal: `NOMINAL_QUERY`, nunca relida sozinha).
// Folhas fechadas de hoje aparecem como cartão com a situação da ficha. Releitura só por ação (409, retirada, fechamento), uma vez.
// "Nova visita" fica acima das folhas (também com "nenhuma folha hoje"); o atalho do "Quem visitar" (`start`, só em memória) abre o
// formulário já com domicílio e pessoa. Uma gravação por vez na tela (`WriteLockProvider`). Nada de dado pessoal em URL nem em storage.
// Módulo 35a: para a equipe do agente de endemias com o gate utilizável, os domínios do boletim (`getVectorDomains`, uma leitura)
// vão ao formulário; depois de gravar, as etiquetas definitivas das amostras. `onGoToTerritory`: cadastrar o imóvel (Q13(1)).
// "Imóveis a visitar" (F-35.4) abaixo da "Nova visita": o atalho abre o formulário com o vínculo do boletim; a lista (nominal) fica
// montada, escondida enquanto o formulário está aberto, e é relida uma vez depois de gravar um boletim.
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getHomeVisitContext, getHomeVisitDay, getVectorDomains, listHomeVisitDays, type HomeVisit, type HomeVisitContext, type HomeVisitDay as ApiDay,
  type HomeVisitTeam
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { VC_DOMAINS_KEY, VC_DUE_KEY, VC_PROFILE_KEY, canUseVectorControl, isEndemicAgentTeam, vectorError } from "../lib/vectorControl";
import {
  HV_CANNOT_REGISTER, HV_CONTEXT_KEY, HV_DAY_KEY, HV_TODAY_KEY, NOMINAL_QUERY, OTHER_DAY_TEXT, REPLAYED_VISIT, STATIC_QUERY, UNCERTAIN_VISIT_REREAD, VISIT_SAVED,
  homeVisitError
} from "../lib/homeVisits";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { DaySheet } from "./homeVisits/DaySheet";
import { VisitForm, type VisitSaved } from "./homeVisits/VisitForm";
import { tubeLabelsText } from "./homeVisits/InspectionSection";
import { WriteLockProvider, useWriteLock } from "./homeVisits/writeLock";
import { DueList } from "./vectorControl/DueList";
import type { VisitStart } from "./homeVisits/useVisitHandoff";
import { EmptyState } from "../components/EmptyState";
import { ActionButton } from "../components/ActionButton";
import { fieldLabel, stack, alert, muted, okText } from "./exams/styles";
import { inputStyle } from "../components/formStyles";

export function HomeVisitDay({ now, start, onGoToTeam, onGoToTerritory }: {
  now?: Date; start?: VisitStart | null; onGoToTeam?(): void; onGoToTerritory?(): void;
}) {
  return (
    <HomeVisitGate title="Folha do dia" sub="visita domiciliar · visitas de hoje" feature="home_visits" allow={(r) => r.professional}>
      {() => <WriteLockProvider><DayBody now={now} start={start ?? null} onGoToTeam={onGoToTeam} onGoToTerritory={onGoToTerritory} /></WriteLockProvider>}
    </HomeVisitGate>
  );
}

function DayBody({ now, start, onGoToTeam, onGoToTerritory }: { now?: Date; start: VisitStart | null; onGoToTeam?(): void; onGoToTerritory?(): void }) {
  const ctx = useQuery({ queryKey: [ HV_CONTEXT_KEY ], queryFn: getHomeVisitContext, ...STATIC_QUERY });
  const [ picked, setPicked ] = useState<string | null>(start?.teamId ?? null);
  // Trocar a equipe desmonta o formulário: travado enquanto uma gravação corre ou um envio está pendurado (rede/5xx).
  const lock = useWriteLock();
  const [ held, setHeld ] = useState(false);
  const onHeld = useCallback((h: boolean) => setHeld(h), []);
  useEffect(() => { if (start) setPicked(start.teamId); }, [ start ]);
  if (ctx.isError) return <p role="alert" style={alert}>{homeVisitError(ctx.error)}</p>;
  if (!ctx.data) return <p role="status" style={muted}>Carregando…</p>;
  const teams = ctx.data.teams.filter((t) => t.can_register);
  if (teams.length === 0) {
    return (
      <div style={stack}>
        <EmptyState title={HV_CANNOT_REGISTER} />
        {onGoToTeam && <div style={{ textAlign: "center" }}><ActionButton variant="secondary" onClick={onGoToTeam}>Visitas da equipe</ActionButton></div>}
      </div>
    );
  }
  const team = teams.find((t) => t.id === picked) ?? teams[0];
  return (
    <div style={stack}>
      {teams.length > 1 && (
        <label style={fieldLabel}>
          Equipe
          <select value={team.id} disabled={lock.busy || held} style={inputStyle} onChange={(e) => setPicked(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.ine}</option>)}
          </select>
        </label>
      )}
      <TodaySheets key={team.id} ctx={ctx.data} team={team} now={now} start={start?.teamId === team.id ? start : null} onHeld={onHeld}
        onGoToTerritory={onGoToTerritory} />
    </div>
  );
}

// A ordem do api numa folha: `occurred_at`, depois `id` (uuid em minúsculas: a ordem do texto é a do banco).
const byApiOrder = (a: HomeVisit, b: HomeVisit): number =>
  Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const upsert = (list: HomeVisit[], v: HomeVisit): HomeVisit[] =>
  (list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [ ...list, v ]).sort(byApiOrder);

function TodaySheets({ ctx, team, now, start, onHeld, onGoToTerritory }: {
  ctx: HomeVisitContext; team: HomeVisitTeam; now?: Date; start: VisitStart | null; onHeld(held: boolean): void; onGoToTerritory?(): void;
}) {
  const queryClient = useQueryClient();
  const lock = useWriteLock();
  const { user } = useAuth();
  // Boletim (35a): só para a equipe do agente com o gate; sem os domínios (erro), a visita segue sem boletim e a frase diz por quê.
  const vcOn = canUseVectorControl(user) && isEndemicAgentTeam(team);
  const vc = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, enabled: vcOn, ...STATIC_QUERY });
  const listKey = [ HV_TODAY_KEY, team.id, ctx.today ];
  const days = useQuery({
    queryKey: listKey,
    queryFn: () => listHomeVisitDays({ team_id: team.id, from: ctx.today, to: ctx.today }),
    ...STATIC_QUERY
  });
  // O formulário aberto (com o atalho que o abriu) e a frase do último registro.
  const [ form, setForm ] = useState<{ start: VisitStart | null; n: number } | null>(start ? { start, n: 1 } : null);
  const [ saved, setSaved ] = useState<string | null>(null);
  // As etiquetas definitivas das amostras da visita gravada (D-12).
  const [ tubes, setTubes ] = useState<string | null>(null);
  // Descartou-se um envio pendurado: a visita pode ter entrado; a frase pede para conferir a folha relida.
  const [ uncertain, setUncertain ] = useState(false);
  // "Imóveis a visitar" só é lida depois de aparecer uma vez (o atalho abre o formulário antes): a leitura grava trilha.
  const [ dueSeen, setDueSeen ] = useState(!start);
  useEffect(() => { if (!form) setDueSeen(true); }, [ form ]);
  // Cada atalho abre o formulário uma vez; voltar à tela sem atalho novo não reabre.
  const consumed = useRef<VisitStart | null>(start);
  useEffect(() => {
    if (start && start !== consumed.current) {
      consumed.current = start; setSaved(null); setTubes(null); setUncertain(false); setForm((f) => ({ start, n: (f?.n ?? 0) + 1 }));
    }
  }, [ start ]);

  if (days.isError) return <p role="alert" style={alert}>{homeVisitError(days.error)}</p>;
  if (!days.data || (vcOn && vc.isPending)) return <p role="status" style={muted}>Carregando…</p>;
  const items = days.data.items;

  // Releitura única, por ação: a folha e a lista de hoje. Com a folha devolvida pelo api (fechamento) ela é gravada no lugar.
  const changed = (id: string, updated?: ApiDay) => {
    if (updated) {
      const { visits: _v, ...summary } = updated;
      queryClient.setQueryData(listKey, (old: typeof days.data | undefined) => old && ({ ...old, items: old.items.map((d) => (d.id === id ? summary : d)) }));
      queryClient.removeQueries({ queryKey: [ HV_DAY_KEY, id ] });
    } else {
      void queryClient.invalidateQueries({ queryKey: [ HV_DAY_KEY, id ] });
      void queryClient.invalidateQueries({ queryKey: listKey });
    }
  };

  // Depois de gravar (pré-voo 4.7.4): o `day` do POST não traz `visits` e pode ser outra folha. Folha na tela com as visitas no cache →
  // o cartão entra no cache e os contadores e pendências vêm do `day`, sem reler. Senão → a lista de hoje é relida (sem trilha) e a
  // frase diz em que folha a visita entrou.
  function onSaved({ visit, day, replayed }: VisitSaved) {
    setForm(null); setUncertain(false); setTubes(tubeLabelsText(visit));
    // O boletim grava no perfil (quarteirão, risco, última situação): a próxima visita ao imóvel o relê.
    if (visit.vector_inspection && visit.household) void queryClient.invalidateQueries({ queryKey: [ VC_PROFILE_KEY, visit.household.id ] });
    // …e muda a lista de "Imóveis a visitar" (só o boletim mexe no perfil): uma releitura.
    if (vcOn && visit.vector_inspection) void queryClient.invalidateQueries({ queryKey: [ VC_DUE_KEY ] });
    const { visits: _v, ...summary } = day;
    const cached = queryClient.getQueryData<ApiDay>([ HV_DAY_KEY, day.id ]);
    if (items.some((d) => d.id === day.id) && cached?.visits) {
      queryClient.setQueryData<ApiDay>([ HV_DAY_KEY, day.id ], { ...cached, ...summary, visits: upsert(cached.visits, visit) });
      queryClient.setQueryData(listKey, (old: typeof days.data | undefined) => old && ({ ...old, items: old.items.map((d) => (d.id === day.id ? summary : d)) }));
      setSaved(replayed ? REPLAYED_VISIT : VISIT_SAVED);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: listKey });
    setSaved([ replayed ? REPLAYED_VISIT : null, OTHER_DAY_TEXT(day) ].filter(Boolean).join(" "));
  }

  function openForm(s: VisitStart | null) {
    setSaved(null); setTubes(null); setUncertain(false); setForm({ start: s, n: Date.now() });
  }

  // A retirada de uma visita com boletim reescreve o perfil e devolve o item do LIRAa a pendente (WithdrawInspection): uma releitura.
  function onWithdrawn(v: HomeVisit) {
    if (!vcOn || !v.vector_inspection) return;
    if (v.household) void queryClient.invalidateQueries({ queryKey: [ VC_PROFILE_KEY, v.household.id ] });
    void queryClient.invalidateQueries({ queryKey: [ VC_DUE_KEY ] });
  }

  // Fechar o formulário. Depois de descartar um envio pendurado, UMA releitura do que mostraria a visita: a lista de hoje e as
  // folhas dela na tela (nunca relidas sozinhas).
  function onClose(discardedUncertain?: boolean) {
    setForm(null);
    if (!discardedUncertain) return;
    setUncertain(true);
    void queryClient.invalidateQueries({ queryKey: listKey });
    for (const d of items) void queryClient.invalidateQueries({ queryKey: [ HV_DAY_KEY, d.id ] });
  }

  return (
    <div style={stack}>
      {saved && <p role="status" style={okText}>{saved}</p>}
      {tubes && <p role="status" style={okText}>{tubes}</p>}
      {uncertain && <p role="status" style={alert}>{UNCERTAIN_VISIT_REREAD}</p>}
      {vcOn && vc.isError && <p role="alert" style={alert}>{vectorError(vc.error)}</p>}
      {form ? (
        <VisitForm key={form.n} team={team} context={ctx} start={form.start} now={now} onSaved={onSaved} onClose={onClose} onHeld={onHeld}
          vectorDomains={vcOn ? vc.data ?? null : null} onGoToTerritory={onGoToTerritory} />
      ) : (
        <div><ActionButton busy={lock.busy} onClick={() => openForm(null)}>Nova visita</ActionButton></div>
      )}
      {vcOn && (
        <div hidden={!!form}>
          <DueList team={team} domains={vc.data ?? null} visitDomains={ctx.domains} today={ctx.today} busy={lock.busy || !!form}
            enabled={dueSeen} onStart={openForm} />
        </div>
      )}
      {items.length === 0
        ? <EmptyState title="nenhuma folha hoje — a primeira visita abre a folha" />
        : items.map((d) => <TodaySheet key={d.id} summary={d} ctx={ctx} onChanged={(u) => changed(d.id, u)} onWithdrawn={onWithdrawn} />)}
    </div>
  );
}

function TodaySheet({ summary, ctx, onChanged, onWithdrawn }: {
  summary: ApiDay; ctx: HomeVisitContext; onChanged(updated?: ApiDay): void; onWithdrawn(v: HomeVisit): void;
}) {
  const open = summary.state === "open";
  const withVisits = open && summary.visits_count + summary.withdrawn_count > 0;
  const detail = useQuery({ queryKey: [ HV_DAY_KEY, summary.id ], queryFn: () => getHomeVisitDay(summary.id), enabled: withVisits, ...NOMINAL_QUERY });
  if (withVisits && detail.isError) return <p role="alert" style={alert}>{homeVisitError(detail.error)}</p>;
  if (withVisits && !detail.data) return <p role="status" style={muted}>Carregando a folha…</p>;
  // Folha aberta sem nenhuma visita: lista vazia (o texto de vazia), sem ler o detalhe.
  const day = withVisits && detail.data ? detail.data : open ? { ...summary, visits: [] } : summary;
  return <DaySheet day={day} domains={ctx.domains} onChanged={onChanged} onWithdrawn={onWithdrawn} />;
}
