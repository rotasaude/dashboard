// A mesa da UPA dentro do Atendimento (módulo 32a; contrato §4–§7, §14 Q15): numa UPA com `urgency_care`, ela toma o lugar do
// check-in, da escuta, da fila, dos pedidos e da agenda do 13. Os painéis saem do papel de quem usa NESTA UPA (urgencyRoles):
// - recepção (`citizen_verifier`): a chegada (ArrivalForm) e, depois dela, a senha para entregar (TicketCard);
// - a fila da urgência (Task 6) e os painéis de classificação, chamada, desfecho e identificação (Tasks 7–10) entram aqui.
// Quem monta passa `key={unit.id}`: trocar de UPA remonta tudo e nada de uma unidade aparece na outra.
import { useState } from "react";
import type { HealthUnit, ProfessionalLink, SessionUser, UrgencyArrival } from "../../lib/api";
import { urgencyRoles } from "../../lib/urgency";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { ArrivalForm } from "./ArrivalForm";
import { TicketCard } from "./TicketCard";

export const NO_UPA_ROLE = "seu papel não atua nesta UPA";

export interface UrgencyDeskProps {
  unit: HealthUnit;
  user: SessionUser;
  links: ProfessionalLink[];
  // Relógio da fila e caminho para a verificação em duas etapas (Tasks 6–10).
  now?(): Date;
  onGoToSecurity?(): void;
}

export function UrgencyDesk({ unit, user, links }: UrgencyDeskProps) {
  const roles = urgencyRoles(user, links, unit.id);
  // A senha da última chegada; "Próxima chegada" volta ao formulário com o foco no documento.
  const [ arrival, setArrival ] = useState<UrgencyArrival | null>(null);
  const [ nextArrival, setNextArrival ] = useState(false);

  if (!roles.reception && !roles.nurse && !roles.doctor) {
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
    </div>
  );
}
