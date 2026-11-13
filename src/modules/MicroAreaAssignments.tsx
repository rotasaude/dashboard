// src/modules/MicroAreaAssignments.tsx
// Tela "Atribuição de microáreas" (módulo 24b, F-24.17, decisão 6A): só o enfermeiro da equipe (`can_assign`) vê a lista ativa e
// atribui ou encerra. As duas ações pedem step-up (`SensitiveAction`) e uma por vez (`writeLock`). A lista é sem pessoa do cidadão
// (`STATIC_QUERY`) e relida depois de cada ação; `already_assigned` e `assignment_already_ended` releem uma vez e nunca reenviam.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createFieldAssignment, endFieldAssignment, errorCode, getHomeVisitContext, listFieldAssignments, ApiError,
  type FieldAssignment, type HomeVisitTeam
} from "../lib/api";
import { ASSIGNEE_CBO_NOT_ALLOWED, HV_ASSIGNMENTS_KEY, HV_CONTEXT_KEY, STATIC_QUERY, fmtDay, homeVisitError } from "../lib/homeVisits";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { WriteLockProvider, useWriteLock } from "./homeVisits/writeLock";
import { SensitiveAction } from "../components/SensitiveAction";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, stack } from "./exams/styles";

export const ONLY_NURSE = "só o enfermeiro da equipe atribui microáreas";
const NO_TEAM = "nenhuma equipe encontrada para você";
const PICK_BOTH = "escolha a microárea e o profissional";
const END_EFFECT = "O aparelho dessa pessoa deixa de baixar esta microárea na próxima sincronização.";
const ASSIGN_EFFECT = "A pessoa passa a ver e baixar esta microárea no aparelho de campo na próxima sincronização.";

class PickBoth extends Error {}

export function MicroAreaAssignments({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <HomeVisitGate title="Atribuição de microáreas" sub="visita domiciliar · microáreas dos agentes de campo" feature={"home_visits"} allow={(r) => r.professional}>
      {() => <AssignmentsBody onGoToSecurity={onGoToSecurity} />}
    </HomeVisitGate>
  );
}

function AssignmentsBody({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const ctx = useQuery({ queryKey: [ HV_CONTEXT_KEY ], queryFn: getHomeVisitContext, ...STATIC_QUERY });
  const [ picked, setPicked ] = useState<string | null>(null);
  if (ctx.isError) return <p role="alert" style={alert}>{homeVisitError(ctx.error)}</p>;
  if (!ctx.data) return <p role="status" style={muted}>Carregando…</p>;
  const teams = ctx.data.teams.filter((t) => t.can_assign);
  if (teams.length === 0) return <EmptyState title={ctx.data.teams.length === 0 ? NO_TEAM : ONLY_NURSE} />;
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
      <WriteLockProvider>
        <TeamAssignments key={team.id} team={team} onGoToSecurity={onGoToSecurity} />
      </WriteLockProvider>
    </div>
  );
}

type Action = { kind: "assign" } | { kind: "end"; assignment: FieldAssignment };

