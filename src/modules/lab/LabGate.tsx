// Portão comum das telas do laboratório: interruptor, papel e laboratório
// antes de qualquer leitura (o api recusaria de novo; aqui só não se oferece
// a porta). B32: contexto com `labs: []` = sem laboratório municipal (estado
// vazio, não erro).
import type { ReactNode } from "react";
import { errorCode } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hasFeature, type FeatureKey } from "../../lib/features";
import { LAB_DISABLED, LAB_NO_LAB, LAB_NO_ROLE, UNIT_DOES_NOT_COLLECT, canUseLab, labError, labRoles, type LabRoles } from "../../lib/lab";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Skeleton } from "../../components/Skeleton";
import { stack } from "../exams/styles";
import { useLabContext } from "./useLabContext";

// `needsLab` (padrão true): telas de administração (catálogo, relatórios) leem
// os prestadores por conta própria e têm estado vazio próprio apontando para
// Exames → Catálogo e prestadores; passam `needsLab={false}` e o portão não lê
// o contexto nem mostra LAB_NO_LAB.
// `requires` (21c): interruptores além de `municipal_lab`, basta um ligado;
// `disabledText` é a frase quando nenhum está.
export function LabGate({ title, sub, allow, needsLab = true, requires, disabledText, children }: {
  title: string; sub: string; allow(roles: LabRoles): boolean; needsLab?: boolean; requires?: FeatureKey[]; disabledText?: string;
  children(roles: LabRoles): ReactNode;
}) {
  const { user } = useAuth();
  const roles = labRoles(user);
  const labOn = canUseLab(user);
  const extraOn = !requires || requires.some((key) => hasFeature(user, key));
  const switchOn = labOn && extraOn;
  const permitted = switchOn && allow(roles);
  const context = useLabContext(permitted && needsLab);
  if (!user) return null;
  let body: ReactNode;
  if (!labOn) body = <EmptyState title={LAB_DISABLED} />;
  else if (!extraOn) body = <EmptyState title={disabledText ?? LAB_DISABLED} />;
  else if (!permitted) body = <EmptyState title={LAB_NO_ROLE} />;
  else if (!needsLab) body = children(roles);
  else if (context.isPending) body = <Skeleton rows={3} />;
  // O api responde 403 missing_role ao profissional cujas unidades não coletam.
  else if (context.isError && roles.professional && errorCode(context.error) === "missing_role") body = <EmptyState title={UNIT_DOES_NOT_COLLECT} />;
  else if (context.isError && !context.data) body = <ErrorState message={labError(context.error)} onRetry={() => { void context.refetch(); }} />;
  else if (context.data!.labs.length === 0) body = <EmptyState title={LAB_NO_LAB} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
