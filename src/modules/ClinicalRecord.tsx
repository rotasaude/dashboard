// src/modules/ClinicalRecord.tsx
// Prontuário fora do atendimento (módulo 19; spec §5 e §7): abertura
// justificada para o profissional e, para o municipal_admin, o relatório das
// aberturas (Task 11). Só com `clinical_record` na sessão; a recepção não entra.
import { useState, type ReactNode } from "react";
import type { Opening } from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { OpeningForm } from "./clinicalRecord/OpeningForm";
import { JustifiedRecord } from "./clinicalRecord/JustifiedRecord";

export function ClinicalRecord({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const [ opening, setOpening ] = useState<Opening | null>(null);
  if (!user) return null;
  const roles = user.memberships.map((m) => m.role);
  const isProfessional = roles.includes("health_professional");
  const isAdmin = roles.includes("municipal_admin");

  if (!hasFeature(user, "clinical_record")) return <Frame><EmptyState title="o prontuário está desligado nesta cidade" /></Frame>;
  if (user.operator || (!isProfessional && !isAdmin)) {
    return <Frame><EmptyState title="seu papel não permite abrir o prontuário" /></Frame>;
  }

  return (
    <Frame>
      {isProfessional && (opening
        ? <JustifiedRecord key={opening.opening_id} opening={opening} onEnd={() => setOpening(null)} />
        : <OpeningForm onOpened={setOpening} onGoToSecurity={onGoToSecurity} />)}
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
