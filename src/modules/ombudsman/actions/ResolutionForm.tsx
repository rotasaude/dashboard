// Alterar a resolutividade (`answered`; só o ouvidor; reclamação, solicitação e denúncia). Escolha obrigatória e justificativa
// (10–4000). Corpo `{ expected_state, resolution, text }`.
import { useState } from "react";
import type { Resolution } from "../../../lib/api";
import { textActionProblems } from "../../../lib/ombudsman";
import { fieldLabel, form, row } from "../../exams/styles";
import { useActionForm, type ActionFormProps } from "../useManifestationAction";
import { FrozenTextArea } from "./ExtractField";
import { FormButtons, formTitle } from "./TextActionForm";

const PHRASE = "a justificativa tem de ter de 10 a 4000 caracteres";
const OWN = [ "text", "resolution" ];

export function ResolutionForm({ m, run, onDone, onClose }: ActionFormProps) {
  const f = useActionForm({ text: PHRASE });
  const [ resolution, setResolution ] = useState<Resolution | "">("");
  const [ text, setText ] = useState("");
  const { aria, errNode, busy } = f;
  const choice = (value: Resolution, label: string) => (
    <label style={{ ...fieldLabel, flexDirection: "row", alignItems: "center", gap: 6 }}>
      <input type="radio" name={f.fid("resolution")} checked={resolution === value}
        onChange={() => { f.clear("resolution"); setResolution(value); }} />{label}
    </label>
  );
  return (
    <form ref={f.formRef} aria-label="Alterar resolutividade" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => textActionProblems("change_resolution", { text, resolution: resolution || null }).map((p) => (p.path === "text" ? { ...p, text: PHRASE } : p)),
        call: () => run("change_resolution", { resolution, text }), ok: onDone, stale: () => {}
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>{m.resolution ? "Resolutividade atual: " + (m.resolution === "resolved" ? "resolvida" : "não resolvida") : "Alterar resolutividade"}</p>
      {f.top((path) => OWN.includes(path))}
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} {...aria("resolution")} aria-label="Resolutividade">
        <div style={row}>{choice("resolved", "resolvida")}{choice("not_resolved", "não resolvida")}</div>
      </fieldset>
      {errNode("resolution")}
      <FrozenTextArea id={f.fid("text")} label="Justificativa" value={text} aria={aria("text")} min={10}
        onChange={(v) => { f.clear("text"); setText(v); }} />
      {errNode("text")}
      <FormButtons busy={busy} submit="Salvar resolutividade" onClose={onClose} />
    </form>
  );
}
