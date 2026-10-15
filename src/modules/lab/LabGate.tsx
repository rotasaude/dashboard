// Portão comum das telas do laboratório: interruptor, papel e laboratório
// antes de qualquer leitura (o api recusaria de novo; aqui só não se oferece
// a porta). B32: contexto com `labs: []` = sem laboratório municipal (estado
// vazio, não erro).
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { LAB_DISABLED, LAB_NO_LAB, LAB_NO_ROLE, canUseLab, labError, labRoles, type LabRoles } from "../../lib/lab";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { stack } from "../exams/styles";
import { useLabContext } from "./useLabContext";

export function LabGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: LabRoles): boolean; children(roles: LabRoles): ReactNode;
}) {
  const { user } = useAuth();
  const roles = labRoles(user);
  const switchOn = canUseLab(user);
  const permitted = switchOn && allow(roles);
  const context = useLabContext(permitted);
  if (!user) return null;
  let body: ReactNode;
  if (!switchOn) body = <EmptyState title={LAB_DISABLED} />;
  else if (!permitted) body = <EmptyState title={LAB_NO_ROLE} />;
  else if (context.isPending) body = <Skeleton rows={3} />;
  else if (context.isError) body = <ErrorState message={labError(context.error)} onRetry={() => { void context.refetch(); }} />;
  else if (context.data.labs.length === 0) body = <EmptyState title={LAB_NO_LAB} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
