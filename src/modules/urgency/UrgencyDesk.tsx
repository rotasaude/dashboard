// A mesa da UPA dentro do Atendimento (módulo 32a; contrato §4–§7, §14 Q15): numa UPA com `urgency_care`, ela toma o lugar do
// check-in, da escuta, da fila, dos pedidos e da agenda do 13. Os painéis saem do papel de quem usa NESTA UPA (urgencyRoles):
// - recepção (`citizen_verifier`): a chegada (ArrivalForm) e, depois dela, a senha para entregar (TicketCard);
// - a fila da urgência (UrgencyQueue, para todos os papéis da UPA); as ações dela e os painéis de classificação, chamada, desfecho
//   e identificação (Tasks 7–10) entram aqui, e `queueRef.current.refresh()` relê a fila depois de cada ação.
// Enquanto os vínculos do profissional carregam, nada de "seu papel não atua nesta UPA" (piscaria antes dos vínculos).
// Quem monta passa `key={unit.id}`: trocar de UPA remonta tudo e nada de uma unidade aparece na outra.
import { useRef, useState } from "react";
import type { HealthUnit, ProfessionalLink, SessionUser, UrgencyArrival } from "../../lib/api";
import { urgencyRoles } from "../../lib/urgency";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { ArrivalForm } from "./ArrivalForm";
import { TicketCard } from "./TicketCard";
import { UrgencyQueue, type QueueActions, type UrgencyQueueHandle } from "./UrgencyQueue";

export const NO_UPA_ROLE = "seu papel não atua nesta UPA";
export const LINKS_LOADING = "carregando seus vínculos…";
// As ações da fila chegam com as Tasks 7–10.
const QUEUE_ACTIONS: QueueActions = {};

export interface UrgencyDeskProps {
  unit: HealthUnit;
  user: SessionUser;
  links: ProfessionalLink[];
  // Os vínculos do profissional ainda carregando (`getMyProfessional`).
  linksLoading?: boolean;
  // Relógio da fila e caminho para a verificação em duas etapas (Tasks 6–10).
  now?(): Date;
  onGoToSecurity?(): void;
}

export function UrgencyDesk({ unit, user, links, linksLoading = false, now }: UrgencyDeskProps) {
  const roles = urgencyRoles(user, links, unit.id);
  const queueRef = useRef<UrgencyQueueHandle>(null);
  // A senha da última chegada; "Próxima chegada" volta ao formulário com o foco no documento.
  const [ arrival, setArrival ] = useState<UrgencyArrival | null>(null);
  const [ nextArrival, setNextArrival ] = useState(false);

  if (!roles.reception && !roles.nurse && !roles.doctor) {
    if (linksLoading) return <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>{LINKS_LOADING}</p>;
    return <EmptyState title={NO_UPA_ROLE} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {roles.reception && (
        <Panel title="Recepção da UPA" sub="chegada · senha · classificação de risco a seguir">
          {arrival ? (
            <TicketCard ticket={arrival.ticket} unitName={unit.name} onDone={() => { setArrival(null); setNextArrival(true); }} />
          ) : (
            <ArrivalForm unit={unit} autoFocus={nextArrival} onArrived={setArrival} />
          )}
        </Panel>
      )}
      <UrgencyQueue ref={queueRef} unit={unit} roles={roles} now={now} actions={QUEUE_ACTIONS} />
    </div>
  );
}
