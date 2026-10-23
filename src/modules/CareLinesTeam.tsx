// src/modules/CareLinesTeam.tsx
// Acompanhamento da equipe (contrato §4–§5; spec §6 "Equipe"): o profissional
// com vínculo ativo na unidade da equipe vê, pessoa a pessoa, a situação de
// cada boa prática, filtra a busca ativa (alguma vencida), registra contato,
// agenda, inscreve e encerra; as sugestões ficam na aba própria (Task 9).
// A lista é NOMINAL e GRAVA trilha (clinical_record.viewed, access: care_line):
// lida só ao abrir, ao filtrar, ao trocar de aba ou depois de uma ação —
// nunca sozinha. Só os contadores (/count, sem trilha) releem por minuto.
import { useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { countOverdueEnrollments, getCareContext, listCareEnrollments } from "../lib/api";
import {
  CONTEXT_KEY, COUNT_QUERY, ENROLLMENTS_KEY, ENROLLMENT_FILTERS, NOMINAL_QUERY, OVERDUE_COUNT_KEY, STATIC_QUERY, careLineError, isStaleCare
} from "../lib/careLines";
import { todayInCity } from "../lib/campaigns";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { CareLinesGate } from "./careLines/CareLinesGate";
import { EnrollmentList } from "./careLines/EnrollmentList";
import { EnrollmentDetail } from "./careLines/EnrollmentDetail";

export function CareLinesTeam({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <CareLinesGate title="Acompanhamento da equipe" sub="linhas de cuidado · busca ativa, sugestões e inscrições" allow={(r) => r.professional}>
      {() => <TeamBody today={today} />}
    </CareLinesGate>
  );
}

export type TeamTab = "overdue" | "due_soon" | "all";

function TeamBody({ today }: { today: string }) {
  const queryClient = useQueryClient();
  const context = useQuery({ queryKey: [ CONTEXT_KEY ], queryFn: getCareContext, ...STATIC_QUERY });
  const [ teamChoice, setTeamChoice ] = useState("");
  const [ lineId, setLineId ] = useState("");
  const [ tab, setTab ] = useState<TeamTab>("overdue");
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ openId, setOpenId ] = useState<string | null>(null);
  const teams = context.data?.teams ?? [];
  const teamId = teamChoice || teams[0]?.id || "";
  const overdueCount = useQuery({
    queryKey: [ OVERDUE_COUNT_KEY, teamId ], queryFn: () => countOverdueEnrollments(teamId), enabled: !!teamId, ...COUNT_QUERY
  });
  const query = useInfiniteQuery({
    queryKey: [ ENROLLMENTS_KEY, teamId, lineId, tab ],
    queryFn: ({ pageParam }) => listCareEnrollments({ teamId, careLineId: lineId || undefined, status: tab, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: !!teamId,
    ...NOMINAL_QUERY
  });
  const rows = (query.data?.pages ?? []).flatMap((p) => p.enrollments);
  // Depois de uma ação: volta à 1ª página (reset) e relê os contadores.
  const reload = () => {
    void queryClient.resetQueries({ queryKey: [ ENROLLMENTS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ OVERDUE_COUNT_KEY ] });
  };
  const changed = (message: string) => { setNotice(message); reload(); };

  async function loadMore() {
    const result = await query.fetchNextPage();
    if (result.isError && isStaleCare(result.error)) { setNotice(careLineError(result.error)); reload(); }
  }
  void today; // usado nas Tasks 9 e 10

  const tabLabel = (key: TeamTab, label: string) =>
    key === "overdue" && typeof overdueCount.data === "number" ? `${label} (${overdueCount.data})` : label;

  if (context.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (context.isError) return <p role="alert" style={alert}>{careLineError(context.error)}</p>;
  if (teams.length === 0) return <EmptyState title="você não está em nenhuma equipe com vínculo ativo na unidade" />;

  return (
    <div style={stack}>
      <Panel title="Equipe e linha">
        <div style={{ ...row, alignItems: "flex-end", padding: 16 }}>
          <label style={fieldLabel}>
            Equipe
            <select value={teamId} style={inputStyle} onChange={(e) => { setNotice(null); setTeamChoice(e.target.value); }}>
              {teams.map((t) => <option key={t.id} value={t.id}>{`${t.name} · INE ${t.ine} · ${t.unit.name}`}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Linha
            <select value={lineId} style={inputStyle} onChange={(e) => { setNotice(null); setLineId(e.target.value); }}>
              <option value="">todas as linhas</option>
              {(context.data?.lines ?? []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
        </div>
      </Panel>
      <div role="group" aria-label="Lista" style={row}>
        {ENROLLMENT_FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={tab === f.key} style={tab === f.key ? buttonStyle : secondaryButtonStyle}
            onClick={() => { setNotice(null); setTab(f.key); }}>
            {tabLabel(f.key, f.label)}
          </button>
        ))}
      </div>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      {openId && (
        <EnrollmentDetail key={openId} enrollmentId={openId} onClose={() => setOpenId(null)}
          onChanged={(message, close) => { if (close) setOpenId(null); changed(message); }} />
      )}
      <Panel title="Pessoas da equipe" sub={tab === "overdue" ? "busca ativa: alguma boa prática vencida" : tab === "due_soon" ? "alguma boa prática vence em até 30 dias" : "todas as inscrições ativas"}>
        <div style={{ ...stack, padding: 16 }}>
          {query.isPending && <p className="mono" style={muted}>carregando…</p>}
          {query.isError && <p role="alert" style={alert}>{careLineError(query.error)}</p>}
          {/* L6: a busca ativa pode devolver página curta (ou vazia) com next_before — carrega sob demanda, sem laço. */}
          {query.data && (rows.length === 0 && query.hasNextPage
            ? <p style={muted}>Nada nesta parte da lista; carregue mais para continuar a busca.</p>
            : <EnrollmentList rows={rows} onOpen={(e) => { setNotice(null); setOpenId(e.id); }} />)}
          {query.hasNextPage && (
            <div>
              <button type="button" style={secondaryButtonStyle} disabled={query.isFetchingNextPage} onClick={() => void loadMore()}>
                Carregar mais
              </button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
