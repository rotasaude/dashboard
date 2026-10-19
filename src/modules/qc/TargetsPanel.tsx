// Referências do lote (spec §5.1 e §5.8; contrato §3): a da bula por nível,
// analito e aparelho; a sugestão do laboratório depois de 20 corridas
// aprovadas, aceita pelo RT/substituto. Cada troca é uma versão nova e pede
// motivo (spec §9; Divergência C6). Decimais com vírgula. Salvar a bula e
// aceitar passam por step-up (C-E39). Bula: admin ou RT/substituto; aceite:
// só o RT/substituto (C-E4).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptQcSuggestion, createQcTarget, getQcTargets, listLabInstruments, listQcLots, listQcMaterials, listQcSuggestions,
  type LabExamRef, type QcSuggestion, type QcTarget
} from "../../lib/api";
import {
  EMPTY_TARGET, QC_INSTRUMENTS_KEY, QC_LOTS_KEY, QC_MATERIALS_KEY, QC_SUGGESTIONS_KEY, QC_TARGETS_KEY, RT_ONLY, analyteName, fmtDecimal,
  qcError, reasonProblem, refreshQc, staleAware, targetBody, targetProblem, targetSourceLabel, type TargetDraft
} from "../../lib/qc";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, list, muted, okText, row, stack } from "../exams/styles";

const CLOSED_LOT = "lote encerrado: a referência não muda mais";
const RT_ONLY_SHORT = "só o RT ou o substituto";

