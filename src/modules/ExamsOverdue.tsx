// src/modules/ExamsOverdue.tsx
// Exames atrasados da cidade (coordenação: municipal_admin e exam_regulator).
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { EXAMS_DISABLED, EXAMS_NO_ROLE, canUseExams, examRoles } from "../lib/exams";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { OverduePanel } from "./exams/OverduePanel";
import { stack } from "./exams/styles";

export function ExamsOverdue() {
  const { user } = useAuth();
  if (!user) return null;
  if (!canUseExams(user)) return <Frame><EmptyState title={EXAMS_DISABLED} /></Frame>;
  const roles = examRoles(user);
  if (!(roles.admin || roles.regulator)) return <Frame><EmptyState title={EXAMS_NO_ROLE} /></Frame>;
  return <Frame><OverduePanel canOpen={false} /></Frame>;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={stack}>
      <PageHeader title="Exames atrasados" sub="coordenação · cidade inteira" />
      {children}
    </div>
  );
}
