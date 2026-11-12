// Renomear no próprio lugar (assunto ou setor; módulo 33, F-33.1): nome de 2–80, recusado antes de enviar e nunca cortado.
// A recusa do api (`name_taken`, 403…) volta com a frase. Sem duplo envio (`useFormProblems`). Nada em storage.
import { useEffect, useRef, useState } from "react";
import { nameProblem, ombudsmanRefusals } from "../../lib/ombudsman";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";

export function RenameInline({ name, onSave, onClose }: { name: string; onSave(next: string): Promise<unknown>; onClose(): void }) {
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err).map((r) => ({ ...r, participantIndex: null })) });
  const [ value, setValue ] = useState(name);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { input.current?.focus(); }, []);
  return (
    <form ref={f.formRef} aria-label={`Renomear ${name}`} noValidate style={{ ...row, alignItems: "flex-start" }} onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => { const p = nameProblem(value); return p ? [ { path: "name", text: p } ] : []; },
        call: () => onSave(value.trim()),
        ok: onClose
      });
    }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <input ref={input} type="text" aria-label={`Novo nome de ${name}`} style={{ ...inputStyle, width: 240, marginTop: 0 }} value={value}
          onChange={(e) => { f.clear("name"); setValue(e.target.value); }} {...f.aria("name")} />
        {f.errNode("name")}
        {f.top((path) => path === "name")}
      </span>
      <button type="submit" disabled={f.busy} style={f.busy ? disabledButtonStyle : buttonStyle}>Salvar nome</button>
      <button type="button" disabled={f.busy} style={secondaryButtonStyle} onClick={onClose}>Cancelar</button>
    </form>
  );
}
