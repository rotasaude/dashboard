// Consentimento do cidadão para revelar a identidade fora da ouvidoria (F-33.7): consentiu ou não, e como foi dado (10–4000,
// texto congelado). Rota própria; a resposta é o detalhe, que não traz identidade. Anônima sem dado → 422 `no_identity`.
// Tela velha: a frase sobe ao painel (`onStale`) e o detalhe é relido uma vez.
import { useState } from "react";
import { recordIdentityConsent, type OmbudsmanManifestation } from "../../../lib/api";
import { MANIFESTATION_CHANGED, isChanged, ombudsmanRefusals, textActionProblems } from "../../../lib/ombudsman";
import { fieldLabel, form, row } from "../../exams/styles";
import { useFormProblems } from "../../psychosocial/useFormProblems";
import { FrozenTextArea } from "./ExtractField";
import { FormButtons, formTitle } from "./TextActionForm";

const PHRASE = "o texto tem de ter de 10 a 4000 caracteres";
const OWN = [ "text", "granted" ];

export function ConsentForm({ id, onChanged, onStale, onClose }: {
  id: string; onChanged(next: OmbudsmanManifestation | null): void; onStale(text: string): void; onClose(): void;
}) {
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err, { fields: { text: PHRASE } }).map((r) => ({ ...r, participantIndex: null })), isStale: isChanged });
  const [ granted, setGranted ] = useState<boolean | null>(null);
  const [ text, setText ] = useState("");
  const { aria, errNode, busy } = f;
  const choice = (value: boolean, label: string) => (
    <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <input type="radio" name={f.fid("granted")} checked={granted === value}
        onChange={() => { f.clear("granted"); setGranted(value); }} />{label}
    </label>
  );
  const check = () => {
    const list = textActionProblems("interim_response", { text }).map((p) => ({ ...p, text: PHRASE }));
    return granted === null ? [ { path: "granted", text: "informe se o cidadão consentiu" }, ...list ] : list;
  };

  return (
    <form ref={f.formRef} aria-label="Registrar consentimento" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check,
        call: () => recordIdentityConsent(id, { granted: granted as boolean, text }),
        ok: (next) => { onChanged(next); onClose(); },
        stale: () => { onStale(MANIFESTATION_CHANGED); onChanged(null); onClose(); }
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>Consentimento do cidadão para revelar a identidade</p>
      {f.top((path) => OWN.includes(path))}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} {...aria("granted")} aria-label="Consentimento">
        <div style={row}>{choice(true, "O cidadão consentiu")}{choice(false, "O cidadão não consentiu")}</div>
      </fieldset>
      {errNode("granted")}
      <FrozenTextArea id={f.fid("text")} label="Como o consentimento foi dado" value={text} aria={aria("text")} min={10}
        onChange={(v) => { f.clear("text"); setText(v); }} />
      {errNode("text")}
      <FormButtons busy={busy} submit="Registrar" onClose={onClose} />
    </form>
  );
}
