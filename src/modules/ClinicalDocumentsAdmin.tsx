// Documentos clínicos da cidade (módulo 19c; spec §3 e §7 "Admin municipal";
// contrato §6): CNPJ da secretaria/fundo (sai na receita de enfermagem),
// REMUME (os medicamentos "na rede") e protocolos de enfermagem. Só
// municipal_admin, com clinical_documents; toda escrita com step-up.
import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { DOCUMENTS_DISABLED, canUseDocuments } from "../lib/clinicalDocuments";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { CnpjPanel } from "./clinicalDocumentsAdmin/CnpjPanel";
import { RemumePanel } from "./clinicalDocumentsAdmin/RemumePanel";

export function ClinicalDocumentsAdmin({ onGoToSecurity, searchDelayMs }: { onGoToSecurity?(): void; searchDelayMs?: number }) {
  const { user } = useAuth();
  if (!user) return null;
  const isAdmin = !user.operator && user.memberships.some((m) => m.role === "municipal_admin");
  if (!isAdmin) return <Frame><EmptyState title="seu papel não permite ver esta tela" /></Frame>;
  if (!canUseDocuments(user)) return <Frame><EmptyState title={DOCUMENTS_DISABLED} /></Frame>;
  return (
    <Frame>
      <CnpjPanel onGoToSecurity={onGoToSecurity} />
      <RemumePanel onGoToSecurity={onGoToSecurity} searchDelayMs={searchDelayMs} />
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Documentos clínicos" sub="cidade · CNPJ, REMUME e protocolos de enfermagem" />
      {children}
    </div>
  );
}