function TeamAssignments({ team, onGoToSecurity }: { team: HomeVisitTeam; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const lock = useWriteLock();
  const key = [ HV_ASSIGNMENTS_KEY, team.id ];
  const list = useQuery({ queryKey: key, queryFn: () => listFieldAssignments(team.id), ...STATIC_QUERY });
  const [ action, setAction ] = useState<Action | null>(null);
  const [ microArea, setMicroArea ] = useState("");
  const [ professional, setProfessional ] = useState("");

  const reread = () => queryClient.refetchQueries({ queryKey: key });
  // Uma releitura só, sem reenviar a gravação, quando o api diz que a lista que a tela tinha estava velha.
  const rereadIfStale = async (err: unknown) => {
    if ([ "already_assigned", "assignment_already_ended" ].includes(errorCode(err) ?? "")) await reread();
  };
  const translate = (err: unknown): string | null => {
    if (err instanceof PickBoth) return PICK_BOTH;
    if (err instanceof ApiError && err.status === 422 && errorCode(err) === "cbo_not_allowed") return ASSIGNEE_CBO_NOT_ALLOWED;
    return err instanceof ApiError ? homeVisitError(err) : null;
  };
  const close = () => { setAction(null); setMicroArea(""); setProfessional(""); };
  const done = () => { close(); void reread(); };

  const assign = () => lock.run(async () => {
    if (!microArea || !professional) throw new PickBoth();
    try { await createFieldAssignment({ micro_area_id: microArea, professional_id: professional }); } catch (err) { await rereadIfStale(err); throw err; }
  });
  const end = (a: FieldAssignment) => lock.run(async () => {
    try { await endFieldAssignment(a.id); } catch (err) { await rereadIfStale(err); throw err; }
  });

  const cols: Column<FieldAssignment>[] = [
    { label: "Microárea", w: "1.2fr", card: "title", render: (a) => <strong>{`${a.micro_area.code} · ${a.micro_area.name}`}</strong> },
    { label: "Profissional", w: "1.4fr", render: (a) => a.professional.name },
    { label: "CBO", w: "0.8fr", card: "pair", render: (a) => a.professional.cbo ?? "—" },
    { label: "Desde", w: "0.8fr", card: "pair", render: (a) => fmtDay(a.assigned_at) },
    { label: "Atribuída por", w: "1.2fr", card: "pair", render: (a) => a.assigned_by.name ?? "—" },
    { label: "", w: "auto", card: "actions", render: (a) => (
      <button type="button" disabled={lock.busy || action !== null} style={lock.busy || action ? disabledButtonStyle : secondaryButtonStyle}
        aria-label={`Encerrar atribuição de ${a.professional.name} na microárea ${a.micro_area.code}`}
        onClick={() => setAction({ kind: "end", assignment: a })}>Encerrar</button>
    ) }
  ];

  return (
    <div style={stack}>
      {!action && (
        <div>
          <button type="button" disabled={lock.busy} style={lock.busy ? disabledButtonStyle : buttonStyle} onClick={() => setAction({ kind: "assign" })}>Atribuir microárea</button>
        </div>
      )}
      {action?.kind === "assign" && (
        <SensitiveAction
          title="Atribuir microárea" requiresStepUp onGoToSecurity={onGoToSecurity} run={assign} onDone={done} onCancel={close} translateError={translate}
          description={
            <div style={stack}>
              <span>{ASSIGN_EFFECT}</span>
              <label style={fieldLabel}>
                Microárea
                <select value={microArea} style={inputStyle} onChange={(e) => setMicroArea(e.target.value)}>
                  <option value="">Escolha…</option>
                  {team.micro_areas.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Profissional
                <select value={professional} style={inputStyle} onChange={(e) => setProfessional(e.target.value)}>
                  <option value="">Escolha…</option>
                  {(list.data?.candidates ?? []).map((c) => <option key={c.professional_id} value={c.professional_id}>{c.name} · {c.cbo}</option>)}
                </select>
              </label>
            </div>
          } />
      )}
      {action?.kind === "end" && (
        <SensitiveAction
          title={`Encerrar atribuição de ${action.assignment.professional.name} na microárea ${action.assignment.micro_area.code}`}
          description={END_EFFECT} requiresStepUp onGoToSecurity={onGoToSecurity} run={() => end(action.assignment)} onDone={done} onCancel={close}
          translateError={translate} />
      )}
      {list.isError && <p role="alert" style={alert}>{homeVisitError(list.error)}</p>}
      {!list.data && !list.isError && <p role="status" style={muted}>Carregando…</p>}
      {list.data && <DataTable cols={cols} rows={list.data.items} rowKey={(a) => a.id} label="Atribuições ativas" empty="nenhuma microárea atribuída nesta equipe" />}
    </div>
  );
}
