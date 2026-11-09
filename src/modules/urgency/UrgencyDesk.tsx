// A mesa da UPA dentro do Atendimento (módulo 32a; contrato §4–§7, §14 Q15): numa UPA com `urgency_care`, ela toma o lugar do
// check-in, da escuta, da fila, dos pedidos e da agenda do 13. Os painéis saem do papel de quem usa NESTA UPA (urgencyRoles):
// - recepção (`citizen_verifier`): a chegada (ArrivalForm) e, depois dela, a senha para entregar (TicketCard);
// - a fila da urgência (UrgencyQueue, para todos os papéis da UPA); as ações dela e os painéis de classificação, chamada, desfecho
//   e identificação (Tasks 7–10) entram aqui, e `queueRef.current.refresh()` relê a fila depois de cada ação;
// - enfermagem 2235: "Classificar"/"Reclassificar" abre a classificação de risco (ClassificationForm) num painel acima da fila.
// Enquanto os vínculos do profissional carregam, nada de "seu papel não atua nesta UPA" (piscaria antes dos vínculos).
// Quem monta passa `key={unit.id}`: trocar de UPA remonta tudo e nada de uma unidade aparece na outra.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { HealthUnit, ProfessionalLink, SessionUser, UrgencyArrival, UrgencyEncounter } from "../../lib/api";
import { URGENCY_DETAIL_KEY, colorLabel, urgencyRoles } from "../../lib/urgency";
import { useReveal } from "../../lib/useReveal";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { ArrivalForm } from "./ArrivalForm";
import { ClassificationForm } from "./ClassificationForm";
import { TicketCard } from "./TicketCard";
import { UrgencyQueue, type QueueActions, type UrgencyQueueHandle } from "./UrgencyQueue";

export const NO_UPA_ROLE = "seu papel não atua nesta UPA";
export const LINKS_LOADING = "carregando seus vínculos…";

// O painel aberto por uma linha da fila: só o id do encontro e a senha (o detalhe é lido pelo id, nunca vai na URL).
type Classifying = { encounterId: string; ticket: string | null };

// O painel de classificação: aparece à vista, com o foco no título (useReveal); Escape fecha.
function ClassificationPanel({ target, onDone, onClose }: { target: Classifying; onDone(e: UrgencyEncounter): void; onClose(): void }) {
  const ref = useReveal<HTMLDivElement>(true);
  return (
    <div ref={ref} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <Panel title={`Classificação de risco — ${target.ticket ?? "sem senha"}`} sub="sinais vitais · dor · cor sugerida pelo protocolo">
        <div style={{ padding: 16 }}>
          <ClassificationForm encounterId={target.encounterId} onDone={onDone} onCancel={onClose} />
        </div>
      </Panel>
    </div>
  );
}

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

export function UrgencyDesk({ unit, user, links, linksLoading = false }: UrgencyDeskProps) {
  const roles = urgencyRoles(user, links, unit.id);
  const queueRef = useRef<UrgencyQueueHandle>(null);
  const queryClient = useQueryClient();
  // A senha da última chegada; "Próxima chegada" volta ao formulário com o foco no documento.
  const [ arrival, setArrival ] = useState<UrgencyArrival | null>(null);
  const [ nextArrival, setNextArrival ] = useState(false);
  const [ classifying, setClassifying ] = useState<Classifying | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  // Fechar tira o detalhe (queixa, sinais) do cache.
  const closeClassification = () => { setClassifying(null); queryClient.removeQueries({ queryKey: [ URGENCY_DETAIL_KEY ] }); };
  const classified = (e: UrgencyEncounter) => {
    setNotice(`${e.ticket ?? "Paciente"} classificado: ${e.color ? colorLabel(e.color) : "—"}.`);
    closeClassification();
    queueRef.current?.refresh();
  };
  // Q2: só a enfermagem 2235 classifica (a fila também confere o papel).
  const actions: QueueActions = roles.nurse
    ? { onClassify: (row) => { setNotice(null); setClassifying({ encounterId: row.encounter_id, ticket: row.ticket }); } }
    : {};

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
      {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{notice}</p>}
      {classifying && (
        <ClassificationPanel key={classifying.encounterId} target={classifying} onDone={classified} onClose={closeClassification} />
      )}
      <UrgencyQueue ref={queueRef} unit={unit} roles={roles} actions={actions} />
    </div>
  );
}
