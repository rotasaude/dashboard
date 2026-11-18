// src/modules/FieldOvitraps.tsx
// "Ovitrampas de campo" do agente de endemias (módulo 35a, F-35.5; contrato §6, §17; Q7, Q23). O menu oferece a tela a todo
// health_professional (a sessão não traz o CBO); quem é agente diz o contexto do 24b: só a equipe 515140 com papel de campo
// (`isEndemicAgentTeam`), senão VC_NOT_AGENT sem ler nada do 35a. O api confere de novo (Access.agent_refusal): 403
// cbo_not_allowed ou missing_role depois da leitura dão a mesma frase; out_of_scope e o desligado, as deles (nunca o código cru).
// Cartões das ativas da microárea (GET /vector_control/ovitraps?micro_area_id=&status=active, paginado): a rota grava a trilha
// territory_registry com os imóveis mostrados, então a leitura é nominal (NOMINAL_QUERY), relida só UMA vez depois de cada
// instalação, coleta ou tela velha. Sem pessoa: o imóvel só com o endereço curto. A janela da palheta vem dos parâmetros de
// GET /vector_control/domains (min e max) e do alvo de 5 dias do contrato §6. Nenhuma <table>, nenhum polling, nada em URL ou
// storage. Uma gravação por vez (`WriteLockProvider`).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getHomeVisitContext, getVectorDomains, listOvitraps, type Ovitrap } from "../lib/api";
import { HV_CONTEXT_KEY, STATIC_QUERY, fmtDay, homeVisitError } from "../lib/homeVisits";
import { VC_DOMAINS_KEY, VC_NOT_AGENT, VC_OVITRAPS_KEY, conditionLabel, isEndemicAgentTeam, vectorError } from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
import { CollectForm, type CollectParams } from "./vectorControl/CollectForm";
import { InstallForm } from "./vectorControl/InstallForm";
import { PagedBody, usePaged } from "./homeVisits/usePaged";
import { WriteLockProvider, useWriteLock } from "./homeVisits/writeLock";
import { DUE_NO_MICRO_AREA } from "./vectorControl/DueList";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { ActionButton } from "../components/ActionButton";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

export const OVITRAPS_EMPTY = "nenhuma ovitrampa ativa nesta microárea";
// Contrato §6: o alvo de 5 dias é orientação na tela (o api só confere min e max).
export const OVITRAP_TARGET_DAYS = 5;
// Recusas do api que dizem "você não é o agente desta tela": a frase da tela, não a da ação.
const NOT_AGENT = [ "cbo_not_allowed", "missing_role" ];

const DAY = 86_400_000;
const addDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const dayMonth = (iso: string): string => fmtDay(iso).slice(0, 5);

// "palheta desde 10/11/2026 — colete entre 13/11 e 20/11 (ideal 15/11)"; sem os parâmetros, só a instalação.
export function paddleWindowText(installedOn: string, p: CollectParams | null): string {
  const since = `palheta desde ${fmtDay(installedOn)}`;
  if (!p) return since;
  const min = p.ovitrap_collection_days_min;
  const max = p.ovitrap_collection_days_max;
  const ideal = Math.min(Math.max(OVITRAP_TARGET_DAYS, min), max);
  return `${since} — colete entre ${dayMonth(addDays(installedOn, min))} e ${dayMonth(addDays(installedOn, max))} (ideal ${dayMonth(addDays(installedOn, ideal))})`;
}

export function FieldOvitraps({ today }: { today?: string }) {
  return (
    <VectorGate title="Ovitrampas de campo" sub="endemias · ovitrampas da sua microárea" allow={(r) => r.professional}>
      {() => <WriteLockProvider><Body today={today} /></WriteLockProvider>}
    </VectorGate>
  );
}

function Body({ today }: { today?: string }) {
  const ctx = useQuery({ queryKey: [ HV_CONTEXT_KEY ], queryFn: getHomeVisitContext, ...STATIC_QUERY });
  const lock = useWriteLock();
  const [ teamId, setTeamId ] = useState<string | null>(null);
  const [ areaId, setAreaId ] = useState<string | null>(null);
  if (ctx.isError) return <p role="alert" style={alert}>{homeVisitError(ctx.error)}</p>;
  if (!ctx.data) return <p role="status" style={muted}>Carregando…</p>;
  const teams = ctx.data.teams.filter(isEndemicAgentTeam);
  if (teams.length === 0) return <EmptyState title={VC_NOT_AGENT} />;
  const team = teams.find((t) => t.id === teamId) ?? teams[0];
  const area = team.micro_areas.find((a) => a.id === areaId) ?? team.micro_areas[0] ?? null;
  return (
    <div style={stack}>
      {teams.length > 1 && (
        <label style={fieldLabel}>
          Equipe
          <select value={team.id} disabled={lock.busy} style={inputStyle} onChange={(e) => { setTeamId(e.target.value); setAreaId(null); }}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.ine}</option>)}
          </select>
        </label>
      )}
      {team.micro_areas.length > 1 && area && (
        <label style={fieldLabel}>
          Microárea
          <select value={area.id} disabled={lock.busy} style={inputStyle} onChange={(e) => setAreaId(e.target.value)}>
            {team.micro_areas.map((a) => <option key={a.id} value={a.id}>{`${a.code} — ${a.name}`}</option>)}
          </select>
        </label>
      )}
      {area
        ? <AreaOvitraps key={`${team.id}:${area.id}`} microAreaId={area.id} today={today ?? ctx.data.today} />
        : <EmptyState title={DUE_NO_MICRO_AREA} />}
    </div>
  );
}

