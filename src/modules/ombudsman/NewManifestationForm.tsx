// Registro de manifestação pela equipe (módulo 33; F-33.4; contrato §5; Q22, Q58, Q60): tipo, modo (a anônima só na denúncia),
// canal (presencial, telefone ou OuvidorSUS — o canal do cidadão não aparece; o número do OuvidorSUS só nele), quem manifesta
// (`PersonPick`, fora da anônima), unidade referida (opcional), o texto (20–4000, com aviso de texto congelado) e anexos.
// No envio: tudo é conferido de uma vez; os anexos sobem um a um (uma recusa para tudo, sem registrar) e então o registro, com
// o corpo só do preenchido (CPF só dígitos; `citizen_id` nunca junto de `manifestant_*`). `citizen_id` recusado (422, Q60):
// o cidadão sai e voltam os campos informados com a frase. Sem duplo envio (`busy` + ref). Ao registrar, quem usa troca o
// formulário pelo resultado: ele desmonta e nenhum nome, CPF ou texto fica no estado. Nada em storage.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createOmbudsmanManifestation, getOmbudsmanOptions, type IdentificationMode, type NewManifestationInput, type OmbudsmanKind,
  type OmbudsmanStaffChannel
} from "../../lib/api";
import { onlyDigits } from "../../lib/attendance";
import {
  OMB_OPTIONS_KEY, STATIC_QUERY, channelLabel, kindLabel, modeLabel, newManifestationProblems, ombudsmanError, type NewDraft
} from "../../lib/ombudsman";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";
import { checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { useActionForm } from "./useManifestationAction";
import { FrozenTextArea } from "./actions/ExtractField";
import { AttachmentPicker, isAttachmentRefusal, uploadAll } from "./AttachmentPicker";
import { EMPTY_PERSON, PersonPick, type PersonValue } from "./PersonPick";
import type { CreatedManifestation } from "./Receipt";

const KINDS: OmbudsmanKind[] = [ "complaint", "report", "praise", "suggestion", "request" ];
const STAFF_CHANNELS: OmbudsmanStaffChannel[] = [ "in_person", "phone", "ouvidorsus" ];
const KIND_REQUIRED = "escolha o tipo";
const CHANNEL_REQUIRED = "escolha o canal: presencial, telefone ou OuvidorSUS";
const BODY_TEXT = "o texto da manifestação tem de ter de 20 a 4000 caracteres";
const ANONYMOUS_LABEL = "Anônima (só denúncia)";
// Paths que têm lugar no formulário; o resto vai ao topo.
const OWN = [
  "kind", "identification_mode", "channel", "ouvidorsus_number", "person", "citizen_id", "manifestant_name", "manifestant_contact",
  "manifestant_cpf", "health_unit_id", "body", "attachments"
];

const filled = (v: string): string | null => (v.trim() === "" ? null : v.trim());

export function NewManifestationForm({ onCreated }: { onCreated(c: CreatedManifestation): void }) {
  const f = useActionForm({ body: BODY_TEXT });
  const options = useQuery({ queryKey: [ OMB_OPTIONS_KEY ], queryFn: getOmbudsmanOptions, ...STATIC_QUERY });
  const [ kind, setKind ] = useState<OmbudsmanKind | "">("");
  const [ mode, setMode ] = useState<IdentificationMode>("identified");
  const [ channel, setChannel ] = useState<OmbudsmanStaffChannel | "">("");
  const [ number, setNumber ] = useState("");
  const [ person, setPerson ] = useState<PersonValue>(EMPTY_PERSON);
  const [ unitId, setUnitId ] = useState("");
  const [ body, setBody ] = useState("");
  const [ files, setFiles ] = useState<File[]>([]);
  // Anexos já subidos nesta tela (reaproveitados se o registro falhar e a pessoa tentar de novo).
  const uploaded = useRef(new Map<File, string>());
  const { aria, errNode, busy } = f;
  const anonymous = mode === "anonymous";

  const check = (): Problem[] => {
    const list: Problem[] = [];
    if (kind === "") list.push({ path: "kind", text: KIND_REQUIRED });
    if (channel === "") list.push({ path: "channel", text: CHANNEL_REQUIRED });
    const draft: NewDraft = {
      // Sem tipo, a regra da anônima não se aplica (a anônima só se escolhe na denúncia).
      kind: kind === "" ? "complaint" : kind,
      mode,
      channel: channel === "" ? "in_person" : channel,
      ouvidorsusNumber: number,
      person: person.person,
      manual: person.person ? { name: "", contact: "", cpf: "" } : { name: person.name, contact: person.contact, cpf: person.cpf },
      body,
      healthUnitId: unitId || null,
      files
    };
    list.push(...newManifestationProblems(draft).map((p) => (p.path === "body" ? { ...p, text: BODY_TEXT } : p)));
    return list;
  };

  const input = (attachmentIds: string[]): NewManifestationInput => {
    const out: NewManifestationInput = { kind: kind as OmbudsmanKind, identification_mode: mode, channel: channel as OmbudsmanStaffChannel, body };
    const ouvidorsusNumber = channel === "ouvidorsus" ? filled(number) : null;
    if (ouvidorsusNumber) out.ouvidorsus_number = ouvidorsusNumber;
    if (!anonymous) {
      if (person.person) out.citizen_id = person.person.citizen_id;
      else {
        const name = filled(person.name);
        const contact = filled(person.contact);
        const cpf = onlyDigits(person.cpf);
        if (name) out.manifestant_name = name;
        if (contact) out.manifestant_contact = contact;
        if (cpf) out.manifestant_cpf = cpf;
      }
    }
    if (unitId) out.health_unit_id = unitId;
    if (attachmentIds.length > 0) out.attachment_ids = attachmentIds;
    return out;
  };

  const chooseKind = (v: OmbudsmanKind | "") => {
    f.clear("kind");
    setKind(v);
    if (v !== "report" && mode === "anonymous") setMode("identified");
  };
  const chooseMode = (v: IdentificationMode) => {
    f.clear("identification_mode", "person", "citizen_id", "manifestant_name", "manifestant_contact", "manifestant_cpf");
    setMode(v);
    // A anônima não leva ninguém: o que foi digitado sobre a pessoa sai do estado.
    if (v === "anonymous") setPerson(EMPTY_PERSON);
  };
  const chooseChannel = (v: OmbudsmanStaffChannel) => {
    f.clear("channel", "ouvidorsus_number");
    setChannel(v);
    if (v !== "ouvidorsus") setNumber("");
  };

  return (
    <form ref={f.formRef} aria-label="Nova manifestação" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check,
        call: async () => {
          const ids = await uploadAll(files, uploaded.current);
          return createOmbudsmanManifestation(input(ids));
        },
        ok: (res) => onCreated({ ...res, identification_mode: mode }),
        refused: (refusals) => {
          // Q60: o cidadão não pode ser ligado — voltam os campos informados (vazios), com o CPF digitado.
          if (refusals.some((r) => r.path === "citizen_id")) setPerson((p) => ({ ...p, person: null, name: "", contact: "", missed: false }));
          return refusals.map((r) => ({ path: isAttachmentRefusal(r) ? "attachments" : r.path, text: r.text }));
        }
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Dados da manifestação</p>
      {f.top((path) => OWN.includes(path))}

      <label style={fieldLabel}>
        Tipo
        <select value={kind} style={inputStyle} disabled={busy} {...aria("kind")}
          onChange={(ev) => chooseKind(ev.target.value as OmbudsmanKind | "")}>
          <option value="">Escolha</option>
          {KINDS.map((k) => <option key={k} value={k}>{kindLabel(k)}</option>)}
        </select>
      </label>
      {errNode("kind")}

      <fieldset style={fieldset} {...aria("identification_mode")}>
        <legend style={legend}>Identificação</legend>
        {([ "identified", "preserved" ] as const).map((m) => (
          <label key={m} style={checkLabel}>
            <input type="radio" name="identification_mode" value={m} checked={mode === m} disabled={busy} onChange={() => chooseMode(m)} />
            {modeLabel(m)}
          </label>
        ))}
        <label style={checkLabel}>
          <input type="radio" name="identification_mode" value="anonymous" checked={anonymous} disabled={busy || kind !== "report"}
            onChange={() => chooseMode("anonymous")} />
          {ANONYMOUS_LABEL}
        </label>
      </fieldset>
      {errNode("identification_mode")}

      <fieldset style={fieldset} {...aria("channel")}>
        <legend style={legend}>Canal</legend>
        {STAFF_CHANNELS.map((c) => (
          <label key={c} style={checkLabel}>
            <input type="radio" name="channel" value={c} checked={channel === c} disabled={busy} onChange={() => chooseChannel(c)} />
            {channelLabel(c)}
          </label>
        ))}
      </fieldset>
      {errNode("channel")}

      {channel === "ouvidorsus" && (
        <>
          <label style={fieldLabel}>
            Número do OuvidorSUS
            <input value={number} maxLength={40} style={inputStyle} autoComplete="off" disabled={busy} {...aria("ouvidorsus_number")}
              onChange={(ev) => { f.clear("ouvidorsus_number"); setNumber(ev.target.value); }} />
          </label>
          {errNode("ouvidorsus_number")}
        </>
      )}

      {!anonymous && <PersonPick value={person} setValue={setPerson} f={f} disabled={busy} />}

      <label style={fieldLabel}>
        Unidade referida (opcional)
        <select value={unitId} style={inputStyle} disabled={busy} {...aria("health_unit_id")}
          onChange={(ev) => { f.clear("health_unit_id"); setUnitId(ev.target.value); }}>
          <option value="">Nenhuma</option>
          {(options.data?.health_units ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      {options.isError && <p style={muted}>{`As unidades não foram lidas: ${ombudsmanError(options.error)}`}</p>}
      {errNode("health_unit_id")}

      <FrozenTextArea id={f.fid("body")} label="Texto da manifestação" value={body} aria={aria("body")} min={20}
        onChange={(v) => { f.clear("body"); setBody(v); }} />
      {errNode("body")}

      <AttachmentPicker files={files} aria={aria("attachments")} disabled={busy}
        onChange={(next) => { f.clear("attachments"); setFiles(next); }} />
      {errNode("attachments")}

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Registrar manifestação</button>
      </div>
    </form>
  );
}
