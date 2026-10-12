// src/modules/ClinicalRecord.tsx
// Prontuário fora do atendimento (módulo 19; spec §5 e §7): abertura
// justificada para o profissional e, para o municipal_admin, o relatório das
// aberturas (Task 11). Só com `clinical_record` na sessão; a recepção não entra.
// Módulo 20: com `patient_timeline`, o profissional abre também só a linha do
// tempo (modo integrated ou abertura sem paciente: JustifiedTimeline).
import { useState, type ReactNode } from "react";
import type { Opening } from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { OpeningForm } from "./clinicalRecord/OpeningForm";
import { JustifiedRecord } from "./clinicalRecord/JustifiedRecord";
import { JustifiedTimeline } from "./clinicalRecord/JustifiedTimeline";
import { OpeningsReport } from "./clinicalRecord/OpeningsReport";

export function ClinicalRecord({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const [ opening, setOpening ] = useState<Opening | null>(null);
  if (!user) return null;
  const roles = user.memberships.map((m) => m.role);
  const isProfessional = roles.includes("health_professional");
  const isAdmin = roles.includes("municipal_admin");
  // Módulo 20: no modo integrated não há prontuário, mas há linha do tempo
  // (só do profissional; o relatório das aberturas segue do clinical_record).
  const recordOn = hasFeature(user, "clinical_record");
  const timelineOn = hasFeature(user, "patient_timeline");

  if (!recordOn && !timelineOn) return <Frame><EmptyState title="o prontuário está desligado nesta cidade" /></Frame>;
  if (user.operator || (!isProfessional && !(isAdmin && recordOn))) {
    return <Frame><EmptyState title="seu papel não permite abrir o prontuário" /></Frame>;
  }

  return (
    <Frame>
      {isProfessional && (opening
        ? (recordOn && opening.patient_id !== null
          ? <JustifiedRecord key={opening.opening_id} opening={opening} onEnd={() => setOpening(null)} />
          : <JustifiedTimeline key={opening.opening_id} opening={opening} onEnd={() => setOpening(null)} />)
        : <OpeningForm onOpened={setOpening} onGoToSecurity={onGoToSecurity} timelineOnly={!recordOn} timelineOn={timelineOn} />)}
      {isAdmin && recordOn && <OpeningsReport />}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Prontuário" sub="leitura fora do atendimento · abertura justificada" />
      {children}
    </div>
  );
}
