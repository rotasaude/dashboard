// Molde das ações de um texto (pedido de complemento, complemento recebido, respostas intermediária e conclusiva, prorrogação): o texto
// (10–4000, Q8) com o aviso de texto congelado e, na conclusiva dos tipos que a pedem, "Resolvida?". Os problemas saem todos
// de uma vez antes do envio; a recusa do api volta com a frase do campo (`fields`). Sem duplo envio (`busy` + ref).
import { useState } from "react";
import type { OmbudsmanActionName, Resolution } from "../../../lib/api";
import { finalResponseProblems, needsResolution, textActionProblems } from "../../../lib/ombudsman";
import type { Problem } from "../../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../../components/formStyles";
import { fieldLabel, form, row } from "../../exams/styles";
import { useActionForm, type ActionFormProps } from "../useManifestationAction";
import { FrozenTextArea } from "./ExtractField";

export const formTitle = { margin: 0, fontSize: 13, fontWeight: 600 } as const;
const OWN = [ "text", "resolution" ];

export function TextActionForm({ m, run, onDone, onClose, action, title, label, submit, textPhrase, notice }: ActionFormProps & {
  action: Extract<OmbudsmanActionName, "request_complement" | "complement" | "interim_response" | "final_response" | "extend">;
  title: string; label: string; submit: string; textPhrase: string; notice?: string;
}) {
  const f = useActionForm({ text: textPhrase });
  const [ text, setText ] = useState("");
  const [ resolution, setResolution ] = useState<Resolution | "">("");
  const final = action === "final_response";
  const asksResolution = final && needsResolution(m.kind);
  const { aria, errNode, busy } = f;
  const id = f.fid("text");

  const check = (): Problem[] => {
    const draft = { text, resolution: resolution || null };
    const list = final ? finalResponseProblems(draft, m.kind) : textActionProblems(action, draft);
    return list.map((p) => (p.path === "text" ? { ...p, text: textPhrase } : p));
  };
  const body = (): Record<string, unknown> => (asksResolution ? { text, resolution } : { text });

  return (
    <form ref={f.formRef} aria-label={title} style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, { check, call: () => run(action, body()), ok: onDone, stale: () => {} });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>{title}</p>
      {f.top((path) => OWN.includes(path))}
      <FrozenTextArea id={id} label={label} value={text} aria={aria("text")} min={10}
        notice={notice ? { id: `${id}-notice`, text: notice } : undefined}
        onChange={(v) => { f.clear("text"); setText(v); }} />
      {errNode("text")}
      {asksResolution && (
        <>
          <label style={fieldLabel}>
            Resolvida?
            <select value={resolution} style={inputStyle} {...aria("resolution")}
              onChange={(ev) => { f.clear("resolution"); setResolution(ev.target.value as Resolution | ""); }}>
              <option value="">Escolha</option>
              <option value="resolved">Sim, resolvida</option>
              <option value="not_resolved">Não resolvida</option>
            </select>
          </label>
          {errNode("resolution")}
        </>
      )}
      <FormButtons busy={busy} submit={submit} onClose={onClose} />
    </form>
  );
}

export function FormButtons({ busy, submit, onClose }: { busy: boolean; submit: string; onClose(): void }) {
  return (
    <div style={row}>
      <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>{submit}</button>
      <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onClose}>Fechar</button>
    </div>
  );
}
