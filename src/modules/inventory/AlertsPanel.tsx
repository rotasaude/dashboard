// Alertas do estoque (spec §6.6; contrato §5): lotes vencendo dentro do aviso
// do item (ou já vencidos), itens abaixo do mínimo (o api conta só lote não
// vencido, C-E28) e quantos resultados saíram sem lote de reagente em uso.
// A rota não grava trilha, então pode ser relida pelo react-query (como o
// contador de bloqueios do CIQ); nada de temporizador próprio.
import { useQuery } from "@tanstack/react-query";
import { getInventoryAlerts, type LabExpiringLot, type LabLowSupply } from "../../lib/api";
import { INV_ALERTS_KEY, inventoryError } from "../../lib/inventory";
import { todayInCity } from "../../lib/campaigns";
import { fmtDay } from "../../lib/exams";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { alert, muted, stack, title } from "../exams/styles";

export const INV_ALERTS_REFRESH_MS = 60_000;

export function AlertsPanel({ providerId }: { providerId: string }) {
  const today = todayInCity();
  const alerts = useQuery({
    queryKey: [ INV_ALERTS_KEY, providerId ], queryFn: () => getInventoryAlerts(providerId), retry: false, refetchInterval: INV_ALERTS_REFRESH_MS
  });
  const data = alerts.data;
  return (
    <Panel title="Alertas do estoque" sub="vencimento, estoque mínimo e resultados sem rastreio">
      {alerts.isError && !data ? <p role="alert" style={alert}>{inventoryError(alerts.error)}</p> : !data ? <p className="mono" style={muted}>carregando…</p> : (
        <div style={stack}>
          <p style={{ margin: 0 }}>
            {data.untraced_results > 0
              ? <Tag tone="warn">{`${data.untraced_results} ${data.untraced_results === 1 ? "resultado" : "resultados"} sem rastreio de reagente`}</Tag>
              : <span style={muted}>todos os resultados com lote de reagente</span>}
          </p>
          <h3 style={title}>Vencendo</h3>
          <DataTable<LabExpiringLot>
            cols={[
              { label: "Lote · item", w: "1.8fr", card: "title", render: (l) => `${l.lot_number} · ${l.supply_name}` },
              { label: "Validade", w: "1fr", render: (l) => <>{fmtDay(l.expires_on)}{l.expires_on < today && <> <Tag tone="down">vencido</Tag></>}</> },
              { label: "Saldo", w: "0.6fr", align: "right", render: (l) => String(l.balance) }
            ]}
            rows={data.expiring} rowKey={(l) => l.lot_id} empty="nenhum lote vencendo"
          />
          <h3 style={title}>Abaixo do mínimo</h3>
          <DataTable<LabLowSupply>
            cols={[
              { label: "Item", w: "1.6fr", card: "title", render: (s) => s.name },
              { label: "Saldo", w: "1fr", render: (s) => `${s.balance} ${s.unit} (mínimo ${s.minimum_stock})` }
            ]}
            rows={data.below_minimum} rowKey={(s) => s.supply_id} empty="nenhum item abaixo do mínimo"
          />
        </div>
      )}
    </Panel>
  );
}
