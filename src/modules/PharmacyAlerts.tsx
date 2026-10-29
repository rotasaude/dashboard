// PharmacyAlerts — alertas da farmácia (módulo 27a; F-27.7; contrato §5). Tela de CONSULTA: o `LocationPick` aceita qualquer local
// (o almoxarife do central vê também os alheios, com `roles: []`); os atalhos para as telas de ação só aparecem onde `locationRoles`
// dá o papel. As cinco CONTAGENS (GET /pharmacy/alerts) não gravam trilha e não têm dado pessoal, então o react-query pode relê-las
// (como o AlertsPanel do 21c); nada de temporizador próprio. As LISTAS saem da POSIÇÃO (filtros expiring / below_minimum), não do
// endpoint de contagem: lidas ao abrir (STATIC_QUERY, sem releitura), só a primeira página, na ordem do nome do item (H10).
// Contagens são do local escolhido; "Todos os locais" (só o almoxarife do central) troca apenas as listas. Unidade: `dispensing_unit`.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPharmacyAlerts, listPositions, type LotBalance, type PharmacyLocation, type StockPosition } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDay } from "../lib/exams";
import {
  PHARMACY_ALERTS_REFRESH_MS, PH_ALERTS_KEY, PH_POSITIONS_KEY, STATIC_QUERY, fmtQuantity, locationRoles, pharmacyError, sortPositions
} from "../lib/pharmacy";
import { toHash } from "../shell/router";
import { DataTable } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { alert, checkLabel, muted, row, stack } from "./exams/styles";
import { LocationPick } from "./pharmacy/LocationPick";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

const NOTHING = "nada aqui";
const screenLink = (id: string) => toHash({ kind: "screen", id });

// Lote por lote (o api marca `expiring_soon` / `expired`): só os que vencem ou venceram, e com saldo (defensivo).
// Sem os campos (api antigo), mostra todos os lotes e a data decide o "vencido".
const shown = (b: LotBalance) => (b.expiring_soon === undefined && b.expired === undefined ? true : !!(b.expiring_soon || b.expired)) && Number(b.balance) > 0;
const isExpired = (b: LotBalance, today: string) => b.expired ?? b.lot.expires_on < today;

interface ExpiringRow { position: StockPosition; balance: LotBalance }

