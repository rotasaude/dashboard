// Digitação dos valores de controle de um lote e nível (contrato §3): um
// campo por analito do material, vírgula decimal (ponto recusado). Nada vai
// enquanto houver campo inválido; depois, um valor por vez, na ordem — o
// primeiro recusado marca o campo e para; os já gravados saem da tela, os
// não enviados ficam. Corrida reprovada (ou 409 invalid_transition) encerra a
// série e zera a corrida corrente: o próximo valor abre uma nova (C-E18).
// Rotina: sem step-up (C-E39). Valor nunca em log nem em storage.
import { useId, useState } from "react";
import { errorCode, recordQcValue, type LabExamRef, type QcLot, type QcMaterial, type QcValueResult } from "../../lib/api";
import { normalizeNumber } from "../../lib/lab";
import { analyteName, qcError, qcValueProblem } from "../../lib/qc";
import { Panel } from "../../components/Panel";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";

// Só aqui o 409 invalid_transition é da corrida (nas telas de cadastro é a frase genérica do 21b).
const RUN_REJECTED = "esta corrida já foi reprovada — o próximo valor abre uma corrida nova";

export function QcValueForm({ instrumentId, runId, lots, materials, exams, onRecorded, onRunEnded }: {
  instrumentId: string; runId: string | null; lots: QcLot[]; materials: QcMaterial[]; exams: LabExamRef[];
  onRecorded(results: QcValueResult[]): void; onRunEnded?(): void;
}) {
  const baseId = useId();
  const [ lotId, setLotId ] = useState("");
  const [ level, setLevel ] = useState("");
  const [ values, setValues ] = useState<Record<string, string>>({});
  const [ fieldErrors, setFieldErrors ] = useState<Record<string, string>>({});
  const [ error, setError ] = useState<string | null>(null);
  const usable = lots.filter((l) => !l.expired && l.status === "in_use");
  const lot = usable.find((l) => l.id === lotId);
  const material = materials.find((m) => m.id === lot?.material_id);

  async function save() {
    if (!lot || !material) { setError("escolha o lote"); return; }
    if (!level) { setError("escolha o nível"); return; }
    const entries = material.analytes.filter((a) => (values[a.analyte_key] ?? "").trim() !== "");
    if (entries.length === 0) { setError("digite ao menos um valor"); return; }
    const problems: Record<string, string> = {};
    for (const a of entries) {
      const p = qcValueProblem(values[a.analyte_key]);
      if (p) problems[a.analyte_key] = p;
    }
    setFieldErrors(problems);
    if (Object.keys(problems).length > 0) { setError("corrija os valores marcados"); return; }
    setError(null);
    const results: QcValueResult[] = [];
    let currentRun = runId;
    let ended = false;
    for (const a of entries) {
      try {
        const result = await recordQcValue({
          run_id: currentRun, instrument_id: instrumentId, lot_id: lot.id, level, analyte_key: a.analyte_key,
          value: normalizeNumber(values[a.analyte_key]) as string
        });
        results.push(result);
        setValues((v) => ({ ...v, [a.analyte_key]: "" }));
        if (result.run.status === "rejected") {
          ended = true;
          if (entries.length > results.length) setError("corrida reprovada; os valores seguintes não foram enviados");
          break;
        }
      } catch (err) {
        if (errorCode(err) === "invalid_transition") { ended = true; currentRun = null; }
        setFieldErrors({ [a.analyte_key]: errorCode(err) === "invalid_transition" ? RUN_REJECTED : qcError(err) });
        setError(results.length > 0 ? `${results.length} ${results.length === 1 ? "valor gravado" : "valores gravados"}; o seguinte foi recusado` : "o valor foi recusado");
        break;
      }
    }
    if (ended) onRunEnded?.();
    if (results.length > 0) onRecorded(results);
  }

  return (
    <Panel title="Digitar valores de controle" sub="um nível de um lote por vez; o aparelho também manda pela HL7">
        <div style={form}>
          <div style={row}>
            <label style={fieldLabel}>Lote
              <select value={lotId} style={inputStyle} onChange={(e) => { setLotId(e.target.value); setLevel(""); setValues({}); setFieldErrors({}); setError(null); }}>
                <option value="">—</option>
                {usable.map((l) => <option key={l.id} value={l.id}>{`${l.lot_number} · ${l.material_name}`}</option>)}
              </select>
            </label>
            <label style={fieldLabel}>Nível
              <select value={level} style={inputStyle} onChange={(e) => setLevel(e.target.value)}>
                <option value="">—</option>
                {(material?.levels ?? []).map((lv) => <option key={lv} value={lv}>{lv}</option>)}
              </select>
            </label>
          </div>
          {usable.length === 0 && <p style={muted}>nenhum lote de controle em uso e dentro da validade — cadastre em Controles e referências</p>}
          {material && material.analytes.map((a) => {
            const id = `${baseId}-${a.analyte_key}`;
            const name = analyteName(exams, a.lab_exam_id, a.analyte_key);
            return (
              <div key={`${a.lab_exam_id}:${a.analyte_key}`} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label htmlFor={id} style={fieldLabel}>{name}</label>
                <input id={id} value={values[a.analyte_key] ?? ""} inputMode="decimal" autoComplete="off" style={inputStyle}
                  aria-describedby={fieldErrors[a.analyte_key] ? `${id}-err` : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [a.analyte_key]: e.target.value }))} />
                {fieldErrors[a.analyte_key] && <p id={`${id}-err`} style={alert}>{fieldErrors[a.analyte_key]}</p>}
              </div>
            );
          })}
          {error && <p role="alert" style={alert}>{error}</p>}
          <div><ActionButton onClick={save}>Gravar valores</ActionButton></div>
        </div>
    </Panel>
  );
}
