// Desfecho do atendimento (spec 2026-09-24 §6; módulo 11 D4; contratos do
// módulo 19 §4): o mesmo corpo do POST /attendance/attendances/:id/close serve
// ao "Encerrar" da fila e ao "Finalizar" da consulta.
import type { CareOutcome, HealthUnit, OutcomeBody } from "./api";
import { splitReferenceUnits } from "./attendance";

export const CARE_OUTCOMES: CareOutcome[] = [ "discharged", "referred", "return" ];
export const OUTCOME_LABEL: Record<CareOutcome, string> = {
  discharged: "Atendido e liberado",
  referred: "Encaminhado",
  return: "Retorno"
};

// `referralChoice` null = a pessoa ainda não mexeu, e vale a primeira unidade
// de referência (que pode chegar depois, com `units`); "" = escolheu "—".
export interface OutcomeDraft { outcome: CareOutcome; referralChoice: string | null; note: string }
export const EMPTY_OUTCOME: OutcomeDraft = { outcome: "discharged", referralChoice: null, note: "" };

export function outcomeView(draft: OutcomeDraft, referenceIds: string[] | undefined, unit: HealthUnit, units: HealthUnit[]) {
  const { referenceUnits, otherUnits } = splitReferenceUnits(units, referenceIds, unit.id);
  const referralUnitId = draft.referralChoice ?? referenceUnits[0]?.id ?? "";
  const targetUnitName = draft.outcome === "return"
    ? unit.name
    : (draft.outcome === "referred" && referralUnitId ? units.find((u) => u.id === referralUnitId)?.name : undefined);
  return { referenceUnits, otherUnits, referralUnitId, targetUnitName };
}

export function outcomeProblem(draft: OutcomeDraft, referralUnitId: string): string | null {
  return draft.outcome === "referred" && !referralUnitId && !draft.note.trim()
    ? "informe a unidade de destino ou a descrição do encaminhamento"
    : null;
}

// Igual ao ClosePanel de antes: unidade só no encaminhamento; nota sempre que preenchida.
export function outcomeBody(draft: OutcomeDraft, referralUnitId: string): OutcomeBody {
  const body: OutcomeBody = { outcome: draft.outcome };
  if (draft.outcome === "referred" && referralUnitId) body.referral_unit_id = referralUnitId;
  if (draft.note) body.referral_note = draft.note;
  return body;
}
