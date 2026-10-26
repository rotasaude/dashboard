// src/modules/territory/HouseholdStatusForm.tsx
// Inativar / reativar o domicílio (contrato §4, L7; decisão da coordenadora):
// o PATCH do domicílio como está gravado, com `status`. Inativar só quando
// todas as famílias se mudaram ou não há família (o api recusa de novo:
// invalid_household em `status`). Cada confirmação é uma versão nova e uma
// ficha domiciliar; a tela diz isso antes. 409 stale_version: a frase e
// "Recarregar" relê o domicílio. Sem step-up (só microárea pede).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorCode, updateHousehold, type Household } from "../../lib/api";
import { HOUSEHOLDS_KEY, HOUSEHOLD_KEY, STALE_TEXT, errorPath, isStale, territoryError } from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, row } from "../exams/styles";
import { householdAsInput } from "./HouseholdForm";

export const HOUSEHOLD_INACTIVATED = "Domicílio inativado. Nova versão enviada ao e-SUS.";
export const HOUSEHOLD_REACTIVATED = "Domicílio reativado. Nova versão enviada ao e-SUS.";
const STILL_LIVING = "o domicílio ainda tem famílias morando — registre a mudança delas antes de inativar";

const TEXT = {
  inactive: {
    title: "Inativar domicílio", confirm: "Confirmar inativação", done: HOUSEHOLD_INACTIVATED,
    effect: "A ficha domiciliar vai ao e-SUS como inativa, numa versão nova. O domicílio deixa de receber moradores e famílias; dá para reativar depois."
  },
  active: {
    title: "Reativar domicílio", confirm: "Confirmar reativação", done: HOUSEHOLD_REACTIVATED,
    effect: "A ficha domiciliar volta ao e-SUS como ativa, numa versão nova. O domicílio volta a receber moradores e famílias."
  }
} as const;

// Só sem família morando (mudou-se em todas, ou nenhuma família).
export const canInactivate = (h: Household) => h.status === "active" && h.families.every((f) => f.moved_out);

export function HouseholdStatusForm({ household, onDone, onCancel }: { household: Household; onDone(text: string): void; onCancel(): void }) {
  const client = useQueryClient();
  const status = household.status === "active" ? "inactive" : "active";
  const text = TEXT[status];
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);
  const save = useMutation({
    mutationFn: () => updateHousehold(household.id, { ...householdAsInput(household), status }, household.version),
    onSuccess: (h) => {
      client.setQueryData([ HOUSEHOLD_KEY, h.id ], h);
      void client.invalidateQueries({ queryKey: [ HOUSEHOLDS_KEY ] });
      onDone(text.done);
    },
    onError: (err) => {
      if (isStale(err)) { setProblem(null); setStale(true); return; }
      setStale(false);
      setProblem(errorCode(err) === "invalid_household" && errorPath(err) === "status" ? STILL_LIVING : territoryError(err));
    }
  });

  function reload() {
    void client.invalidateQueries({ queryKey: [ HOUSEHOLD_KEY, household.id ] });
    onCancel();
  }

  return (
    <div style={box} role="group" aria-label={text.title}>
      <strong>{text.title}</strong>
      <p style={muted}>{text.effect}</p>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {stale ? (
        <div style={row}>
          <p role="alert" style={alert}>{STALE_TEXT}</p>
          <button type="button" style={secondaryButtonStyle} onClick={reload}>Recarregar</button>
        </div>
      ) : (
        <div style={row}>
          <button type="button" style={save.isPending ? disabledButtonStyle : buttonStyle} disabled={save.isPending} onClick={() => save.mutate()}>
            {text.confirm}
          </button>
          <button type="button" style={secondaryButtonStyle} disabled={save.isPending} onClick={onCancel}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