export function TargetsPanel({ providerId, lotId, lead, admin = false, exams, onGoToSecurity }: {
  providerId: string; lotId: string; lead: boolean; admin?: boolean; exams: LabExamRef[]; onGoToSecurity?(): void;
}) {
  const queryClient = useQueryClient();
  const lots = useQuery({ queryKey: [ QC_LOTS_KEY, providerId ], queryFn: () => listQcLots({ providerId }), retry: false });
  const materials = useQuery({ queryKey: [ QC_MATERIALS_KEY, providerId ], queryFn: () => listQcMaterials(providerId), retry: false });
  const instruments = useQuery({ queryKey: [ QC_INSTRUMENTS_KEY, providerId, "lab" ], queryFn: () => listLabInstruments(providerId), retry: false });
  const targets = useQuery({ queryKey: [ QC_TARGETS_KEY, lotId ], queryFn: () => getQcTargets(lotId), retry: false });
  const suggestions = useQuery({ queryKey: [ QC_SUGGESTIONS_KEY, providerId ], queryFn: () => listQcSuggestions(providerId), retry: false });
  const [ draft, setDraft ] = useState<TargetDraft>(EMPTY_TARGET);
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ accepting, setAccepting ] = useState<QcSuggestion | null>(null);
  const [ acceptConfirming, setAcceptConfirming ] = useState(false);
  const [ reason, setReason ] = useState("");
  const [ acceptError, setAcceptError ] = useState<string | null>(null);

  const lot = (lots.data ?? []).find((l) => l.id === lotId);
  const material = (materials.data ?? []).find((m) => m.id === lot?.material_id);
  const levels = material?.levels ?? [];
  const analytes = material?.analytes ?? [];
  const instName = (id: string) => (instruments.data ?? []).find((i) => i.id === id)?.name ?? id;
  const anName = (key: string) => {
    const a = analytes.find((x) => x.analyte_key === key);
    return a ? analyteName(exams, a.lab_exam_id, key) : key;
  };
  const current = targets.data?.current ?? [];
  const replacing = current.some((t) => t.level === draft.level && t.analyte_key === draft.analyteKey && t.instrument_id === draft.instrumentId);
  const mine = (suggestions.data ?? []).filter((s) => s.lot_id === lotId);
  const set = (patch: Partial<TargetDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const closed = lot?.status === "closed";
  const canSet = (lead || admin) && !closed;
  const canAccept = lead && !closed;
  const refresh = () => { void refreshQc(queryClient).catch(() => undefined); };
  // 404/409: a frase diz que a tela foi atualizada, então relê de fato.
  const failed = staleAware([ "not_found", "invalid_transition" ], refresh);

  function review() {
    const problem = targetProblem(draft, replacing);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  function reviewAccept() {
    const problem = reasonProblem(reason, "o motivo do aceite");
    if (problem) { setAcceptError(problem); return; }
    setAcceptError(null);
    setAcceptConfirming(true);
  }

  const targetLine = (t: QcTarget) =>
    `v${t.version} · ${t.level} · ${anName(t.analyte_key)} · ${instName(t.instrument_id)} · ${targetSourceLabel(t.source)} · média ${fmtDecimal(t.mean)} · dp ${fmtDecimal(t.sd)}${t.accepted_by ? ` · ${t.accepted_by}` : ""} · ${fmtDateTime(t.accepted_at)}`;

  return (
    <Panel title={`Referências do lote ${lot?.lot_number ?? ""}`.trim()} sub="média e desvio-padrão por nível, analito e aparelho; cada troca é uma versão nova">
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {targets.isError ? <p role="alert" style={alert}>{qcError(targets.error)}</p> : (
          <DataTable<QcTarget>
            cols={[
              { label: "Nível", w: "0.8fr", card: "title", render: (t) => t.level },
              { label: "Analito", w: "1.3fr", render: (t) => anName(t.analyte_key) },
              { label: "Aparelho", w: "1fr", render: (t) => instName(t.instrument_id) },
              { label: "Versão", w: "0.8fr", render: (t) => `v${t.version} · ${targetSourceLabel(t.source)}` },
              { label: "Média", w: "0.7fr", align: "right", render: (t) => fmtDecimal(t.mean) },
              { label: "DP", w: "0.6fr", align: "right", render: (t) => fmtDecimal(t.sd) }
            ]}
            rows={current} rowKey={(t) => t.id} empty={targets.isPending ? "carregando…" : "nenhuma referência — cadastre a da bula"}
          />
        )}
        {(targets.data?.history ?? []).length > 0 && (
          <ul aria-label="histórico das referências" style={list}>
            {(targets.data?.history ?? []).map((t) => <li key={t.id}>{targetLine(t)}</li>)}
          </ul>
        )}
        {canSet ? (
          <fieldset role="group" aria-label="Referência da bula" style={fieldset}>
            <legend style={legend}>Referência da bula</legend>
            <fieldset disabled={confirming} style={{ ...fieldset, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <div style={row}>
                <label style={fieldLabel}>Nível
                  <select value={draft.level} style={inputStyle} onChange={(e) => set({ level: e.target.value })}>
                    <option value="">—</option>
                    {levels.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <label style={fieldLabel}>Analito
                  <select value={draft.analyteKey} style={inputStyle} onChange={(e) => set({ analyteKey: e.target.value })}>
                    <option value="">—</option>
                    {analytes.map((a) => <option key={a.analyte_key} value={a.analyte_key}>{analyteName(exams, a.lab_exam_id, a.analyte_key)}</option>)}
                  </select>
                </label>
                <label style={fieldLabel}>Aparelho
                  <select value={draft.instrumentId} style={inputStyle} onChange={(e) => set({ instrumentId: e.target.value })}>
                    <option value="">—</option>
                    {(instruments.data ?? []).filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </label>
                <label style={fieldLabel}>Média<input value={draft.mean} inputMode="decimal" autoComplete="off" style={inputStyle} onChange={(e) => set({ mean: e.target.value })} /></label>
                <label style={fieldLabel}>Desvio-padrão<input value={draft.sd} inputMode="decimal" autoComplete="off" style={inputStyle} onChange={(e) => set({ sd: e.target.value })} /></label>
              </div>
              {replacing && (
                <label style={fieldLabel}>Motivo da troca
                  <textarea value={draft.reason} rows={2} style={inputStyle} onChange={(e) => set({ reason: e.target.value })} />
                </label>
              )}
            </fieldset>
            {error && <p role="alert" style={alert}>{error}</p>}
            {!confirming && <div><button type="button" style={buttonStyle} onClick={review}>Revisar e salvar referência</button></div>}
            {confirming && (
              <SensitiveAction title="Salvar referência da bula"
                description="Vira a referência vigente deste nível, analito e aparelho para as próximas corridas; a anterior fica no histórico."
                requiresStepUp confirmLabel="Salvar referência da bula"
                run={async () => { await createQcTarget(targetBody(draft, lotId, replacing)); }}
                onDone={() => { setConfirming(false); setDraft(EMPTY_TARGET); setNotice("Referência da bula salva."); refresh(); }}
                onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={failed} />
            )}
          </fieldset>
        ) : <p style={muted}>{closed ? CLOSED_LOT : RT_ONLY}</p>}
        <fieldset role="group" aria-label="Sugestões do laboratório" style={fieldset}>
          <legend style={legend}>Sugestões do laboratório</legend>
          <p style={muted}>calculadas pelo sistema com 20 corridas aprovadas no lote; o RT aceita e vira a referência vigente</p>
          <DataTable<QcSuggestion>
            cols={[
              { label: "Nível · analito", w: "1.4fr", card: "title", render: (s) => `${s.level} · ${anName(s.analyte_key)}` },
              { label: "Aparelho", w: "1fr", render: (s) => instName(s.instrument_id) },
              { label: "Média · dp", w: "1fr", render: (s) => `${fmtDecimal(s.mean)} · ${fmtDecimal(s.sd)}` },
              { label: "Base", w: "1fr", render: (s) => `${s.runs} corridas aprovadas` },
              { label: "", w: "auto", card: "actions", render: (s) => (canAccept ? (
                <button type="button" style={secondaryButtonStyle} title={`${s.level} · ${s.analyte_key}`}
                  onClick={() => { setAccepting(s); setAcceptConfirming(false); setReason(""); setAcceptError(null); setNotice(null); }}>Aceitar</button>
              ) : null) }
            ]}
            rows={mine} rowKey={(s) => `${s.level}:${s.analyte_key}:${s.instrument_id}`} empty={suggestions.isPending ? "carregando…" : "nenhuma sugestão para este lote"}
          />
          {!canAccept && mine.length > 0 && <p style={muted}>{closed ? CLOSED_LOT : `aceitar sugestão: ${RT_ONLY_SHORT}`}</p>}
          {accepting && (
            <div style={stack}>
              <label style={fieldLabel}>Motivo do aceite
                <textarea value={reason} rows={2} disabled={acceptConfirming} style={inputStyle} onChange={(e) => setReason(e.target.value)} />
              </label>
              {acceptError && <p role="alert" style={alert}>{acceptError}</p>}
              {!acceptConfirming && (
                <div style={row}>
                  <button type="button" style={buttonStyle} onClick={reviewAccept}>Revisar aceite</button>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setAccepting(null)}>Cancelar</button>
                </div>
              )}
              {acceptConfirming && (
                <SensitiveAction title="Aceitar a sugestão do laboratório"
                  description="A média e o desvio-padrão calculados passam a ser a referência vigente deste nível, analito e aparelho."
                  requiresStepUp confirmLabel="Confirmar aceite"
                  run={async () => {
                    await acceptQcSuggestion({
                      lot_id: accepting.lot_id, level: accepting.level, analyte_key: accepting.analyte_key, instrument_id: accepting.instrument_id, reason: reason.trim()
                    });
                  }}
                  onDone={() => { setAccepting(null); setAcceptConfirming(false); setReason(""); setNotice("Referência do laboratório aceita — vale para as próximas corridas."); refresh(); }}
                  onCancel={() => setAcceptConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={failed} />
              )}
            </div>
          )}
        </fieldset>
      </div>
    </Panel>
  );
}
