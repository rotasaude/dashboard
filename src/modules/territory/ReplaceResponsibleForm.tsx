// src/modules/territory/ReplaceResponsibleForm.tsx
// Troca do responsável que saiu (L29, PROVA-2): `POST
// /territory/families/:id/replace_responsible` com o id da família ANTIGA,
// `{ responsible: { patient_id }, version }` e a versão do DOMICÍLIO; a
// resposta é o domicílio inteiro. A tela só oferece a troca à família com
// `responsible_exited` (ruling da coordenação). O novo responsável é um
// morador com cadastro ATIVO nesta família (o recusado conta), nunca o que
// saiu. Antes de enviar, a confirmação diz o efeito: família nova, moradores
// passam para ela, a antiga fica encerrada e o parentesco volta em branco.
// Sem step-up (gravação de família). Recusas pela frase do módulo, `path`
// foca o campo; 409 stale_version pede "Recarregar", como na família.
import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorCode, replaceResponsible, type Family, type Household, type Registration } from "../../lib/api";
import {
  HOUSEHOLDS_KEY, HOUSEHOLD_KEY, NO_NAME, REGISTRATION_KEY, REGISTRY_COUNT_KEY, REGISTRY_STATUS_KEY, RESIDENTS_KEY, STALE_TEXT, errorPath, isStale,
  territoryError
} from "../../lib/territoryRegistry";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row } from "../exams/styles";
import { useFieldFocus } from "./fieldFocus";

export const RESPONSIBLE_REPLACED = "Responsável trocado. Nova versão enviada ao e-SUS.";
export const RESPONSIBLE_EXITED_TEXT = "Responsável saiu — escolha o novo responsável";
const CHOOSE = "escolha o novo responsável entre os moradores da família";
const NO_CANDIDATE = "nenhum morador desta família com cadastro ativo — cadastre o novo responsável antes";
// 422 invalid_family sem campo na tela: a frase diz o que mudou.
const PATH_TEXT: Record<string, string> = {
  moved_out: "esta família já se mudou — recarregue o domicílio",
  version: "a versão do domicílio não confere — recarregue o domicílio"
};
const FIX_HOUSEHOLD = "o domicílio tem um campo a corrigir — edite o domicílio antes de trocar o responsável";

export const replaceEffect = (name: string) =>
  `Nasce uma família nova com ${name} como responsável; os moradores passam para ela e a família antiga fica encerrada. ` +
  "O parentesco de cada morador precisa ser informado de novo.";

// Moradores com cadastro ativo desta família, sem o responsável que saiu.
export function replaceCandidates(family: Family, residents: Registration[]): { patient_id: string; display_name: string | null }[] {
  return residents
    .filter((r) => r.family_id === family.id && r.status !== "exited" && r.patient.id !== family.responsible.patient_id)
    .map((r) => ({ patient_id: r.patient.id, display_name: r.patient.display_name }));
}

export function ReplaceResponsibleForm({ household, family, residents, onSaved, onCancel }: {
  household: Household; family: Family; residents: Registration[]; onSaved(h: Household): void; onCancel(): void;
}) {
  const client = useQueryClient();
  const focus = useFieldFocus();
  const [ chosen, setChosen ] = useState("");
  const [ step, setStep ] = useState<"edit" | "confirm">("edit");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ stale, setStale ] = useState(false);
  const candidates = replaceCandidates(family, residents);
  const name = (id: string) => candidates.find((c) => c.patient_id === id)?.display_name ?? NO_NAME;

  const reject = (message: string, path: string | null) => { setStep("edit"); setStale(false); setProblem(message); focus.mark(path); };

  const save = useMutation({
    mutationFn: (patientId: string) => replaceResponsible(family.id, patientId, household.version),
    // A resposta é o domicílio inteiro: entra no cache do detalhe (sem reler).
    // Cada cadastro ativo da família ganhou versão nova (família nova,
    // parentesco em branco): moradores, cadastros e validade releem.
    onSuccess: (h) => {
      client.setQueryData([ HOUSEHOLD_KEY, h.id ], h);
      void client.invalidateQueries({ queryKey: [ RESIDENTS_KEY, h.id ] });
      for (const key of [ HOUSEHOLDS_KEY, REGISTRATION_KEY, REGISTRY_STATUS_KEY, REGISTRY_COUNT_KEY ]) void client.invalidateQueries({ queryKey: [ key ] });
      onSaved(h);
    },
    onError: (err) => {
      if (isStale(err)) { setProblem(null); focus.mark(null); setStale(true); return; }
      const code = errorCode(err);
      const path = errorPath(err);
      if (code === "invalid_household") return reject(FIX_HOUSEHOLD, null);
      if (code === "invalid_family" && path && PATH_TEXT[path]) return reject(PATH_TEXT[path], null);
      reject(territoryError(err), path);
    }
  });

  function review(e: FormEvent) {
    e.preventDefault();
    if (!chosen) return reject(CHOOSE, "responsible.patient_id");
    setProblem(null);
    focus.mark(null);
    setStep("confirm");
  }

  function reload() {
    void client.invalidateQueries({ queryKey: [ HOUSEHOLD_KEY, household.id ] });
    void client.invalidateQueries({ queryKey: [ RESIDENTS_KEY, household.id ] });
    onCancel();
  }

  if (step === "confirm" && chosen) {
    return (
      <div style={box} role="group" aria-label="Confirmar troca de responsável">
        <strong>Confirmar troca de responsável</strong>
        <p style={{ margin: 0, fontSize: 12.5 }}>{replaceEffect(name(chosen))}</p>
        <p style={muted}>{`Sai: ${family.responsible.display_name ?? NO_NAME}`}</p>
        {stale ? (
          <div style={row}>
            <p role="alert" style={alert}>{STALE_TEXT}</p>
            <button type="button" style={secondaryButtonStyle} onClick={reload}>Recarregar</button>
          </div>
        ) : (
          <div style={row}>
            <button type="button" style={save.isPending ? disabledButtonStyle : buttonStyle} disabled={save.isPending}
              onClick={() => save.mutate(chosen)}>Confirmar troca</button>
            <button type="button" style={secondaryButtonStyle} disabled={save.isPending} onClick={() => setStep("edit")}>Voltar</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form style={form} onSubmit={review} noValidate aria-label="Trocar responsável">
      <p style={{ margin: 0 }}>{`Responsável que saiu: ${family.responsible.display_name ?? NO_NAME}`}</p>
      {candidates.length === 0 ? <p style={muted}>{NO_CANDIDATE}</p> : (
        <label style={fieldLabel}>
          Novo responsável
          <select ref={focus.reg("responsible.patient_id")} value={chosen} style={inputStyle}
            aria-invalid={focus.invalid("responsible.patient_id")} onChange={(e) => { setChosen(e.target.value); setProblem(null); }}>
            <option value="">— escolha —</option>
            {candidates.map((c) => <option key={c.patient_id} value={c.patient_id}>{c.display_name ?? NO_NAME}</option>)}
          </select>
        </label>
      )}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        {candidates.length > 0 && <button type="submit" style={buttonStyle}>Trocar responsável</button>}
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
