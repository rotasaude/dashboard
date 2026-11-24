// src/modules/zoonoses/ZoonosesGate.tsx
// Portão das telas do módulo 35b (centro de zoonoses; ADR 0054): o operador nunca, interruptor (com o cadastro territorial
// utilizável) e papel antes de qualquer leitura. O api confere de novo (403 feature_disabled / missing_role).
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { ZOO_NO_ROLE, zoonosesRoles, zoonosesUsable, type ZoonosesRoles } from "../../lib/zoonoses";
import { ZOONOSES_DISABLED } from "../../lib/zoonosesErrors";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export function ZoonosesGate({ title, sub, allow, children }: {
  title: string; sub: string; allow(roles: ZoonosesRoles): boolean; children(roles: ZoonosesRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = zoonosesRoles(user);
  let body: ReactNode;
  if (user.operator) body = <EmptyState title={ZOO_NO_ROLE} />;
  // Desligado = interruptor ou cadastro territorial; com o centro ligado, a falta de papel diz a frase do papel.
  else if (!zoonosesUsable(user)) body = <EmptyState title={ZOONOSES_DISABLED} />;
  else if (!roles.reader || !allow(roles)) body = <EmptyState title={ZOO_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
