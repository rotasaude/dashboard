// Atendimento médico na UPA (módulo 32a, F-32.4; contrato §7, §14 Q10): o painel que o médico abre ao chamar ("Chamar",
// "Chamar próximo") ou com "Atender" em quem já está em atendimento. Em cima, o resumo do encontro (cor vigente e critério); no
// meio, a consulta do 19a com `kind: "urgency"` (documentos, exames, notificação, adendos e assinatura como no 19a); embaixo, o
// desfecho da urgência. Finalizar a consulta não encerra o atendimento: o desfecho encerra, e então o painel fecha, a mesa relê a
// fila e mostra o aviso (sem texto clínico). O detalhe é lido pelo id do encontro (nunca vai na URL) e sai do cache ao fechar.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUrgencyEncounter, type HealthUnit, type UrgencyInCareRow } from "../../lib/api";
import { URGENCY_DETAIL_KEY, urgencyError } from "../../lib/urgency";
import { useReveal } from "../../lib/useReveal";
import { Panel } from "../../components/Panel";
import { ConsultationWorkspace } from "../consultation/ConsultationWorkspace";
import { EncounterSummary } from "./EncounterSummary";
import { OutcomeForm } from "./OutcomeForm";

export const FINALIZED_NOTICE = "Consulta finalizada. Registre o desfecho da urgência.";

export interface UrgencyCareProps {
  row: UrgencyInCareRow;
  unit: HealthUnit;
  units: HealthUnit[];
  // Fecha o painel; com o desfecho registrado, `notice` é o aviso para a mesa.
  onClosed(notice?: string): void;
  onGoToSecurity?(): void;
}

export function UrgencyCare({ row, unit, units, onClosed, onGoToSecurity }: UrgencyCareProps) {
  const ref = useReveal<HTMLDivElement>(true);
  const detail = useQuery({
    queryKey: [ URGENCY_DETAIL_KEY, row.encounter_id ], queryFn: () => getUrgencyEncounter(row.encounter_id), gcTime: 0, staleTime: 0
  });
  // Finalizada nesta tela: o desfecho já libera os tipos que esperam a consulta, mesmo antes de o detalhe relido chegar.
  const [ finalizedHere, setFinalizedHere ] = useState(false);
  const encounter = detail.data;
  const target = encounter && (finalizedHere ? { ...encounter, consultation_status: "finalized" as const } : encounter);

  return (
    <div ref={ref}>
      <Panel title={`Atendimento — ${row.ticket ?? "sem senha"}`} sub="consulta de urgência · desfecho">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {detail.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>}
          {detail.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{urgencyError(detail.error)}</p>}
          {encounter && <EncounterSummary encounter={encounter} />}
          <ConsultationWorkspace attendanceId={row.attendance_id} unit={unit} units={units} urgency onGoToSecurity={onGoToSecurity}
            onClose={() => onClosed()}
            onFinalized={() => { setFinalizedHere(true); void detail.refetch(); }} />
          {finalizedHere && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{FINALIZED_NOTICE}</p>}
          {target && <OutcomeForm encounter={target} doctor onRecorded={(_e, notice) => onClosed(notice)} />}
        </div>
      </Panel>
    </div>
  );
}
