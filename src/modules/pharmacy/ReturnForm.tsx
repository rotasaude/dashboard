// Devolução de parte de um item já dispensado (módulo 27a; F-27.5, acréscimo da coordenação; contrato H12). Vive no histórico de
// retiradas: o paciente devolve em condições de uso e o saldo volta ao MESMO lote da retirada. Quantidade (vírgula na tela, ponto no
// corpo) até o que resta devolver e motivo de 10 a 500 caracteres. "Revisar devolução" confere tudo de uma vez ANTES de abrir o
// SensitiveAction (step-up): motivo curto ou quantidade a mais nunca consomem o código do autenticador. A resposta (201) é a
// dispensação inteira, atualizada; quem chamou troca o item na lista. Nada em URL, log ou storage.
import { useRef, useState } from "react";
import { errorCode, recordReturn, type Dispensation, type DispensedItem } from "../../lib/api";
import { RETURN_LOT_EXPIRED, fmtQuantity, pharmacyError, returnBody, returnProblems, returnRemaining, toApiQuantity, type ReturnDraft } from "../../lib/pharmacy";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, title } from "../exams/styles";
import { fmtDay } from "../../lib/exams";

const EMPTY: ReturnDraft = { quantity: "", reason: "" };

export function ReturnForm({ dispensation, item, onDone, onCancel, onGoToSecurity }: {
  dispensation: Dispensation; item: DispensedItem; onDone(updated: Dispensation): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const [ draft, setDraft ] = useState<ReturnDraft>(EMPTY);
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ review, setReview ] = useState<ReturnDraft | null>(null);
  // Na ref: o `onDone` do SensitiveAction roda logo depois do `run`, antes de um novo render.
  const saved = useRef<Dispensation | null>(null);
  const unit = item.item.dispensing_unit;
  const locked = review !== null;

  const patch = (over: Partial<ReturnDraft>) => { setProblems([]); setDraft((cur) => ({ ...cur, ...over })); };
  function startReview() {
    const found = returnProblems(draft, item);
    setProblems(found);
    if (found.length === 0) setReview(draft);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <form aria-label="Registrar devolução" style={{ ...box, background: "var(--panel)" }} noValidate
        onSubmit={(e) => { e.preventDefault(); if (!locked) startReview(); }}>
        <h3 style={title}>{`Devolução: ${item.item.name}`}</h3>
        <small className="mono" style={muted}>
          {`lote ${item.lot.lot_number} · vence ${fmtDay(item.lot.expires_on)} · dispensado ${fmtQuantity(item.quantity)} · já devolvido ${fmtQuantity(item.returned_total)}`}
        </small>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
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
        {!review && (
          <div style={row}>
            <button type="submit" style={buttonStyle}>Revisar devolução</button>
            <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
          </div>
        )}
      </form>

      {/* O step-up fica FORA do <form> dos campos: o SensitiveAction tem o <form> dele (nada de form dentro de form). */}
      {review && (
        <SensitiveAction
          title="Confirmar a devolução"
          description={`Devolve ${fmtQuantity(toApiQuantity(review.quantity))} ${unit} ao lote ${item.lot.lot_number}, em seu nome; o registro não se edita.`}
          requiresStepUp
          confirmLabel="Registrar devolução"
          run={async () => { saved.current = await recordReturn(returnBody(review, item, dispensation.location.id)); }}
          onDone={() => { if (saved.current) onDone(saved.current); else onCancel(); }}
          onCancel={() => setReview(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => (errorCode(err) === "lot_expired" ? RETURN_LOT_EXPIRED : pharmacyError(err))}
        />
      )}
    </div>
  );
}
