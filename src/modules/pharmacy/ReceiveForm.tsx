// Recebimento da transferência na unidade (módulo 27a; F-27.3; contrato §5, H12): conferência lote a lote.
// "Recebido" começa EM BRANCO — a pessoa conta e digita; nunca vem pré-preenchido com o enviado. Recebido diferente do enviado pede o
// motivo (10 a 500 caracteres) e a transferência vira `received_with_difference`; a diferença volta como perda no destino (H5).
// Confere TODOS os lotes antes de enviar (receiveProblems); a recusa do api com `problems` mostra cada uma no lote dela (`items[i]` é o
// índice do corpo enviado = o i-ésimo lote da transferência). `already_received` e `not_found` não são da pessoa: fecham o formulário
// e a lista é relida (onStale). Nada em URL, log ou storage.
import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorCode, receiveTransfer, type StockTransfer } from "../../lib/api";
import {
  PH_POSITIONS_KEY, PH_TRANSFERS_KEY, cents, errorPath, fmtQuantity, pharmacyError, pharmacyProblems, problemItemIndex, quantityProblem,
  receiveBody, receiveProblems, toApiQuantity, transferStatusLabel, type ReceiveLine
} from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, title } from "../exams/styles";

export function receivedText(status: string): string {
  if (status === "received_with_difference") return "Recebida com diferença: a diferença entrou como perda, com o motivo.";
  if (status === "received") return "Recebida.";
  return `${transferStatusLabel(status)}.`;
}

type Shown = { key: string; text: string };
const STALE = new Set([ "already_received", "not_found" ]);

export function ReceiveForm({ transfer, onStart, onDone, onStale, onCancel }: {
  transfer: StockTransfer; onStart?(): void; onDone(t: StockTransfer): void; onStale(text: string): void; onCancel(): void;
}) {
  const queryClient = useQueryClient();
  const [ values, setValues ] = useState<Record<string, ReceiveLine>>({});
  const [ shown, setShown ] = useState<Shown[]>([]);
  const [ busy, setBusy ] = useState(false);

  const lineOf = (lotId: string): ReceiveLine => values[lotId] ?? { lotId, received: "", reason: "" };
  const patch = (lotId: string, over: Partial<ReceiveLine>) => setValues((cur) => ({ ...cur, [lotId]: { ...lineOf(lotId), ...over } }));
  const differs = (lotId: string, sent: string): boolean => {
    const l = lineOf(lotId);
    return quantityProblem(l.received, "a quantidade recebida", { allowZero: true }) === null && cents(toApiQuantity(l.received)) !== cents(sent);
  };
  const flagged = new Set(shown.map((s) => s.key));
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: [ PH_TRANSFERS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
  };

  function fromApi(err: unknown): Shown[] {
    const list = pharmacyProblems(err);
    const raw = list.length > 0 ? list : [ { path: errorPath(err) ?? "", text: pharmacyError(err) } ];
    return raw.map((p) => {
      const i = problemItemIndex(p.path);
      const item = i === null ? undefined : transfer.items[i];
      return item ? { key: item.lot.id, text: `${item.lot.lot_number}: ${p.text}` } : { key: p.path, text: p.text };
    });
  }

  async function submit() {
    if (busy) return;
    onStart?.();
    // O motivo só vale onde há diferença: o que sobrou de uma conferência corrigida não vai.
    const lines = transfer.items.map((it) => {
      const l = lineOf(it.lot.id);
      return differs(it.lot.id, it.quantity) ? l : { ...l, reason: "" };
    });
    const local = receiveProblems(lines, transfer);
    if (local.length > 0) { setShown(local.map((p) => ({ key: p.path, text: p.text }))); return; }
    setShown([]); setBusy(true);
    try {
      const result = await receiveTransfer(transfer.id, receiveBody(lines));
      reread();
      onDone(result);
    } catch (err) {
      reread();
      if (STALE.has(errorCode(err) ?? "")) onStale(pharmacyError(err));
      else setShown(fromApi(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label={`Recebimento da transferência de ${transfer.from.name}`} style={{ ...box, gap: 12 }}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3 style={title}>{`Receber de ${transfer.from.name}`}</h3>
      <p style={muted}>Conte o que chegou, lote a lote, e digite o que contou. Se for diferente do enviado, escreva o motivo.</p>
      {transfer.items.map((it) => {
        const id = it.lot.id; const lotNumber = it.lot.lot_number; const unit = it.lot.item.dispensing_unit;
        const sent = fmtQuantity(it.quantity);
        const l = lineOf(id);
        return (
          <div key={id} style={{ ...box, background: "var(--panel)", ...(flagged.has(id) ? flaggedStyle : null) }}>
            <strong>{it.lot.item.name}</strong>
            <small className="mono" style={muted}>{`lote ${lotNumber} · enviado ${sent} ${unit}`}</small>
            <div style={row}>
              <label style={fieldLabel}>
                {`Recebido (${unit})`}
                <input value={l.received} inputMode="decimal" style={inputStyle} disabled={busy} aria-label={`Recebido do lote ${lotNumber} (enviado ${sent})`}
                  onChange={(e) => patch(id, { received: e.target.value })} />
              </label>
              {differs(id, it.quantity) && (
                <label style={{ ...fieldLabel, flex: "1 1 24ch" }}>
                  Motivo da diferença
                  <input value={l.reason} style={inputStyle} disabled={busy} aria-label={`Motivo da diferença do lote ${lotNumber}`}
                    onChange={(e) => patch(id, { reason: e.target.value })} />
                </label>
              )}
            </div>
          </div>
        );
      })}
      {shown.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{shown.map((s, i) => <li key={`${s.key}-${i}`}>{s.text}</li>)}</ul>
        </div>
      )}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Confirmar recebimento</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

const flaggedStyle: CSSProperties = { borderColor: "var(--down)" };
