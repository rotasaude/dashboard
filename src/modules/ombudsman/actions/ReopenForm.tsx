// Reabrir de ofício (`answered`, `archived`; só o ouvidor). A justificativa é opcional (como no api); se vier, 10–4000, e vai
// como `text`. Sem ela, o corpo é só `{ expected_state }`.
import { useState } from "react";
import { textActionProblems } from "../../../lib/ombudsman";
import { form } from "../../exams/styles";
import { useActionForm, type ActionFormProps } from "../useManifestationAction";
import { FrozenTextArea } from "./ExtractField";
import { FormButtons, formTitle } from "./TextActionForm";

const PHRASE = "a justificativa, se escrita, tem de ter de 10 a 4000 caracteres";

export function ReopenForm({ run, onDone, onClose }: ActionFormProps) {
  const f = useActionForm({ text: PHRASE });
  const [ text, setText ] = useState("");
  const { aria, errNode, busy } = f;
  return (
    <form ref={f.formRef} aria-label="Reabrir" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => textActionProblems("reopen", { text }).map((p) => ({ ...p, text: PHRASE })),
        call: () => run("reopen", text.trim() === "" ? {} : { text }), ok: onDone, stale: () => {}
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>Reabrir a manifestação</p>
      {f.top((path) => path === "text")}
      <FrozenTextArea id={f.fid("text")} label="Justificativa (opcional)" value={text} aria={aria("text")}
        onChange={(v) => { f.clear("text"); setText(v); }} />
      {errNode("text")}
      <FormButtons busy={busy} submit="Reabrir agora" onClose={onClose} />
    </form>
  );
}
