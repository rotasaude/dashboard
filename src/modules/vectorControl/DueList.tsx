// src/modules/vectorControl/DueList.tsx
// "Imóveis a visitar" do agente de endemias na Folha do dia (módulo 35a, F-35.4; contrato §5; Q8, Q11). GET /vector_control/due
// por microárea, paginado, na ordem do api (motivo; dentro dele, nunca trabalhado primeiro, depois o vencimento). Sem pessoa: o
// imóvel aparece só com o endereço curto e o tipo que o api devolve. A rota grava a trilha `territory_registry` com os imóveis
// mostrados, então a leitura é nominal (`NOMINAL_QUERY`, nunca relida sozinha); quem relê é a Folha do dia, uma vez, depois de
// gravar um boletim. "Registrar visita" abre o formulário com o vínculo do item (`VisitStart.vector`, só em memória).
import { useState } from "react";
import { errorCode, listDue, type DueItem, type HomeVisitDomains, type HomeVisitTeam, type VectorControlDomains } from "../../lib/api";
import { fmtDay, propertyLabel } from "../../lib/homeVisits";
import { VC_DUE_KEY, VECTOR_LABELS, domainLabel, dueReasonLabel, riskTone, vectorError } from "../../lib/vectorControl";
import type { VectorStart } from "../../lib/vectorInspection";
import { PagedBody, usePaged } from "../homeVisits/usePaged";
import type { VisitStart } from "../homeVisits/useVisitHandoff";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { EmptyState } from "../../components/EmptyState";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "../exams/styles";

export const DUE_EMPTY = "nenhum imóvel vencido nesta microárea";
export const DUE_NO_MICRO_AREA = "nenhuma microárea atribuída nesta equipe";
// 403 cbo_not_allowed no GET /due: a frase geral do 35a fala do boletim e da ovitrampa; aqui é a lista.
export const DUE_CBO_NOT_ALLOWED = "só o agente de combate às endemias vê os imóveis a visitar";

const dueError = (err: unknown): string => (errorCode(err) === "cbo_not_allowed" ? DUE_CBO_NOT_ALLOWED : vectorError(err));

// O vínculo do boletim vem do motivo do item (a tela não adivinha o item); PE pelo tipo do imóvel.
export function startFor(item: DueItem): VectorStart {
  if (item.reason === "transmission_block") return { activity: "transmission_block", transmissionBlockId: item.transmission_block_id };
  if (item.reason === "liraa") return { activity: "liraa", liraaDrawItemId: item.liraa_draw_item_id };
  if (item.reason === "pending") return { workType: "pending" };
  if (item.property_type === "4") return { activity: "pe" };
  return {};
}

export function DueList({ team, domains, visitDomains, today, busy, onStart }: {
  team: HomeVisitTeam; domains: VectorControlDomains | null; visitDomains: HomeVisitDomains; today: string; busy?: boolean;
  onStart(s: VisitStart): void;
}) {
  const areas = team.micro_areas;
  const [ picked, setPicked ] = useState<string | null>(null);
  const microAreaId = (areas.find((a) => a.id === picked) ?? areas[0])?.id ?? null;
  return (
    <Panel title="Imóveis a visitar">
      <div style={stack}>
        {areas.length > 1 && microAreaId && (
          <label style={fieldLabel}>
            Microárea
            <select value={microAreaId} disabled={busy} style={inputStyle} onChange={(e) => setPicked(e.target.value)}>
              {areas.map((a) => <option key={a.id} value={a.id}>{`${a.code} — ${a.name}`}</option>)}
            </select>
          </label>
        )}
        {microAreaId
          ? <DuePage key={microAreaId} team={team} microAreaId={microAreaId} domains={domains} visitDomains={visitDomains} today={today}
              busy={busy} onStart={onStart} />
          : <EmptyState title={DUE_NO_MICRO_AREA} />}
      </div>
    </Panel>
  );
}

function DuePage({ team, microAreaId, domains, visitDomains, today, busy, onStart }: {
  team: HomeVisitTeam; microAreaId: string; domains: VectorControlDomains | null; visitDomains: HomeVisitDomains; today: string; busy?: boolean;
  onStart(s: VisitStart): void;
}) {
  const list = usePaged<DueItem>([ VC_DUE_KEY, microAreaId ], (b) => listDue(microAreaId, b), true, true);
  if (list.error) return <p role="alert" style={alert}>{dueError(list.error)}</p>;
  const risks = domains?.risk_classes ?? VECTOR_LABELS.risk_classes;
  return (
    <PagedBody list={list}>
      {(items) => items.length === 0 ? <EmptyState title={DUE_EMPTY} /> : items.map((item) => (
        <DueCard key={item.household_id} item={item} riskText={item.risk_class ? domainLabel(risks, item.risk_class) : null}
          propertyText={propertyLabel(visitDomains, item.property_type)} today={today} busy={busy}
          onStart={() => onStart({
            teamId: team.id, microAreaId, householdId: item.household_id, familyId: null, patientId: null, displayName: null, vector: startFor(item)
          })} />
      ))}
    </PagedBody>
  );
}

function DueCard({ item, riskText, propertyText, today, busy, onStart }: {
  item: DueItem; riskText: string | null; propertyText: string; today: string; busy?: boolean; onStart(): void;
}) {
  // `due_since` nulo = nunca trabalhado; nos motivos que não são "vencido", o prazo pode ainda não ter chegado.
  const due = item.due_since === null ? null : item.due_since <= today ? `vencido desde ${fmtDay(item.due_since)}` : `vence em ${fmtDay(item.due_since)}`;
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={row}>
        <Tag tone="info" mono={false}>{dueReasonLabel(item.reason)}</Tag>
        {riskText && <Tag tone={riskTone(item.risk_class)} mono={false}>{riskText}</Tag>}
      </div>
      <strong style={{ fontSize: 13, overflowWrap: "anywhere" }}>{item.address_short}</strong>
      <span style={muted}>{[ propertyText, item.block ? `Quarteirão ${item.block.number}` : "sem quarteirão" ].join(" · ")}</span>
      <span style={muted}>
        {[ item.last_worked_on ? `trabalhado em ${fmtDay(item.last_worked_on)}` : "nunca trabalhado", due ].filter(Boolean).join(" · ")}
      </span>
      <div><ActionButton variant="secondary" busy={busy} onClick={onStart}>Registrar visita</ActionButton></div>
    </article>
  );
}
