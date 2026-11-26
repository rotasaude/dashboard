// src/modules/bnafar/BnafarGate.tsx
// Portão das telas do envio à BNAFAR (módulo 27b), no molde do PharmacyGate: interruptor e papel antes de qualquer leitura
// (o api recusa de novo). `needs="bnafar"` (padrão): status e remessas (Q40) e a saída externa com envio; `needs="stock"`:
// pendências (Q22) e saldo inicial (Q19/Q20), que abrem sem o `bnafar`, só com o estoque de algum domínio.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { hasFeature } from "../../lib/features";
import { BNAFAR_DISABLED, BNAFAR_NO_ROLE, bnafarRoles, canUseBnafar } from "../../lib/bnafar";
import { PHARMACY_DISABLED, canUseStockScreens } from "../../lib/pharmacy";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type BnafarRoles = ReturnType<typeof bnafarRoles>;

export function BnafarGate({ title, sub, needs = "bnafar", allow, children }: {
  title: string; sub: string; needs?: "bnafar" | "stock"; allow(roles: BnafarRoles): boolean; children(roles: BnafarRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = bnafarRoles(user);
  const on = needs === "bnafar" ? canUseBnafar(user)
    : !user.operator && (canUseStockScreens(user) || hasFeature(user, "vaccination"));
  let body: ReactNode;
  if (!on) body = <EmptyState title={needs === "bnafar" ? BNAFAR_DISABLED : PHARMACY_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={BNAFAR_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
