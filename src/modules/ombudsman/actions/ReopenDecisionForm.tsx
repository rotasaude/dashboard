// Decisão do ouvidor sobre o pedido de reabertura do cidadão (F-33.7): aceitar ou recusar, com o texto (10–4000) nos dois casos.
// Só ao recusar o texto vai ao cidadão; ao aceitar é interno — o rótulo muda com a escolha. Rota própria (não passa por
// `useManifestationAction`): a resposta é o detalhe. Pedido já decidido (409 `already_decided`) ou tela velha: a frase sobe
// ao painel (`onStale`; o formulário some junto com o pedido) e o detalhe é relido uma vez, sem reenvio.
import { useState } from "react";
import { decideReopenRequest, errorCode, type OmbudsmanManifestation } from "../../../lib/api";
import { MANIFESTATION_CHANGED, OMBUDSMAN_ERRORS, isChanged, ombudsmanRefusals, textActionProblems } from "../../../lib/ombudsman";
import { buttonStyle, disabledButtonStyle } from "../../../components/formStyles";
import { fieldLabel, form, row } from "../../exams/styles";
import { useFormProblems } from "../../psychosocial/useFormProblems";
import { FrozenTextArea } from "./ExtractField";
import { formTitle } from "./TextActionForm";

type Decision = "accept" | "reject";
const PHRASE = "o texto tem de ter de 10 a 4000 caracteres";
const OWN = [ "text", "decision" ];
const stale = (err: unknown): boolean => isChanged(err) || errorCode(err) === "already_decided";

export function ReopenDecisionForm({ requestId, onChanged, onStale }: {
  requestId: string; onChanged(next: OmbudsmanManifestation | null): void; onStale(text: string): void;
}) {
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err, { fields: { text: PHRASE } }).map((r) => ({ ...r, participantIndex: null })), isStale: stale });
  const [ decision, setDecision ] = useState<Decision | "">("");
  const [ text, setText ] = useState("");
  const { aria, errNode, busy } = f;
  const choice = (value: Decision, label: string) => (
    <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <input type="radio" name={f.fid("decision")} checked={decision === value}
        onChange={() => { f.clear("decision"); setDecision(value); }} />{label}
    </label>
  );
  const check = () => {
    const list = textActionProblems("interim_response", { text }).map((p) => ({ ...p, text: PHRASE }));
    return decision ? list : [ { path: "decision", text: "escolha aceitar ou recusar" }, ...list ];
  };

  return (
    <form ref={f.formRef} aria-label="Decidir pedido de reabertura" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check,
        call: () => decideReopenRequest(requestId, { decision: decision as Decision, text }),
        ok: (next) => onChanged(next),
        stale: (_phrase, err) => { onStale(errorCode(err) === "already_decided" ? OMBUDSMAN_ERRORS.already_decided : MANIFESTATION_CHANGED); onChanged(null); }
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>Decidir o pedido</p>
      {f.top((path) => OWN.includes(path))}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} {...aria("decision")} aria-label="Decisão">
        <div style={row}>{choice("accept", "Aceitar")}{choice("reject", "Recusar")}</div>
      </fieldset>
      {errNode("decision")}
      <FrozenTextArea id={f.fid("text")} label={decision === "reject" ? "Texto ao cidadão" : "Texto interno (não vai ao cidadão)"}
        value={text} aria={aria("text")} min={10} onChange={(v) => { f.clear("text"); setText(v); }} />
      {errNode("text")}
      <div style={row}><button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Decidir pedido</button></div>
    </form>
  );
}
