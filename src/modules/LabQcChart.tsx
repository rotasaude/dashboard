// src/modules/LabQcChart.tsx
// Levey-Jennings por lote, nível, analito e aparelho (spec §5.9; contrato §3).
// Lê o liberador/RT e o administrador municipal; lab_staff não (C-E41). Até 200
// pontos; sem trilha, mas só lê quando a escolha muda (sem releitura automática).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQcChart, listLabExams, listLabInstruments, listQcLots, listQcMaterials, type QcChartQuery } from "../lib/api";
import { QC_CHART_KEY, QC_DISABLED, QC_EXAMS_KEY, QC_INSTRUMENTS_KEY, QC_LOTS_KEY, QC_MATERIALS_KEY, analyteName, qcError } from "../lib/qc";
import { addDays, todayInCity } from "../lib/campaigns";
import { Panel } from "../components/Panel";
import { inputStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { LeveyJennings } from "./qc/LeveyJennings";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;
const span = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

export function LabQcChart() {
  return (
    <LabGate title="Levey-Jennings" sub="CIQ · controle por lote, nível, analito e aparelho" allow={(r) => r.releaser || r.admin}
      requires={[ "lab_quality_control" ]} disabledText={QC_DISABLED}>
      {() => <LabPick>{(lab) => <ChartBody providerId={lab.id} />}</LabPick>}
    </LabGate>
  );
}

function ChartBody({ providerId }: { providerId: string }) {
  const today = todayInCity();
  const instruments = useQuery({ queryKey: [ QC_INSTRUMENTS_KEY, providerId, "lab" ], queryFn: () => listLabInstruments(providerId), retry: false });
  const exams = useQuery({ queryKey: [ QC_EXAMS_KEY, providerId ], queryFn: () => listLabExams(providerId), retry: false });
  const lots = useQuery({ queryKey: [ QC_LOTS_KEY, providerId ], queryFn: () => listQcLots({ providerId }), retry: false });
  const materials = useQuery({ queryKey: [ QC_MATERIALS_KEY, providerId ], queryFn: () => listQcMaterials(providerId), retry: false });
  const active = (instruments.data ?? []).filter((i) => i.active);
  const [ pickedInstrument, setPickedInstrument ] = useState("");
  const instrumentId = pickedInstrument || (active.length === 1 ? active[0].id : "");
  const [ lotId, setLotId ] = useState("");
  const [ level, setLevel ] = useState("");
  const [ analyteKey, setAnalyteKey ] = useState("");
  const [ from, setFrom ] = useState(() => addDays(today, -30));
  const [ to, setTo ] = useState(today);
  const lot = (lots.data ?? []).find((l) => l.id === lotId);
  const material = (materials.data ?? []).find((m) => m.id === lot?.material_id);
  const ref = material?.analytes.find((a) => a.analyte_key === analyteKey);
  const datesOk = DAY.test(from) && DAY.test(to);
  const inverted = datesOk && from > to;
  const tooLong = datesOk && !inverted && span(from, to) > MAX_DAYS;
  const ready = instrumentId !== "" && lotId !== "" && level !== "" && analyteKey !== "" && datesOk && !inverted && !tooLong;
  const q: QcChartQuery = { lot_id: lotId, level, analyte_key: analyteKey, instrument_id: instrumentId, from, to };
  const chart = useQuery({
    queryKey: [ QC_CHART_KEY, q ], queryFn: () => getQcChart(q), enabled: ready, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false
  });
  const name = ref ? analyteName(exams.data ?? [], ref.lab_exam_id, analyteKey) : analyteKey;
  const instrumentName = (instruments.data ?? []).find((i) => i.id === instrumentId)?.name ?? "";

  return (
    <div style={stack}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>Aparelho
          <select value={instrumentId} style={inputStyle} onChange={(e) => setPickedInstrument(e.target.value)}>
            <option value="">—</option>
            {(instruments.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.active ? i.name : `${i.name} (inativo)`}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>Lote
          <select value={lotId} style={inputStyle} onChange={(e) => { setLotId(e.target.value); setLevel(""); setAnalyteKey(""); }}>
            <option value="">—</option>
            {(lots.data ?? []).map((l) => <option key={l.id} value={l.id}>{`${l.lot_number} · ${l.material_name}`}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>Nível
          <select value={level} style={inputStyle} onChange={(e) => setLevel(e.target.value)}>
            <option value="">—</option>
            {(material?.levels ?? []).map((lv) => <option key={lv} value={lv}>{lv}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>Analito
          <select value={analyteKey} style={inputStyle} onChange={(e) => setAnalyteKey(e.target.value)}>
            <option value="">—</option>
            {(material?.analytes ?? []).map((a) => <option key={a.analyte_key} value={a.analyte_key}>{analyteName(exams.data ?? [], a.lab_exam_id, a.analyte_key)}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>De<input type="date" value={from} max={today} style={inputStyle} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={fieldLabel}>Até<input type="date" value={to} max={today} style={inputStyle} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {inverted && <p role="alert" style={alert}>o início do período é depois do fim</p>}
      {tooLong && <p role="alert" style={alert}>{`o período vai até ${MAX_DAYS} dias`}</p>}
      {!datesOk && <p style={muted}>escolha as duas datas do período</p>}
      {datesOk && !ready && !inverted && !tooLong && <p style={muted}>escolha aparelho, lote, nível e analito</p>}
      {ready && (
        <Panel title="Gráfico" sub="até 200 pontos; passe o mouse para ver valor, z e a versão da referência">
          {chart.isError ? <p role="alert" style={alert}>{qcError(chart.error)}</p>
            : chart.isPending ? <p className="mono" style={muted}>carregando…</p>
            : <LeveyJennings chart={chart.data} label={`Levey-Jennings · ${name} · ${level} · lote ${lot?.lot_number ?? ""} · ${instrumentName}`} />}
        </Panel>
      )}
    </div>
  );
}
