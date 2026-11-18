// src/modules/pharmacy/PharmacyGate.tsx
// Portão das telas da farmácia (módulo 27a): interruptor e papel antes de qualquer
// leitura (o api recusaria de novo; aqui só não se oferece a porta). O interruptor
// `pharmacy` vale para as telas só da farmácia; as de estoque passam `stock` (abaixo).
// Módulo 35a (Q21): `stock` nas cinco telas de estoque (posição, transferências, entradas, ajustes e locais) abre também com
// `vector_control` sem `pharmacy` (canUseStockScreens); o api confere o domínio de cada local (StockGate).
// Cópia do molde do RegulationGate: o portão nasce próprio em vez de generalizar
// componente compartilhado. O papel POR LOCAL é do LocationPick.
import type { ReactNode } from "react";
import { useAuth } from "../../lib/auth";
import { PHARMACY_DISABLED, PHARMACY_NO_ROLE, canUsePharmacy, canUseStockScreens, pharmacyRoles } from "../../lib/pharmacy";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/EmptyState";
import { stack } from "../exams/styles";

export type PharmacyRoles = ReturnType<typeof pharmacyRoles>;

export function PharmacyGate({ title, sub, stock = false, allow, children }: {
  title: string; sub: string; stock?: boolean; allow(roles: PharmacyRoles): boolean; children(roles: PharmacyRoles): ReactNode;
}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = pharmacyRoles(user);
  let body: ReactNode;
  if (!(stock ? canUseStockScreens(user) : canUsePharmacy(user))) body = <EmptyState title={PHARMACY_DISABLED} />;
  else if (!allow(roles)) body = <EmptyState title={PHARMACY_NO_ROLE} />;
  else body = children(roles);
  return (
    <div style={stack}>
      <PageHeader title={title} sub={sub} />
      {body}
    </div>
  );
}
