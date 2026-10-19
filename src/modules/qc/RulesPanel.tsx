// Regras de Westgard por aparelho e analito (spec §4 "lab_qc_rules"; contrato
// §3): ausente = padrão (todas ligadas). Salvar passa por step-up (C-E39).
// Mudar é só do RT/substituto (C-E4: nem o admin); os outros só leem.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QC_RULES, getQcRules, listLabInstruments, listQcMaterials, saveQcRules, type LabExamRef, type QcRule, type QcRuleSet } from "../../lib/api";
import { QC_INSTRUMENTS_KEY, QC_MATERIALS_KEY, QC_RULES_KEY, RT_ONLY, analyteName, qcError, refreshQc, ruleLabel, rulesProblem, staleAware } from "../../lib/qc";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, okText, row, stack } from "../exams/styles";

export function RulesPanel({ providerId, lead, exams, onGoToSecurity }: { providerId: string; lead: boolean; exams: LabExamRef[]; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const materials = useQuery({ queryKey: [ QC_MATERIALS_KEY, providerId ], queryFn: () => listQcMaterials(providerId), retry: false });
  const instruments = useQuery({ queryKey: [ QC_INSTRUMENTS_KEY, providerId, "lab" ], queryFn: () => listLabInstruments(providerId), retry: false });
  const [ instrumentId, setInstrumentId ] = useState("");
  const [ analyteKey, setAnalyteKey ] = useState("");
  const [ notice, setNotice ] = useState<string | null>(null);
  const analytes = [ ...new Map((materials.data ?? []).flatMap((m) => m.analytes).map((a) => [ a.analyte_key, a ])).values() ];
  const rules = useQuery({
    queryKey: [ QC_RULES_KEY, instrumentId, analyteKey ], queryFn: () => getQcRules(instrumentId, analyteKey),
    enabled: instrumentId !== "" && analyteKey !== "", retry: false
  });

  return (
    <Panel title="Regras de Westgard" sub="por aparelho e analito; 1-2s só avisa, as outras reprovam a corrida e bloqueiam a liberação">
      <div style={stack}>
        <div style={row}>
          <label style={fieldLabel}>Aparelho
            <select value={instrumentId} style={inputStyle} onChange={(e) => { setInstrumentId(e.target.value); setNotice(null); }}>
              <option value="">—</option>
              {(instruments.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>Analito
            <select value={analyteKey} style={inputStyle} onChange={(e) => { setAnalyteKey(e.target.value); setNotice(null); }}>
              <option value="">—</option>
              {analytes.map((a) => <option key={a.analyte_key} value={a.analyte_key}>{analyteName(exams, a.lab_exam_id, a.analyte_key)}</option>)}
            </select>
          </label>
        </div>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {rules.isError && <p role="alert" style={alert}>{qcError(rules.error)}</p>}
        {rules.data && (
          <RulesForm key={`${instrumentId}:${analyteKey}:${rules.dataUpdatedAt}`} set={rules.data} lead={lead} onGoToSecurity={onGoToSecurity}
            onSaved={() => { setNotice("Regras salvas."); void refreshQc(queryClient).catch(() => undefined); }}
            onStale={() => { void refreshQc(queryClient).catch(() => undefined); }} />
        )}
      </div>
    </Panel>
  );
}

function RulesForm({ set, lead, onSaved, onStale, onGoToSecurity }: {
  set: QcRuleSet; lead: boolean; onSaved(): void; onStale(): void; onGoToSecurity?(): void;
}) {
  const [ after, setAfter ] = useState<Record<QcRule, boolean>>({ ...set.rules });
  const [ justification, setJustification ] = useState("");
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  function review() {
    const problem = rulesProblem(set.rules, after, justification);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  const failed = staleAware([ "not_found", "invalid_transition" ], () => onStale());

  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Regras ligadas</legend>
      <p style={muted}>
        {set.is_default
          ? "padrão: todas as regras ligadas"
          : `alteradas${set.changed_by ? ` por ${set.changed_by}` : ""} em ${fmtDateTime(set.changed_at)}${set.justification ? ` — ${set.justification}` : ""}`}
      </p>
      <fieldset disabled={confirming} style={{ ...fieldset, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={row}>
          {QC_RULES.map((r) => (
            <label key={r} style={checkLabel}>
              <input type="checkbox" disabled={!lead} checked={after[r]} onChange={(e) => setAfter((a) => ({ ...a, [r]: e.target.checked }))} />{ruleLabel(r)}
            </label>
          ))}
        </div>
        {lead && (
          <label style={fieldLabel}>Justificativa
            <textarea value={justification} rows={2} style={inputStyle} onChange={(e) => setJustification(e.target.value)} />
          </label>
        )}
      </fieldset>
      {lead ? (
        <>
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && <div><button type="button" style={buttonStyle} onClick={review}>Revisar e salvar regras</button></div>}
          {confirming && (
            <SensitiveAction title="Salvar regras" description="Valem para os valores de controle lançados daqui em diante neste aparelho e analito."
              requiresStepUp confirmLabel="Salvar regras"
              run={async () => { await saveQcRules({ instrument_id: set.instrument_id, analyte_key: set.analyte_key, rules: after, justification: justification.trim() }); }}
              onDone={() => { setConfirming(false); onSaved(); }}
              onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={failed} />
          )}
        </>
      ) : <p style={muted}>{RT_ONLY}</p>}
    </fieldset>
  );
}
