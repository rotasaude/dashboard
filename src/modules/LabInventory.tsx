// src/modules/LabInventory.tsx
// Estoque do laboratório (spec §6; contrato §5): itens (admin), entrada de
// lote, movimentos (abertura, perda, vencimento; ajuste só admin), lote em uso
// por aparelho e alertas. Nada é baixado sozinho. Só os alertas (sem trilha)
// são relidos periodicamente.
import { useQuery } from "@tanstack/react-query";
import { listLabExams } from "../lib/api";
import { INVENTORY_DISABLED } from "../lib/inventory";
import { QC_EXAMS_KEY } from "../lib/qc";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { SuppliesPanel } from "./inventory/SuppliesPanel";
import { SupplyLotsPanel } from "./inventory/SupplyLotsPanel";
import { AlertsPanel } from "./inventory/AlertsPanel";
import { InUsePanel } from "./inventory/InUsePanel";
import { stack } from "./exams/styles";

export function LabInventory({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <LabGate title="Estoque do laboratório" sub="insumos · itens, lotes, movimentos e lote em uso"
      allow={(r) => r.admin || r.staff || r.releaser} requires={[ "lab_inventory" ]} disabledText={INVENTORY_DISABLED}>
      {(roles) => <LabPick>{(lab) => <InventoryBody providerId={lab.id} admin={roles.admin} onGoToSecurity={onGoToSecurity} />}</LabPick>}
    </LabGate>
  );
}

function InventoryBody({ providerId, admin, onGoToSecurity }: { providerId: string; admin: boolean; onGoToSecurity?(): void }) {
  const exams = useQuery({ queryKey: [ QC_EXAMS_KEY, providerId ], queryFn: () => listLabExams(providerId), retry: false });
  return (
    <div style={stack}>
      <AlertsPanel providerId={providerId} />
      <SuppliesPanel providerId={providerId} admin={admin} exams={exams.data ?? []} onGoToSecurity={onGoToSecurity} />
      <SupplyLotsPanel providerId={providerId} admin={admin} onGoToSecurity={onGoToSecurity} />
      <InUsePanel providerId={providerId} exams={exams.data ?? []} />
    </div>
  );
}
