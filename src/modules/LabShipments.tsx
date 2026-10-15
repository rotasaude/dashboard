// src/modules/LabShipments.tsx
// Remessas (spec §5.3; contrato §4): na UBS que coleta, montar e enviar,
// remessas montadas e não enviadas, recoletas e não recebidas; no
// laboratório, a conferência das remessas a caminho.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listShipments, sendShipment, type LabShipment } from "../lib/api";
import { LAB_SHIPMENTS_KEY, labError, refreshLab, shipmentStatusLabel } from "../lib/lab";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { ActionButton } from "../components/ActionButton";
import { LabGate } from "./lab/LabGate";
import { LabScope } from "./lab/LabScope";
import { ShipmentBuilder } from "./lab/ShipmentBuilder";
import { ShipmentCheck } from "./lab/ShipmentCheck";
import { UnitPendingSamples } from "./lab/UnitPendingSamples";
import { alert, stack } from "./exams/styles";

export function LabShipments() {
  return (
    <LabGate title="Remessas" sub="laboratório municipal · da UBS ao laboratório" allow={(r) => r.staff || r.professional}>
      {(roles) => (
        <LabScope roles={roles}>
          {(scope) => scope.kind === "lab"
            ? <ShipmentCheck providerId={scope.providerId} />
            : <UbsShipments unitId={scope.unit.id} providerId={scope.providerId} unitName={scope.unit.name} />}
        </LabScope>
      )}
    </LabGate>
  );
}

function UbsShipments({ unitId, providerId, unitName }: { unitId: string; providerId: string; unitName: string }) {
  const queryClient = useQueryClient();
  const [ error, setError ] = useState<string | null>(null);
  const openShipments = useQuery({
    queryKey: [ LAB_SHIPMENTS_KEY, "ubs", unitId ], queryFn: () => listShipments({ originUnitId: unitId, statuses: [ "open" ] }),
    gcTime: 0, staleTime: 0, retry: false
  });

  async function resend(s: LabShipment) {
    setError(null);
    try {
      await sendShipment(s.id);
      await refreshLab(queryClient);
    } catch (err) {
      setError(labError(err));
      if (errorCode(err) === "invalid_transition") void openShipments.refetch();
    }
  }

  return (
    <div style={stack}>
      <Panel title="Nova remessa" sub={unitName}>
        <ShipmentBuilder unitId={unitId} providerId={providerId} onSent={() => void openShipments.refetch()} />
      </Panel>
      {(openShipments.data?.length ?? 0) > 0 && (
        <Panel title="Remessas montadas" sub="criadas e ainda não enviadas">
          <DataTable<LabShipment>
            cols={[
              { label: "Amostras", w: "1fr", card: "title", render: (s) => s.samples.map((x) => x.barcode).join(", ") },
              { label: "Situação", w: "0.8fr", render: (s) => shipmentStatusLabel(s.status) },
              { label: "", w: "auto", card: "actions", render: (s) => <ActionButton variant="secondary" onClick={() => resend(s)}>Enviar</ActionButton> }
            ]}
            rows={openShipments.data ?? []} rowKey={(s) => s.id}
          />
        </Panel>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      <UnitPendingSamples unitId={unitId} />
    </div>
  );
}
