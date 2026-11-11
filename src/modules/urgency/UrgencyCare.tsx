// Atendimento médico na UPA (módulo 32a, F-32.4; contrato §7, §14 Q10): o painel que o médico abre ao chamar ("Chamar",
// "Chamar próximo") ou com "Atender" em quem já está em atendimento. Em cima, o resumo do encontro (cor vigente e critério); no
// meio, a consulta do 19a com `kind: "urgency"` (documentos, exames, notificação, adendos e assinatura como no 19a); embaixo, o
// desfecho da urgência. Finalizar a consulta não encerra o atendimento: o desfecho encerra, e então o painel fecha, a mesa relê a
// fila e mostra o aviso (sem texto clínico). O detalhe é lido pelo id do encontro (nunca vai na URL) e sai do cache ao fechar.
// Cada leitura do detalhe grava trilha: lido ao abrir, ao finalizar e quando o api recusa o desfecho por estado desatualizado.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAttendanceRecord, getConsultationOptions, getUrgencyEncounter, type HealthUnit, type UrgencyEncounter, type UrgencyInCareRow
} from "../../lib/api";
import { OPTIONS_KEY, RECORD_KEY, consultationError } from "../../lib/consultation";
import { useAuth } from "../../lib/auth";
import { NOMINAL_QUERY, URGENCY_DETAIL_KEY, URGENCY_ERRORS, urgencyError } from "../../lib/urgency";
import { useReveal } from "../../lib/useReveal";
import { ActionButton } from "../../components/ActionButton";
import { Panel } from "../../components/Panel";
import { ConsultationWorkspace } from "../consultation/ConsultationWorkspace";
import { ConsultationLoader } from "../consultation/ConsultationView";
import { ObservationSummary } from "./ObservationSummary";
import { EncounterSummary } from "./EncounterSummary";
import { OutcomeForm } from "./OutcomeForm";
import { MedicationPanel } from "./MedicationPanel";
import { PrescriptionPanel } from "./PrescriptionPanel";

export const FINALIZED_NOTICE = "Consulta finalizada. Registre o desfecho da urgência.";
export const EVOLUTION_NEEDS_FINALIZED = "A evolução é um adendo da consulta: finalize a consulta antes.";

