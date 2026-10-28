// src/modules/regulation/NurseItemForm.tsx
// Acrescenta um item à lista do que o enfermeiro pode pedir (módulo 26a; F-26.1; contrato §6, G5). O alvo vem da busca pelo nome,
// SEM `cbo`: a busca da lista não é filtrada pela própria lista do enfermeiro. A escrita passa pelo step-up; o duplicado (409
// `duplicate_item`) fica à vista, junto do formulário parado.
import { useState } from "react";
import { addNurseItem } from "../../lib/api";
import type { RegulationTarget, RegulationType } from "../../lib/api";
import { regulationError, typeLabel } from "../../lib/regulation";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, form, legend, row } from "../exams/styles";
import { TargetSearch } from "./TargetSearch";
import { fieldsetStyle } from "./styles";

const TYPES: RegulationType[] = [ "specialty", "procedure" ];
const TYPE_NAME: Record<RegulationType, string> = { specialty: "Especialidade", procedure: "Procedimento" };

export function NurseItemForm({ onSaved, onCancel, onGoToSecurity }: { onSaved(message: string): void; onCancel(): void; onGoToSecurity?(): void }) {
  const [ type, setType ] = useState<RegulationType>("specialty");
  const [ target, setTarget ] = useState<RegulationTarget | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);

  function review() {
    if (!target) { setError("escolha a especialidade ou o procedimento"); return; }
    setConfirming(true);
  }

  return (
    <section aria-label="Acrescentar item à lista do enfermeiro" style={box}>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          <fieldset style={{ ...fieldsetStyle, display: "flex", gap: 16, flexWrap: "wrap" }}>
            <legend style={legend}>Tipo do alvo</legend>
            {TYPES.map((t) => (
              <label key={t} style={checkLabel}>
                <input type="radio" name="nurse-item-type" checked={type === t} onChange={() => { setError(null); setType(t); setTarget(null); }} />
                {TYPE_NAME[t]}
              </label>
            ))}
          </fieldset>
          {/* Sem `cbo`: a busca não é filtrada pela lista do enfermeiro. */}
          <TargetSearch key={type} type={type} onPick={(t) => { setError(null); setTarget(t); }} />
          {target && <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{`Alvo: ${target.code} — ${target.name}`}</p>}
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && (
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={review}>Revisar</button>
              <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
            </div>
          )}
        </div>
      </fieldset>
      {confirming && target && (
        <SensitiveAction
          title="Acrescentar à lista do enfermeiro"
          description={`${target.name} (${typeLabel(target.type)}) passa a poder ser pedido pelo enfermeiro.`}
          requiresStepUp
          confirmLabel="Confirmar"
          run={() => addNurseItem({ target_type: target.type, target_code: target.code }).then(() => undefined)}
          onDone={() => onSaved("Item acrescentado à lista do enfermeiro.")}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => regulationError(err)}
        />
      )}
    </section>
  );
}
