// Abrir a identidade ou um anexo protegido com justificativa (módulo 33; F-33.7; §8, Q50, Q24, Q2, Q14). Só o ouvidor chega
// aqui (`can.open_identity`; anexo fora do `identified`); sem step-up (U4): a justificativa (10–500, Q8) fica na trilha do api.
// - `identity`: `revealOmbudsmanIdentity` chamado direto (sem useQuery/useMutation): a identidade fica SÓ no `useState` deste
//   diálogo — nunca no cache, em storage ou no console — e sai junto com ele ao fechar (o pai o desmonta). Reabrir = novo
//   diálogo, nova justificativa, nova chamada. Lida campo a campo; nulo → "não informado"; "Nome civil" só quando vem (Q50).
// - `attachment`: `openFile` com a justificativa no corpo do link; deu certo, o diálogo fecha.
// Um envio por vez (`busy` + ref); resposta que chega depois de fechar é ignorada. Recusa pela frase de `ombudsmanError`, sem eco.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { getOmbudsmanAttachmentUrl, revealOmbudsmanIdentity, type OmbudsmanAttachment, type OmbudsmanFullIdentity } from "../../lib/api";
import { OMBUDSMAN_ERRORS, justificationOk, ombudsmanError } from "../../lib/ombudsman";
import { useDialog } from "../../lib/useDialog";
import { reasonHint } from "../../components/ReasonHint";
import { KeyValue } from "../../components/KeyValue";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, form, grid, muted, row } from "../exams/styles";
import { FrozenTextArea } from "./actions/ExtractField";
import { openFile } from "./openFile";

export type IdentityDialogScope = "identity" | "attachment";
export const ACCESS_RECORDED = "Este acesso foi registrado com a sua justificativa.";
const NOT_INFORMED = "não informado";
const FIELD_ID = "omb-justification";

const overlay = {
  position: "fixed", inset: 0, background: "color-mix(in srgb, var(--ink) 32%, transparent)", backdropFilter: "blur(2px)",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 80
} as const;
const panel = {
  width: "min(560px, 100%)", maxHeight: "100%", overflowY: "auto", background: "var(--panel)", border: "1px solid var(--rule)",
  borderRadius: 8, padding: 20, display: "flex", flexDirection: "column", gap: 12
} as const;
const heading = { margin: 0, fontSize: 15, fontWeight: 600 } as const;

const shown = (v: string | null): string => (typeof v === "string" && v.trim() !== "" ? v : NOT_INFORMED);

function IdentityFields({ identity: r }: { identity: OmbudsmanFullIdentity }) {
  const civil = typeof r.full_name === "string" && r.full_name.trim() !== "" ? r.full_name : null;
  return (
    <div style={grid}>
      <KeyValue k="Nome" v={shown(r.name)} mono={false} />
      {civil && <KeyValue k="Nome civil" v={civil} mono={false} />}
      <KeyValue k="CPF" v={shown(r.cpf)} />
      <KeyValue k="Telefone" v={shown(r.phone)} />
      <KeyValue k="Nome informado" v={shown(r.manifestant_name)} mono={false} />
      <KeyValue k="Contato informado" v={shown(r.manifestant_contact)} mono={false} />
      <KeyValue k="CPF informado" v={shown(r.manifestant_cpf)} />
    </div>
  );
}

export function IdentityDialog({ manifestationId, scope, attachment, returnFocusTo, onClose }: {
  manifestationId: string; scope: IdentityDialogScope; attachment?: OmbudsmanAttachment; returnFocusTo?: HTMLElement | null;
  onClose(): void;
}) {
  const [ justification, setJustification ] = useState("");
  const [ identity, setIdentity ] = useState<OmbudsmanFullIdentity | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const resultRef = useRef<HTMLDivElement | null>(null);
  // Montado de novo (StrictMode) volta a valer; desmontado, a resposta em voo não grava nada.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // Fechar (botão ou Escape) zera o que foi lido antes de o pai desmontar o diálogo.
  const close = () => { setIdentity(null); setJustification(""); onClose(); };
  const ref = useDialog<HTMLDivElement>(true, close, returnFocusTo);
  useEffect(() => { if (identity) resultRef.current?.focus(); }, [ identity ]);

  const label = scope === "identity" ? "Ver identidade" : "Abrir anexo protegido";
  const submitText = scope === "identity" ? "Ver identidade" : "Abrir anexo";
  const ok = justificationOk(justification);
  // A dica do mínimo é do `FrozenTextArea`; acima de 500, a frase da faixa.
  const over = !ok && reasonHint(justification) === null;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!ok || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (scope === "identity") {
        const found = await revealOmbudsmanIdentity(manifestationId, justification);
        if (!alive.current) return;
        setIdentity(found);
        setJustification("");
      } else if (attachment) {
        // `window.open` acontece dentro de `openFile`, antes do primeiro await: ainda no gesto do envio.
        const failed = await openFile(() => getOmbudsmanAttachmentUrl(attachment.id, justification), (err) => ombudsmanError(err));
        if (!alive.current) return;
        if (failed) setError(failed);
        else onClose();
      }
    } catch (err) {
      if (alive.current) setError(ombudsmanError(err));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div style={overlay}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} style={panel}>
        <p style={heading}>{label}</p>
        {identity ? (
          <div ref={resultRef} tabIndex={-1} style={{ display: "flex", flexDirection: "column", gap: 12, outline: "none" }}>
            <IdentityFields identity={identity} />
            <p role="status" style={muted}>{ACCESS_RECORDED}</p>
            <div style={row}><button type="button" style={secondaryButtonStyle} onClick={close}>Fechar</button></div>
          </div>
        ) : (
          <form style={form} noValidate onSubmit={(ev) => void submit(ev)}>
            <FrozenTextArea id={FIELD_ID} label="Justificativa (fica registrada)" value={justification} min={10}
              aria={over ? { "aria-describedby": `${FIELD_ID}-range` } : {}}
              onChange={(v) => { setError(null); setJustification(v); }} />
            {over && <p id={`${FIELD_ID}-range`} style={muted}>{OMBUDSMAN_ERRORS.justification_range}</p>}
            {error && <p role="alert" style={alert}>{error}</p>}
            <div style={row}>
              <button type="submit" style={!ok || busy ? disabledButtonStyle : buttonStyle} disabled={!ok || busy}>{submitText}</button>
              <button type="button" style={secondaryButtonStyle} onClick={close}>Fechar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
