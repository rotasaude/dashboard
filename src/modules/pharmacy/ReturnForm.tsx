// Devolução de parte de um item já dispensado (módulo 27a; F-27.5, acréscimo da coordenação; contrato H12). Vive no histórico de
// retiradas: o paciente devolve em condições de uso e o saldo volta ao MESMO lote da retirada. Quantidade (vírgula na tela, ponto no
// corpo) até o que resta devolver e motivo de 10 a 500 caracteres. Sem step-up (como a dispensação; a spec só põe segundo fator no
// ajuste de inventário): a conferência local vem antes e "Registrar devolução" chama o api direto. A resposta (201) é a dispensação
// inteira, atualizada; quem chamou troca o item na lista. A recusa do api fica na tela e o digitado não se perde. Nada em URL,
// log ou storage.
import { useState } from "react";
import { errorCode, recordReturn, type Dispensation, type DispensedItem } from "../../lib/api";
import { RETURN_LOT_EXPIRED, fmtQuantity, pharmacyError, returnBody, returnProblems, returnRemaining, type ReturnDraft } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, title } from "../exams/styles";
import { fmtDay } from "../../lib/exams";

const EMPTY: ReturnDraft = { quantity: "", reason: "" };

export function ReturnForm({ dispensation, item, onDone, onCancel }: {
  dispensation: Dispensation; item: DispensedItem; onDone(updated: Dispensation): void; onCancel(): void;
}) {
  const [ draft, setDraft ] = useState<ReturnDraft>(EMPTY);
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ busy, setBusy ] = useState(false);
  const unit = item.item.dispensing_unit;

  const patch = (over: Partial<ReturnDraft>) => { setProblems([]); setDraft((cur) => ({ ...cur, ...over })); };

  async function submit() {
    if (busy) return;
    const found = returnProblems(draft, item);
    setProblems(found);
    if (found.length > 0) return;
    setBusy(true);
    try {
      onDone(await recordReturn(returnBody(draft, item, dispensation.location.id)));
    } catch (err) {
      setProblems([ errorCode(err) === "lot_expired" ? RETURN_LOT_EXPIRED : pharmacyError(err) ]);
      setBusy(false);
    }
  }

  return (
    <form aria-label="Registrar devolução" style={{ ...box, background: "var(--panel)", maxWidth: 720 }} noValidate
      onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3 style={title}>{`Devolução: ${item.item.name}`}</h3>
      <small className="mono" style={muted}>
        {`lote ${item.lot.lot_number} · vence ${fmtDay(item.lot.expires_on)} · dispensado ${fmtQuantity(item.quantity)} · já devolvido ${fmtQuantity(item.returned_total)}`}
      </small>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={fieldLabel}>
          {`Quantidade a devolver (${unit}) — até ${fmtQuantity(String(returnRemaining(item) / 100))}`}
          <input value={draft.quantity} inputMode="decimal" style={inputStyle} autoComplete="off" aria-label="Quantidade a devolver"
            onChange={(e) => patch({ quantity: e.target.value })} />
        </label>
        <label style={fieldLabel}>
          Motivo da devolução
          <textarea value={draft.reason} rows={2} style={inputStyle} onChange={(e) => patch({ reason: e.target.value })} />
        </label>
      </fieldset>
      {problems.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div style={row}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Registrar devolução</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
