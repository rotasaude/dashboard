// Arquivar (`received`, `in_analysis`, `awaiting_complement`; só o ouvidor): motivo da lista (`no_complement` é do sistema,
// Q36). Duplicidade manda o protocolo do original em `duplicate_of_protocol` (o api resolve e recusa; sem busca na tela, F-8);
// outro órgão pede o nome (1–120). Confirmação em dois passos: o cidadão recebe o aviso com o motivo.
import { useState } from "react";
import type { FormEvent } from "react";
import type { ArchiveReason } from "../../../lib/api";
import { OFFERED_ARCHIVE_REASONS, archiveProblems, archiveReasonLabel } from "../../../lib/ombudsman";
import type { PsyRefusal } from "../../../lib/psychosocial";
import { FrozenTextNotice } from "../../../components/FrozenTextNotice";
import { ConfirmButton } from "../../../components/ConfirmButton";
import { secondaryButtonStyle, inputStyle } from "../../../components/formStyles";
import { fieldLabel, form, row } from "../../exams/styles";
import { useActionForm, type ActionFormProps } from "../useManifestationAction";
import { formTitle } from "./TextActionForm";

const PROTOCOL = /^\d{4}-\d{6,12}$/;
const PROTOCOL_TEXT = "informe o protocolo da manifestação original, como 2026-000100";
const OWN = [ "reason", "duplicate_of_protocol", "external_body_name" ];
const noEvent = { preventDefault() {} } as FormEvent;

export function ArchiveForm({ run, onDone, onClose }: ActionFormProps) {
  const f = useActionForm();
  const { aria, errNode, busy } = f;
  const [ reason, setReason ] = useState<ArchiveReason | "">("");
  const [ protocol, setProtocol ] = useState("");
  const [ body, setBody ] = useState("");

  const check = () => {
    const proto = protocol.trim();
    const list = archiveProblems({ reason, duplicateOfId: PROTOCOL.test(proto) ? proto : null, externalBodyName: body });
    return list.map((p) => (p.path === "duplicate_of_id" ? { path: "duplicate_of_protocol", text: PROTOCOL_TEXT } : p));
  };
  const fields = (): Record<string, unknown> => {
    if (reason === "duplicate") return { reason, duplicate_of_protocol: protocol.trim() };
    if (reason === "forwarded_elsewhere") return { reason, external_body_name: body.trim() };
    return { reason };
  };
  // O api também nomeia o original por `duplicate_of_id` (os dois juntos, original igual à própria): tudo cai no campo do protocolo.
  const refused = (rs: PsyRefusal[]) => rs.map((r) => ({ path: r.path === "duplicate_of_id" ? "duplicate_of_protocol" : r.path, text: r.text }));
  const send = () => f.submit(noEvent, { check, call: () => run("archive", fields()), ok: onDone, stale: () => {}, refused });

  return (
    <form ref={f.formRef} aria-label="Arquivar" style={form} noValidate onSubmit={(ev) => ev.preventDefault()}>
      <p ref={f.titleRef} tabIndex={-1} style={formTitle}>Arquivar a manifestação</p>
      {f.top((path) => OWN.includes(path) || path === "duplicate_of_id")}
      <label style={fieldLabel}>
        Motivo
        <select value={reason} style={inputStyle} {...aria("reason")}
          onChange={(ev) => { f.clear("reason", "duplicate_of_protocol", "external_body_name"); setReason(ev.target.value as ArchiveReason | ""); }}>
          <option value="">Escolha</option>
          {OFFERED_ARCHIVE_REASONS.map((r) => <option key={r} value={r}>{archiveReasonLabel(r)}</option>)}
        </select>
      </label>
      {errNode("reason")}
      {reason === "duplicate" && (
        <>
          <label style={fieldLabel}>
            Protocolo da manifestação original
            <input value={protocol} style={inputStyle} inputMode="numeric" maxLength={17} {...aria("duplicate_of_protocol")}
              onChange={(ev) => { f.clear("duplicate_of_protocol"); setProtocol(ev.target.value); }} />
          </label>
          {errNode("duplicate_of_protocol")}
        </>
      )}
      {reason === "forwarded_elsewhere" && (
        <>
          <label style={fieldLabel}>
            Órgão
            <input value={body} style={inputStyle} maxLength={120} aria-invalid={aria("external_body_name")["aria-invalid"]}
              aria-describedby={[ `${f.fid("body")}-frozen`, aria("external_body_name")["aria-describedby"] ].filter(Boolean).join(" ")}
              onChange={(ev) => { f.clear("external_body_name"); setBody(ev.target.value); }} />
          </label>
          <FrozenTextNotice id={`${f.fid("body")}-frozen`} />
          {errNode("external_body_name")}
        </>
      )}
      <div style={row}>
        <ConfirmButton label="Arquivar agora" question="Arquivar? O cidadão recebe o aviso com o motivo." onConfirm={send} />
        <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onClose}>Fechar</button>
      </div>
    </form>
  );
}