export function PharmacyAlerts({ today = todayInCity() }: { today?: string } = {}) {
  return (
    <PharmacyGate title="Alertas da farmácia" sub="vencendo, abaixo do mínimo, em trânsito e pendências" allow={(r) => r.pharmacist || r.assistant || r.keeper}>
      {() => (
        <LocationPick allow={() => true}>
          {(loc) => <Body location={loc} today={today} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

function Body({ location, today }: { location: PharmacyLocation; today: string }) {
  const roles = locationRoles(location);
  // "Todos os locais" nas listas: só o almoxarife do central; o api recusa de novo.
  const canAll = location.kind === "central" && roles.keeper;
  const [ all, setAll ] = useState(false);
  const scope = canAll && all ? null : location.id;
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      <Counts location={location} canTransfers={roles.pharmacist || roles.assistant || roles.keeper} canAdjustments={roles.pharmacist || roles.keeper} />
      {canAll && (
        <div style={row}>
          <label style={checkLabel}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            Todos os locais
          </label>
          <span style={muted}>as listas valem para todos os locais; as contagens, só para este</span>
        </div>
      )}
      <ExpiringList scope={scope} today={today} />
      <BelowMinimumList scope={scope} />
    </div>
  );
}

function Counts({ location, canTransfers, canAdjustments }: { location: PharmacyLocation; canTransfers: boolean; canAdjustments: boolean }) {
  const alerts = useQuery({
    queryKey: [ PH_ALERTS_KEY, location.id ], queryFn: () => getPharmacyAlerts(location.id), retry: false, refetchInterval: PHARMACY_ALERTS_REFRESH_MS
  });
  const data = alerts.data;
  const line = (text: string, link?: ReactNode) => <li style={row}><span>{text}</span>{link}</li>;
  return (
    <Panel title="Contagens do local" sub={location.name}>
      {alerts.isError && !data ? <p role="alert" style={alert}>{pharmacyError(alerts.error)}</p> : !data ? <p className="mono" style={muted}>carregando…</p> : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
          {line(`Vencendo: ${data.expiring}`)}
          {line(`Vencidos: ${data.expired}`)}
          {line(`Abaixo do mínimo: ${data.below_minimum}`)}
          {line(`Em trânsito: ${data.in_transit}`, canTransfers && <a href={screenLink("pharmacy-transfers")}>Transferências</a>)}
          {line(`Ajustes aguardando aprovação: ${data.pending_adjustments}`, canAdjustments && <a href={screenLink("pharmacy-adjustments")}>Inventário e ajustes</a>)}
        </ul>
      )}
    </Panel>
  );
}

// Primeira página das posições com o filtro; a página já vem ordenada por nome do item (H10).
function usePositionList(scope: string | null, filter: "expiring" | "belowMinimum") {
  return useQuery({
    queryKey: [ PH_POSITIONS_KEY, "alerts", filter, scope ],
    queryFn: () => listPositions(filter === "expiring" ? { locationId: scope, expiring: true } : { locationId: scope, belowMinimum: true }),
    ...STATIC_QUERY
  });
}

function ListBody({ query, children }: { query: ReturnType<typeof usePositionList>; children(positions: StockPosition[]): ReactNode }) {
  if (query.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (query.isError) return <p role="alert" style={alert}>{pharmacyError(query.error)}</p>;
  return (
    <div style={stack}>
      {children(sortPositions(query.data.positions))}
      {query.data.next_before && <p style={muted}>Mostrando só as primeiras posições. <a href={screenLink("pharmacy-stock")}>Ver na posição</a></p>}
    </div>
  );
}

function ExpiringList({ scope, today }: { scope: string | null; today: string }) {
  const query = usePositionList(scope, "expiring");
  return (
    <Panel title="Vencendo e vencidos" sub="lotes a vencer e já vencidos (a contagem Vencendo não inclui os vencidos)">
      <ListBody query={query}>
        {(positions) => (
          <DataTable<ExpiringRow>
            cols={[
              { label: "Lote · medicamento", w: "1.8fr", card: "title", render: (r) => `${r.balance.lot.lot_number} · ${r.position.item.name}` },
              { label: "Local", w: "1fr", render: (r) => r.position.location.name },
              { label: "Validade", w: "1fr", render: (r) => (
                <span style={row}>{fmtDay(r.balance.lot.expires_on)}{isExpired(r.balance, today) && <Tag tone="down">vencido</Tag>}</span>
              ) },
              { label: "Saldo", w: "0.8fr", align: "right", render: (r) => <span className="mono">{`${fmtQuantity(r.balance.balance)} ${r.position.item.dispensing_unit}`}</span> }
            ]}
            rows={positions.flatMap((position) => position.lots.filter(shown).sort((a, b) => a.lot.expires_on.localeCompare(b.lot.expires_on)).map((balance) => ({ position, balance })))}
            rowKey={(r) => `${r.position.location.id}:${r.balance.lot.id}`} empty={NOTHING}
          />
        )}
      </ListBody>
    </Panel>
  );
}

function BelowMinimumList({ scope }: { scope: string | null }) {
  const query = usePositionList(scope, "belowMinimum");
  return (
    <Panel title="Abaixo do mínimo" sub="saldo contra o estoque mínimo do local">
      <ListBody query={query}>
        {(positions) => (
          <DataTable<StockPosition>
            cols={[
              { label: "Local", w: "1fr", render: (p) => p.location.name },
              { label: "Medicamento", w: "1.6fr", card: "title", render: (p) => p.item.name },
              { label: "Saldo", w: "1.2fr", render: (p) => (
                <span className="mono">{`${fmtQuantity(p.balance)} ${p.item.dispensing_unit} (mínimo ${fmtQuantity(p.minimum)})`}</span>
              ) }
            ]}
            rows={positions} rowKey={(p) => `${p.location.id}:${p.item.catalog_item_id}`} empty={NOTHING}
          />
        )}
      </ListBody>
    </Panel>
  );
}
