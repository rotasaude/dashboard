// src/modules/HomeVisitDay.tsx
// Tela "Folha do dia" (módulo 24b, F-24.10): as folhas de hoje da equipe do profissional. A lista de hoje não traz pessoa nem grava
// trilha; a folha ABERTA com visitas é lida por `getHomeVisitDay` (nominal: `NOMINAL_QUERY`, nunca relida sozinha). Folhas fechadas
// de hoje aparecem como cartão com a situação da ficha. Releitura só por ação (409, retirada, fechamento), uma vez por vez.
// A "Nova visita" (Task 7) entra aqui; `start` (atalho do "Quem visitar") é dela. Nada de dado pessoal em URL nem em storage.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getHomeVisitContext, getHomeVisitDay, listHomeVisitDays, type HomeVisitContext, type HomeVisitDay as ApiDay } from "../lib/api";
import {
  HV_CANNOT_REGISTER, HV_CONTEXT_KEY, HV_DAY_KEY, HV_TODAY_KEY, NOMINAL_QUERY, STATIC_QUERY, homeVisitError
} from "../lib/homeVisits";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { DaySheet } from "./homeVisits/DaySheet";
import type { VisitStart } from "./homeVisits/useVisitHandoff";
import { EmptyState } from "../components/EmptyState";
import { ActionButton } from "../components/ActionButton";
import { fieldLabel, stack, alert, muted } from "./exams/styles";
import { inputStyle } from "../components/formStyles";

export function HomeVisitDay({ onGoToTeam }: { now?: Date; start?: VisitStart | null; onGoToTeam?(): void }) {
  return (
    <HomeVisitGate title="Folha do dia" sub="visita domiciliar · visitas de hoje" feature="home_visits" allow={(r) => r.professional}>
      {() => <DayBody onGoToTeam={onGoToTeam} />}
    </HomeVisitGate>
  );
}

function DayBody({ onGoToTeam }: { onGoToTeam?(): void }) {
  const ctx = useQuery({ queryKey: [ HV_CONTEXT_KEY ], queryFn: getHomeVisitContext, ...STATIC_QUERY });
  const [ picked, setPicked ] = useState<string | null>(null);
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
          <select value={team.id} style={inputStyle} onChange={(e) => setPicked(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.ine}</option>)}
          </select>
        </label>
      )}
      <TodaySheets key={team.id} ctx={ctx.data} teamId={team.id} />
    </div>
  );
}

function TodaySheets({ ctx, teamId }: { ctx: HomeVisitContext; teamId: string }) {
  const queryClient = useQueryClient();
  const listKey = [ HV_TODAY_KEY, teamId, ctx.today ];
  const days = useQuery({
    queryKey: listKey,
    queryFn: () => listHomeVisitDays({ team_id: teamId, from: ctx.today, to: ctx.today }),
    ...STATIC_QUERY
  });
  if (days.isError) return <p role="alert" style={alert}>{homeVisitError(days.error)}</p>;
  if (!days.data) return <p role="status" style={muted}>Carregando…</p>;
  if (days.data.items.length === 0) return <EmptyState title="nenhuma folha hoje — a primeira visita abre a folha" />;

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
  return (
    <div style={stack}>
      {days.data.items.map((d) => <TodaySheet key={d.id} summary={d} ctx={ctx} onChanged={(u) => changed(d.id, u)} />)}
    </div>
  );
}

function TodaySheet({ summary, ctx, onChanged }: { summary: ApiDay; ctx: HomeVisitContext; onChanged(updated?: ApiDay): void }) {
  const withVisits = summary.state === "open" && summary.visits_count + summary.withdrawn_count > 0;
  const detail = useQuery({ queryKey: [ HV_DAY_KEY, summary.id ], queryFn: () => getHomeVisitDay(summary.id), enabled: withVisits, ...NOMINAL_QUERY });
  if (withVisits && detail.isError) return <p role="alert" style={alert}>{homeVisitError(detail.error)}</p>;
  if (withVisits && !detail.data) return <p role="status" style={muted}>Carregando a folha…</p>;
  const day = withVisits && detail.data ? detail.data : summary;
  return <DaySheet day={day} domains={ctx.domains} onChanged={onChanged} />;
}
