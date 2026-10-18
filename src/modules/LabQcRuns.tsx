// src/modules/LabQcRuns.tsx
// Corridas do dia por aparelho (spec §5.2–§5.3; contrato §3): valores
// digitados ou vindos do aparelho (HL7), com z, regras e desfecho que o api
// calculou na gravação. A corrida do dia é a última do aparelho e abre sozinha
// no primeiro valor; uma nova abre a pedido ou depois de uma reprovada (C-E18).
// Leitura ao abrir e depois de cada gravação — nenhuma releitura automática
// (gravam trilha). Sem step-up: rotina (C-E39).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listLabExams, listLabInstruments, listQcLots, listQcMaterials, listQcRuns, openQcRun, type QcValueResult } from "../lib/api";
import {
  QC_BLOCK_COUNT_KEY, QC_DISABLED, QC_EXAMS_KEY, QC_INSTRUMENTS_KEY, QC_LOTS_KEY, QC_MATERIALS_KEY, QC_RUNS_KEY, analyteName, qcError, rulesText, runStatusLabel
} from "../lib/qc";
import { todayInCity } from "../lib/campaigns";
import { Panel } from "../components/Panel";
import { ActionButton } from "../components/ActionButton";
import { inputStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { QcValueForm } from "./qc/QcValueForm";
import { QcRunCard } from "./qc/QcRunCard";
import { alert, fieldLabel, muted, okText, row, stack } from "./exams/styles";

export function LabQcRuns() {
  return (
    <LabGate title="Corridas de controle" sub="CIQ · valores do dia por aparelho, digitados ou vindos do aparelho"
      allow={(r) => r.staff || r.releaser} requires={[ "lab_quality_control" ]} disabledText={QC_DISABLED}>
      {() => <LabPick>{(lab) => <RunsBody providerId={lab.id} />}</LabPick>}
    </LabGate>
  );
}

const READ_ONCE = { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
const NOTICE = "A corrida aprovou, mas o bloqueio continua aberto: falta registrar a ação corretiva em Bloqueios e revisões do CIQ.";

function RunsBody({ providerId }: { providerId: string }) {
  const queryClient = useQueryClient();
  const today = todayInCity();
  const instruments = useQuery({ queryKey: [ QC_INSTRUMENTS_KEY, providerId, "lab" ], queryFn: () => listLabInstruments(providerId), retry: false });
  const exams = useQuery({ queryKey: [ QC_EXAMS_KEY, providerId ], queryFn: () => listLabExams(providerId), retry: false });
  const lots = useQuery({ queryKey: [ QC_LOTS_KEY, providerId, "in_use" ], queryFn: () => listQcLots({ providerId, status: "in_use" }), retry: false });
  const materials = useQuery({ queryKey: [ QC_MATERIALS_KEY, providerId ], queryFn: () => listQcMaterials(providerId), retry: false });
  const active = (instruments.data ?? []).filter((i) => i.active);
  const [ picked, setPicked ] = useState("");
  const instrumentId = picked || (active.length === 1 ? active[0].id : "");
  const instrument = active.find((i) => i.id === instrumentId);
  const [ date, setDate ] = useState(today);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const runs = useQuery({
    queryKey: [ QC_RUNS_KEY, instrumentId, date ], queryFn: () => listQcRuns(instrumentId, date), enabled: instrumentId !== "" && validDate,
    gcTime: 0, staleTime: 0, ...READ_ONCE
  });
  const [ runId, setRunId ] = useState<string | null>(null);
  const [ last, setLast ] = useState<QcValueResult[]>([]);
  const [ newRunNext, setNewRunNext ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const examList = exams.data ?? [];
  const materialList = materials.data ?? [];
  const analyte = (key: string) => {
    const ref = materialList.flatMap((m) => m.analytes).find((a) => a.analyte_key === key);
    return ref ? analyteName(examList, ref.lab_exam_id, key) : key;
  };

  function reset() { setRunId(null); setLast([]); setNewRunNext(false); setError(null); }

  async function openRun() {
    setError(null);
    try {
      const run = await openQcRun(instrumentId);
      setRunId(run.id);
      setNewRunNext(false);
      void runs.refetch();
    } catch (err) {
      setError(qcError(err));
    }
  }

  function recorded(results: QcValueResult[]) {
    setLast(results);
    if (results.some((r) => r.run.status === "rejected")) { setRunId(null); setNewRunNext(true); }
    void runs.refetch();
    void queryClient.invalidateQueries({ queryKey: [ QC_BLOCK_COUNT_KEY ] }).catch(() => undefined);
  }

  // O api devolve o bloqueio ativo em todo valor não reprovado e o recém-fechado no valor que o fecha:
  // "reprovada" vem do desfecho do PRÓPRIO valor, nunca da presença do bloqueio.
  const rejected = last.find((r) => r.value.outcome === "reject");
  const closed = last.find((r) => r.block?.closed_at);
  const stillOpen = last.find((r) => r.block && !r.block.closed_at && r.value.outcome !== "reject");
  const lastRun = last.length > 0 ? last[last.length - 1].run : null;
  const notice = last.some((r) => r.notice === "corrective_action_required");

  return (
    <div style={stack}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>Aparelho
          <select value={instrumentId} style={inputStyle} onChange={(e) => { setPicked(e.target.value); reset(); }}>
            <option value="">—</option>
            {active.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>Dia<input type="date" value={date} max={today} style={inputStyle} onChange={(e) => { setDate(e.target.value); reset(); }} /></label>
        {instrumentId && date === today && <ActionButton variant="secondary" onClick={openRun}>Abrir corrida nova</ActionButton>}
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
      {!instrumentId && <p style={muted}>escolha o aparelho para ver as corridas</p>}
      {rejected && (
        <p role="alert" aria-label="corrida reprovada" style={alert}>
          {`Corrida reprovada (${rulesText(rejected.value.rules_fired)}): bloqueio aberto para ${analyte(rejected.value.analyte_key)} no ${instrument?.name ?? "aparelho"}. A liberação desse analito fica presa até a ação corretiva e uma corrida aprovada com todos os níveis.`}
        </p>
      )}
      {newRunNext && <p role="status" style={muted}>O próximo valor abre uma corrida nova.</p>}
      {notice && <p role="status" aria-label="ação corretiva pendente" style={alert}>{NOTICE}</p>}
      {!rejected && !notice && stillOpen?.block && (
        <p role="status" aria-label="bloqueio ainda aberto" style={alert}>{`O bloqueio de ${analyte(stillOpen.block.analyte_key)} continua aberto: falta uma corrida aprovada com todos os níveis depois da ação corretiva.`}</p>
      )}
      {closed?.block && <p role="status" aria-label="bloqueio encerrado" style={okText}>{`Bloqueio encerrado para ${analyte(closed.block.analyte_key)}.`}</p>}
      {!rejected && lastRun && <p role="status" style={okText}>{`Valores gravados · corrida ${runStatusLabel(lastRun.status)}.`}</p>}
      {instrumentId && date === today && (
        <QcValueForm instrumentId={instrumentId} runId={runId} lots={lots.data ?? []} materials={materialList} exams={examList}
          onRecorded={recorded} onStart={() => setLast([])}
          onRunEnded={() => { setRunId(null); setNewRunNext(true); void runs.refetch(); }}
          onStale={() => { void runs.refetch(); void lots.refetch(); void materials.refetch(); }} />
      )}
      {instrumentId && (
        <Panel title="Corridas do dia" sub={runId ? "corrida nova aberta — os próximos valores vão nela" : "a corrida do dia é a última do aparelho; abre sozinha no primeiro valor"}>
          {runs.isError ? <p role="alert" style={alert}>{qcError(runs.error)}</p>
            : runs.isPending ? <p className="mono" style={muted}>carregando…</p>
            : (runs.data ?? []).length === 0 ? <p style={muted}>nenhuma corrida neste dia</p>
            : <div style={stack}>{(runs.data ?? []).map((run) => <QcRunCard key={run.id} run={run} analyte={analyte} />)}</div>}
        </Panel>
      )}
    </div>
  );
}