// Evolução (Q8/Q13): o adendo da consulta de urgência finalizada, por qualquer médico (225*) com vínculo ativo nesta UPA enquanto o
// atendimento está aberto. O api não manda "pode evoluir": a tela deriva (médico, encontro não fechado, consulta finalizada) e abre
// a consulta pelo id (nunca por "iniciar consulta", que dá 409 not_caller a quem não chamou). Os rascunhos de regulação ficam com a
// autora (o adendo de outro médico não os promove): a tela não promete outra coisa.
function Evolution({ encounter, onClosedByApi }: { encounter: UrgencyEncounter; onClosedByApi(): void }) {
  const { user } = useAuth();
  const [ open, setOpen ] = useState(false);
  // O prontuário é o mesmo do painel da consulta (mesma chave): sem nova leitura, que gravaria trilha.
  const record = useQuery({
    queryKey: [ RECORD_KEY, encounter.attendance_id ], queryFn: () => getAttendanceRecord(encounter.attendance_id),
    gcTime: 0, staleTime: 60_000, enabled: open
  });
  const options = useQuery({ queryKey: [ OPTIONS_KEY, user?.id ?? null ], queryFn: getConsultationOptions, staleTime: 5 * 60_000, enabled: open });
  if (encounter.state === "closed" || !encounter.consultation_id) return null;
  if (encounter.consultation_status !== "finalized") return <p style={{ margin: 0, fontSize: 12, color: "var(--ink3)" }}>{EVOLUTION_NEEDS_FINALIZED}</p>;
  if (!open) return <div><ActionButton variant="secondary" onClick={() => setOpen(true)}>Registrar evolução (adendo)</ActionButton></div>;
  if (record.isError) return <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{consultationError(record.error)}</p>;
  if (!record.data) return <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>;
  return (
    <ConsultationLoader id={encounter.consultation_id} options={options.data ?? null} patientProblems={record.data.problems}
      unitId={encounter.health_unit_id} evolve onClose={() => setOpen(false)} onOpeningRequired={onClosedByApi} endOnOutOfContext />
  );
}

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
    // Cada leitura grava trilha: nada de nova tentativa, foco ou reconexão (NOMINAL_QUERY); só a releitura pedida.
    queryKey: [ URGENCY_DETAIL_KEY, row.encounter_id ], queryFn: () => getUrgencyEncounter(row.encounter_id), ...NOMINAL_QUERY
  });
  // Finalizada nesta tela: o desfecho já libera os tipos que esperam a consulta, mesmo antes de o detalhe relido chegar.
  const [ finalizedHere, setFinalizedHere ] = useState(false);
  const encounter = detail.data;
  // A medicação lê o aprazamento (grava trilha): só quando a pessoa abre.
  const [ medicationOpen, setMedicationOpen ] = useState(false);
  const medicationButton = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !medicationOpen) medicationButton.current?.querySelector("button")?.focus();
    wasOpen.current = medicationOpen;
  }, [ medicationOpen ]);
  const target = encounter && (finalizedHere ? { ...encounter, consultation_status: "finalized" as const } : encounter);

  return (
    <div ref={ref}>
      <Panel title={`Atendimento — ${row.ticket ?? "sem senha"}`} sub="consulta de urgência · desfecho">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {detail.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>}
          {detail.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{urgencyError(detail.error)}</p>}
          {encounter && <EncounterSummary encounter={encounter} />}
          {encounter?.observation && <ObservationSummary block={encounter.observation} administrations={encounter.administrations ?? []} />}
          {encounter?.observation && (
            <Evolution encounter={finalizedHere ? { ...encounter, consultation_status: "finalized" } : encounter}
              onClosedByApi={() => onClosed(URGENCY_ERRORS.encounter_closed)} />
          )}
          <ConsultationWorkspace attendanceId={row.attendance_id} unit={unit} units={units} urgency onGoToSecurity={onGoToSecurity}
            onClose={() => onClosed()}
            onFinalized={() => { setFinalizedHere(true); void detail.refetch(); }} />
          {finalizedHere && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{FINALIZED_NOTICE}</p>}
          {/* A prescrição interna (32b): a chave só vem com acesso clínico (Q9); sem ela, a tela é a do 32a. */}
          {target && target.prescription !== undefined && (
            <PrescriptionPanel encounter={target} unit={unit} onChanged={() => void detail.refetch()}
              onEncounterClosed={() => onClosed(URGENCY_ERRORS.encounter_closed)}
              consultationStarted={target.consultation_id !== null && target.consultation_status !== "discarded"} />
          )}
          {target?.prescription?.status === "active" && (medicationOpen ? (
            <MedicationPanel target={{ encounterId: row.encounter_id, ticket: row.ticket, patientName: row.patient.name ?? "sem nome" }}
              prescribedAt={target.prescription.prescribed_at} onClose={() => setMedicationOpen(false)} onEncounterClosed={() => onClosed(URGENCY_ERRORS.encounter_closed)} />
          ) : (
            <span ref={medicationButton}><ActionButton variant="secondary" onClick={() => setMedicationOpen(true)}>Abrir medicação</ActionButton></span>
          ))}
          {target && (
            <OutcomeForm encounter={target} doctor inObservation={target.observation?.current ? { bedLabel: target.observation.current.bed_label } : null}
              prescriptionActive={target.prescription?.status === "active"} onRecorded={(_e, notice) => onClosed(notice)}
              onStale={() => void detail.refetch()} onEncounterClosed={() => onClosed(URGENCY_ERRORS.encounter_closed)} />
          )}
        </div>
      </Panel>
    </div>
  );
}
