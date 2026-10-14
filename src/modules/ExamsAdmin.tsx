// src/modules/ExamsAdmin.tsx
// Catálogo de exames e prestadores da cidade (módulo 21a; spec §9 "Admin
// municipal"; contrato §5). Só municipal_admin, com exam_tracking.
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { EXAMS_DISABLED, EXAMS_NO_ROLE, canUseExams, examRoles } from "../lib/exams";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { CatalogPanel } from "./examsAdmin/CatalogPanel";
import { stack } from "./exams/styles";

export function ExamsAdmin({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!canUseExams(user)) return <Frame><EmptyState title={EXAMS_DISABLED} /></Frame>;
  if (!examRoles(user).admin) return <Frame><EmptyState title={EXAMS_NO_ROLE} /></Frame>;
  return (
    <Frame>
      <CatalogPanel onGoToSecurity={onGoToSecurity} />
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={stack}>
      <PageHeader title="Catálogo e prestadores" sub="cidade · exames, prazos, prestadores e acessos" />
      {children}
    </div>
  );
}
