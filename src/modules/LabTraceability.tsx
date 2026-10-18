// src/modules/LabTraceability.tsx
// Rastreio por lote e consumo estimado (spec §6.7–§6.8; contrato §5, C-E33,
// C-E37, C-E41). Qualquer membro do laboratório e o admin leem. O rastreio
// grava trilha de leitura: só consulta no clique, nunca sozinho nem de novo
// por polling, e mostra número da requisição e código do exame (sem paciente,
// sem valor). O api corta cada lista em 5000 e avisa; a tela repete o aviso. O
// consumo compara testes realizados com os das embalagens abertas; nada é
// baixado. Os CSV vêm do api e são salvos como estão.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchConsumptionCsv, fetchSupplyLotTraceCsv, getConsumption, listLabInstruments, listSupplies, listSupplyLots, traceSupplyLot,
  type LabConsumptionRow, type LabLotTrace
} from "../lib/api";
import { INVENTORY_DISABLED, INV_CONSUMPTION_KEY, INV_LOTS_KEY, INV_SUPPLIES_KEY, deviationTone, fmtDeviation, inventoryError } from "../lib/inventory";
import { QC_INSTRUMENTS_KEY } from "../lib/qc";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { ActionButton } from "../components/ActionButton";
import { inputStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { saveFile } from "./lab/saveFile";
import { alert, fieldLabel, muted, row, stack, title } from "./exams/styles";

const safeName = (s: string) => s.replace(/[^A-Za-z0-9-]/g, "-");
const TRUNCATED = "a lista foi cortada em 5000 linhas — o CSV traz o mesmo corte (as duas últimas linhas dele dizem se houve)";

export function LabTraceability() {
  return (
    <LabGate title="Rastreio e consumo de reagentes" sub="insumos · rastreio por lote e consumo estimado"
      allow={(r) => r.admin || r.staff || r.releaser} requires={[ "lab_inventory" ]} disabledText={INVENTORY_DISABLED}>
      {() => <LabPick>{(lab) => (
        <div style={stack}>
          <TracePanel providerId={lab.id} />
          <ConsumptionPanel providerId={lab.id} />
        </div>
      )}</LabPick>}
    </LabGate>
  );
}

function TracePanel({ providerId }: { providerId: string }) {
  const supplies = useQuery({ queryKey: [ INV_SUPPLIES_KEY, providerId ], queryFn: () => listSupplies(providerId), retry: false });
  const [ supplyId, setSupplyId ] = useState("");
  // Lote esgotado também é rastreado: sem o filtro de saldo.
  const lots = useQuery({
    queryKey: [ INV_LOTS_KEY, supplyId, "all" ], queryFn: () => listSupplyLots({ supplyId, withBalance: false }), enabled: supplyId !== "", retry: false
  });
  const [ lotId, setLotId ] = useState("");
  const [ trace, setTrace ] = useState<LabLotTrace | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const busy = useRef(false);
  const currentLot = useRef("");
  const lot = (lots.data ?? []).find((l) => l.id === lotId);

  async function run() {
    if (!lotId || busy.current) return;
    busy.current = true;
    setError(null);
    const asked = lotId;
    try {
      const result = await traceSupplyLot(asked);
      // Resposta que chega depois da troca de lote é descartada.
      if (currentLot.current === asked) setTrace(result);
    } catch (err) {
      if (currentLot.current === asked) { setTrace(null); setError(inventoryError(err)); }
    } finally { busy.current = false; }
  }

  function chooseLot(id: string) { currentLot.current = id; setLotId(id); setTrace(null); setError(null); }

  async function csv() {
    if (!lot) return;
    setError(null);
    try { const file = await fetchSupplyLotTraceCsv(lot.id); saveFile(file, file.filename || `rastreio-lote-${safeName(lot.lot_number)}.csv`); } catch (err) { setError(inventoryError(err)); }
  }

  return (
    <Panel title="Rastreio por lote" sub="requisições, exames e controles com aquele lote de reagente — sem nome de paciente">
      <div style={stack}>
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>Item
            <select value={supplyId} style={inputStyle} onChange={(e) => { setSupplyId(e.target.value); chooseLot(""); }}>
              <option value="">—</option>
              {(supplies.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>Lote
            <select value={lotId} style={inputStyle} onChange={(e) => chooseLot(e.target.value)}>
              <option value="">—</option>
              {(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{l.lot_number}</option>)}
            </select>
          </label>
          <ActionButton disabledReason={lotId ? null : "escolha o lote"} onClick={run}>Rastrear</ActionButton>
          {trace && <ActionButton variant="secondary" onClick={csv}>Baixar CSV do rastreio</ActionButton>}
        </div>
        {supplies.isError && <p role="alert" style={alert}>{inventoryError(supplies.error)}</p>}
        {lots.isError && <p role="alert" style={alert}>{inventoryError(lots.error)}</p>}
        {error && <p role="alert" style={alert}>{error}</p>}
        {trace && (
          <>
            <h3 style={title}>Resultados</h3>
            {trace.results_truncated && <p role="status" style={alert}>{`resultados: ${TRUNCATED}`}</p>}
            <DataTable<LabLotTrace["results"][number]>
              cols={[
                { label: "Requisição", w: "1fr", card: "title", render: (r) => <span className="mono">{r.requisition_number}</span> },
                { label: "Exame (SIGTAP)", w: "1fr", render: (r) => <span className="mono">{r.sigtap_code}</span> },
                { label: "Quando", w: "1fr", render: (r) => fmtDateTime(r.entered_at) }
              ]}
              rows={trace.results} rowKey={(r, i) => `${r.requisition_number}:${r.sigtap_code}:${i}`} empty="nenhum resultado com este lote"
            />
            <h3 style={title}>Controles</h3>
            {trace.qc_values_truncated && <p role="status" style={alert}>{`controles: ${TRUNCATED}`}</p>}
            <DataTable<LabLotTrace["qc_values"][number]>
              cols={[
                { label: "Corrida", w: "1fr", card: "title", render: (q) => <span className="mono">{q.run_id}</span> },
                { label: "Analito", w: "1fr", render: (q) => q.analyte_key },
                { label: "Quando", w: "1fr", render: (q) => fmtDateTime(q.entered_at) }
              ]}
              rows={trace.qc_values} rowKey={(q, i) => `${q.run_id}:${q.analyte_key}:${i}`} empty="nenhum controle com este lote"
            />
          </>
        )}
        {!trace && !error && <p style={muted}>escolha o item e o lote e clique em Rastrear</p>}
        <p style={muted}>cada consulta e cada CSV do rastreio ficam registrados</p>
      </div>
    </Panel>
  );
}

function ConsumptionPanel({ providerId }: { providerId: string }) {
  const [ month, setMonth ] = useState(() => todayInCity().slice(0, 7));
  const [ error, setError ] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}$/.test(month);
  const q = { providerId, month };
  const rows = useQuery({ queryKey: [ INV_CONSUMPTION_KEY, providerId, month ], queryFn: () => getConsumption(q), enabled: valid, retry: false });
  const instruments = useQuery({ queryKey: [ QC_INSTRUMENTS_KEY, providerId, "lab" ], queryFn: () => listLabInstruments(providerId), retry: false });
  const instName = (r: LabConsumptionRow) => {
    if (r.line === "total") return "total";
    if (r.line === "no_instrument") return "sem aparelho";
    return (instruments.data ?? []).find((i) => i.id === r.instrument_id)?.name ?? r.instrument_id ?? "—";
  };
  const count = (n: number | null) => (n === null || n === undefined ? "—" : String(n));

  async function csv() {
    setError(null);
    try { const file = await fetchConsumptionCsv(q); saveFile(file, file.filename || `consumo-${month}.csv`); } catch (err) { setError(inventoryError(err)); }
  }

  return (
    <Panel title="Consumo estimado" sub="testes realizados (resultados, repetições e controles) × testes das embalagens abertas no mês"
      right={<ActionButton variant="secondary" disabledReason={valid ? null : "escolha o mês"} onClick={csv}>Baixar CSV do consumo</ActionButton>}>
      <div style={stack}>
        <label style={fieldLabel}>Mês<input type="month" value={month} style={inputStyle} onChange={(e) => setMonth(e.target.value)} /></label>
        {error && <p role="alert" style={alert}>{error}</p>}
        {rows.isError ? <p role="alert" style={alert}>{inventoryError(rows.error)}</p> : (
          <DataTable<LabConsumptionRow>
            cols={[
              { label: "Item", w: "1.6fr", card: "title", render: (r) => r.name },
              { label: "Aparelho", w: "1fr", render: (r) => instName(r) },
              { label: "Testes realizados", w: "0.9fr", align: "right", render: (r) => String(r.tests_performed) },
              { label: "Testes das aberturas", w: "0.9fr", align: "right", render: (r) => count(r.tests_opened) },
              { label: "Desvio", w: "0.8fr", align: "right", render: (r) => {
                const tone = deviationTone(r.deviation_pct);
                return tone ? <Tag tone={tone}>{fmtDeviation(r.deviation_pct)}</Tag> : fmtDeviation(r.deviation_pct);
              } }
            ]}
            rows={rows.data ?? []} rowKey={(r) => `${r.supply_id}:${r.line}:${r.instrument_id ?? "-"}`}
            empty={rows.isPending && valid ? "carregando…" : "nenhum reagente neste laboratório"}
          />
        )}
        {rows.data && rows.data.length > 0 && <p style={muted}>sem aberturas no mês não há desvio (—); a soma das linhas por aparelho é o total do item</p>}
      </div>
    </Panel>
  );
}
