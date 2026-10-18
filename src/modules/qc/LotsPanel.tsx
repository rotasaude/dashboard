// Lotes de controle (contrato §3): número, validade e um código de barras por
// nível (únicos na cidade e distintos dos de amostra — o api confere,
// `barcode_taken`). O leitor é um teclado: Enter no campo do código não age.
// Criar e encerrar exigem step-up (C-E39). Código de barras nunca vai a
// console, log ou storage.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { closeQcLot, createQcLot, listQcLots, listQcMaterials, type QcLot } from "../../lib/api";
import { QC_LOTS_KEY, QC_MATERIALS_KEY, lotBody, lotProblem, lotStatusLabel, qcError, refreshQc, type LotDraft } from "../../lib/qc";
import { fmtDay } from "../../lib/exams";
import { todayInCity } from "../../lib/campaigns";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, okText, row, stack } from "../exams/styles";

const EMPTY_LOT: LotDraft = { materialId: "", lotNumber: "", expiresOn: "", barcodes: {} };

export function LotsPanel({ providerId, pickedId, onPick, onGoToSecurity }: {
  providerId: string; pickedId: string | null; onPick(lotId: string): void; onGoToSecurity?(): void;
}) {
  const queryClient = useQueryClient();
  const lots = useQuery({ queryKey: [ QC_LOTS_KEY, providerId ], queryFn: () => listQcLots({ providerId }), retry: false });
  const materials = useQuery({ queryKey: [ QC_MATERIALS_KEY, providerId ], queryFn: () => listQcMaterials(providerId), retry: false });
  const [ creating, setCreating ] = useState(false);
  const [ confirming, setConfirming ] = useState(false);
  const [ draft, setDraft ] = useState<LotDraft>(EMPTY_LOT);
  const [ closing, setClosing ] = useState<QcLot | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const material = (materials.data ?? []).find((m) => m.id === draft.materialId);
  const levels = material?.levels ?? [];
  const refresh = () => { void refreshQc(queryClient).catch(() => undefined); };

  function review() {
    const problem = lotProblem(draft, levels, todayInCity());
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  return (
    <Panel title="Lotes de controle" sub="um código de barras por nível; o aparelho manda o controle por esse código"
      right={<button type="button" style={secondaryButtonStyle} onClick={() => { setCreating(true); setConfirming(false); setClosing(null); setDraft(EMPTY_LOT); setError(null); setNotice(null); }}>Novo lote</button>}>
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {lots.isError ? <p role="alert" style={alert}>{qcError(lots.error)}</p> : (
          <DataTable<QcLot>
            cols={[
              { label: "Lote", w: "1fr", card: "title", render: (l) => <span className="mono">{l.lot_number}</span> },
              { label: "Material", w: "1.3fr", render: (l) => l.material_name },
              { label: "Validade", w: "0.8fr", render: (l) => fmtDay(l.expires_on) },
              { label: "Códigos por nível", w: "1.6fr", render: (l) => Object.entries(l.level_barcodes).map(([ lv, code ]) => `${lv}: ${code}`).join(" · ") },
              { label: "Situação", w: "0.7fr", render: (l) => <Tag tone={l.status === "in_use" ? "ok" : undefined}>{lotStatusLabel(l.status)}</Tag> },
              { label: "", w: "auto", card: "actions", render: (l) => (
                <div style={row}>
                  <button type="button" style={secondaryButtonStyle} aria-pressed={pickedId === l.id} onClick={() => onPick(l.id)}>Referências</button>
                  {l.status === "in_use" && (
                    <button type="button" style={secondaryButtonStyle} onClick={() => { setClosing(l); setCreating(false); setNotice(null); }}>Encerrar</button>
                  )}
                </div>
              ) }
            ]}
            rows={lots.data ?? []} rowKey={(l) => l.id} empty={lots.isPending ? "carregando…" : "nenhum lote cadastrado"}
          />
        )}
        {closing && (
          <SensitiveAction title={`Encerrar lote ${closing.lot_number}`}
            description="O lote deixa de receber valores de controle; os valores já lançados e as referências ficam guardados."
            requiresStepUp confirmLabel={`Confirmar encerramento de ${closing.lot_number}`}
            run={async () => { await closeQcLot(closing.id); }}
            onDone={() => { setNotice(`Lote ${closing.lot_number} encerrado.`); setClosing(null); refresh(); }}
            onCancel={() => setClosing(null)} onGoToSecurity={onGoToSecurity} translateError={(err) => qcError(err)} />
        )}
        {creating && (
          <section aria-label="Novo lote" style={box}>
            <fieldset disabled={confirming} style={{ ...form, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <label style={fieldLabel}>Material
                <select value={draft.materialId} style={inputStyle} onChange={(e) => setDraft((d) => ({ ...d, materialId: e.target.value, barcodes: {} }))}>
                  <option value="">—</option>
                  {(materials.data ?? []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>Número do lote<input value={draft.lotNumber} style={inputStyle} onChange={(e) => setDraft((d) => ({ ...d, lotNumber: e.target.value }))} /></label>
              <label style={fieldLabel}>Validade<input type="date" value={draft.expiresOn} style={inputStyle} onChange={(e) => setDraft((d) => ({ ...d, expiresOn: e.target.value }))} /></label>
              {levels.map((lv) => (
                <label key={lv} style={fieldLabel}>{`Código de barras — ${lv}`}
                  <input value={draft.barcodes[lv] ?? ""} autoComplete="off" style={inputStyle}
                    onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                    onChange={(e) => setDraft((d) => ({ ...d, barcodes: { ...d.barcodes, [lv]: e.target.value } }))} />
                </label>
              ))}
            </fieldset>
            {error && <p role="alert" style={alert}>{error}</p>}
            {!confirming && (
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar lote</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setCreating(false)}>Cancelar</button>
              </div>
            )}
            {confirming && (
              <SensitiveAction title="Salvar lote" description="O lote entra em uso; cada código de barras identifica o nível na mensagem do aparelho."
                requiresStepUp confirmLabel="Salvar lote"
                run={async () => { await createQcLot(lotBody(draft, levels)); }}
                onDone={() => { setConfirming(false); setCreating(false); setDraft(EMPTY_LOT); setNotice("Lote salvo — cadastre a referência da bula de cada nível."); refresh(); }}
                onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={(err) => qcError(err)} />
            )}
          </section>
        )}
      </div>
    </Panel>
  );
}