type OpenForm = { kind: "install" } | { kind: "collect"; ovitrap: Ovitrap } | null;

function AreaOvitraps({ microAreaId, today }: { microAreaId: string; today: string }) {
  const queryClient = useQueryClient();
  const key = [ VC_OVITRAPS_KEY, microAreaId, "active" ];
  const list = usePaged<Ovitrap>(key, (before) => listOvitraps({ microAreaId, status: "active", ...(before ? { before } : {}) }), true, true, vectorError);
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, ...STATIC_QUERY });
  const params: CollectParams | null = domains.data?.parameters ?? null;
  const [ form, setForm ] = useState<OpenForm>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ note, setNote ] = useState<string | null>(null);

  // Uma releitura por ação, nunca sozinha.
  const reread = () => void queryClient.invalidateQueries({ queryKey: key });
  const finish = (doneText: string | null, noteText: string | null, again: boolean) => {
    setForm(null); setDone(doneText); setNote(noteText);
    if (again) reread();
  };

  if (list.error) {
    const code = errorCode(list.error);
    if (code && NOT_AGENT.includes(code)) return <EmptyState title={VC_NOT_AGENT} />;
    return <EmptyState title={vectorError(list.error)} />;
  }
  return (
    <>
      {form?.kind === "install" && (
        <Panel title="Instalar ovitrampa">
          <InstallForm microAreaId={microAreaId} today={today}
            onDone={(o) => finish(`ovitrampa ${o.number} instalada`, null, true)}
            onCancel={(uncertain) => finish(null, null, uncertain)} />
        </Panel>
      )}
      {form?.kind === "collect" && (
        <Panel title="Coletar palheta">
          <CollectForm ovitrap={form.ovitrap} params={params} today={today}
            onDone={(o) => finish(collectedText(o), null, true)}
            onStale={(text) => finish(null, text, true)}
            onCancel={() => finish(null, null, false)} />
        </Panel>
      )}
      {/* A lista fica montada (a leitura é nominal, gcTime 0): escondida enquanto um formulário está aberto. */}
      <div style={{ ...stack, display: form ? "none" : "flex" }}>
        {done && <p role="status" style={okText}>{done}</p>}
        {note && <p role="alert" style={alert}>{note}</p>}
        {domains.isError && <p role="alert" style={alert}>{vectorError(domains.error)}</p>}
        <div><ActionButton onClick={() => { setDone(null); setNote(null); setForm({ kind: "install" }); }}>Instalar ovitrampa</ActionButton></div>
        <Panel title="Ovitrampas ativas">
          <PagedBody list={list}>
            {(items) => items.length === 0 ? <EmptyState title={OVITRAPS_EMPTY} /> : (
              <div style={stack}>
                {items.map((o) => (
                  <OvitrapCard key={o.id} ovitrap={o} params={params}
                    onCollect={() => { setDone(null); setNote(null); setForm({ kind: "collect", ovitrap: o }); }} />
                ))}
              </div>
            )}
          </PagedBody>
        </Panel>
      </div>
    </>
  );
}

function collectedText(o: Ovitrap): string {
  if (o.status === "lost") return `ovitrampa ${o.number} registrada como perdida`;
  if (o.status === "removed") return `ovitrampa ${o.number} retirada`;
  return `palheta da ovitrampa ${o.number} coletada`;
}

function OvitrapCard({ ovitrap: o, params, onCollect }: { ovitrap: Ovitrap; params: CollectParams | null; onCollect(): void }) {
  const last = o.last_reading;
  const lastText = last && [
    `última leitura em ${fmtDay(last.collected_on)}`, conditionLabel(last.condition), last.egg_count === null ? "ovos a contar" : `${last.egg_count} ovos`
  ].join(" · ");
  return (
    <article aria-label={`Ovitrampa ${o.number}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <strong style={{ fontSize: 13 }}>{`Ovitrampa ${o.number}`}</strong>
      <span style={{ fontSize: 13, overflowWrap: "anywhere" }}>{o.household.address_short}</span>
      <span style={muted}>{`Quarteirão ${o.city_block.number}`}</span>
      <span style={muted}>{o.open_reading ? paddleWindowText(o.open_reading.installed_on, params) : "sem palheta instalada"}</span>
      {lastText && <span style={muted}>{lastText}</span>}
      {o.open_reading && <div style={row}><ActionButton variant="secondary" onClick={onCollect}>Coletar palheta</ActionButton></div>}
    </article>
  );
}
