// src/modules/lab/RectifyForm.tsx
// Retificação (spec §5.9; RDC 978 art. 170): laudo novo com o motivo e quem
// foi avisado (pessoa, canal, hora); o anterior fica `rectified` e, no 21a,
// "substituído". Mesma assinatura da liberação (médico só ICP; ICP só onde há
// assinatura digital); o código é apagado antes do envio e nunca guardado.
// Os valores que entram são os escolhidos agora (digite o novo valor e escolha-o antes).
import { useState } from "react";
import { errorCode, rectifyLabReport, type LabReleaseItem, type LabReportSummary, type LabSignatureKind } from "../../lib/api";
import { CHANNEL_OPTIONS, contactsBody, labError, onlyIcp, rectifyProblem, totpProblem, type ContactDraft } from "../../lib/lab";
import { hasFeature } from "../../lib/features";
import { useAuth } from "../../lib/auth";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { NO_ICP_FOR_DOCTOR, SignatureChoice } from "./SignatureChoice";
import { cityNowLocal } from "./CriticalNoticeForm";
import { alert, box, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";

// `guard`: a guarda de gravação da conferência (uma ação por vez — liberar,
// escolher valor, avisar e retificar não correm juntas).
export interface WriteGuard { begin(): boolean; end(): void; busy: boolean }

export function RectifyForm({ report, items, council, guard, onDone, onConflict, onCancel }: {
  report: LabReportSummary; items: LabReleaseItem[]; council: string | null; guard: WriteGuard;
  onDone(r: LabReportSummary): void; onConflict(text: string): void; onCancel(): void;
}) {
  const { user } = useAuth();
  // Só os exames liberados que este laudo cobre (I2).
  const released = items.filter((i) => i.status === "released" && report.item_ids.includes(i.id));
  const [ itemIds, setItemIds ] = useState<string[]>(released.map((i) => i.id));
  const [ reason, setReason ] = useState("");
  const [ contacts, setContacts ] = useState<ContactDraft[]>([]);
  // null = ainda não escolhido: ICP quando a cidade tem assinatura digital, senão a avançada.
  const [ chosen, setChosen ] = useState<LabSignatureKind | null>(null);
  const [ icpRefused, setIcpRefused ] = useState(false);
  const [ totp, setTotp ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const available = hasFeature(user, "digital_signature") && !icpRefused;
  const signature: LabSignatureKind = onlyIcp(council) ? "icp" : available ? (chosen ?? "icp") : "advanced";
  const noIcpForDoctor = onlyIcp(council) && !available;

  const setContact = (i: number, patch: Partial<ContactDraft>) =>
    setContacts((list) => list.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function submit() {
    if (noIcpForDoctor) { setError(NO_ICP_FOR_DOCTOR); return; }
    const problem = rectifyProblem(reason, contacts, new Date().toISOString())
      ?? (itemIds.length === 0 ? "escolha ao menos um exame" : null)
      ?? (signature === "advanced" ? totpProblem(totp) : null);
    if (problem) { setError(problem); return; }
    if (!guard.begin()) return;
    setError(null);
    const code = totp;
    setTotp("");
    let out: LabReportSummary;
    try {
      const body = { item_ids: itemIds, reason: reason.trim(), contacts: contactsBody(contacts), signature };
      out = await rectifyLabReport(report.id, signature === "advanced" ? { ...body, totp: code } : body);
    } catch (err) {
      const why = errorCode(err);
      if (why === "invalid_transition") { onConflict(labError(err)); return; }
      if (why === "icp_required" && available) setChosen("icp");
      if (why === "signature_unavailable") {
        setIcpRefused(true);
        setError(onlyIcp(council) ? NO_ICP_FOR_DOCTOR : labError(err));
        return;
      }
      setError(labError(err));
      return;
    } finally { guard.end(); }
    onDone(out);
  }

  return (
    <section aria-label={`Retificar laudo v${report.version}`} style={box}>
      <p style={muted}>O laudo atual fica marcado como substituído; o exame volta para a ciência de quem pediu.</p>
      <fieldset style={fieldset}>
        <legend style={legend}>Exames do laudo novo</legend>
        {released.map((i) => (
          <label key={i.id} style={checkLabel}>
            <input type="checkbox" checked={itemIds.includes(i.id)}
              onChange={(e) => setItemIds((l) => (e.target.checked ? [ ...l, i.id ] : l.filter((x) => x !== i.id)))} />
            {i.label}
          </label>
        ))}
      </fieldset>
      <label style={fieldLabel}>
        Motivo da retificação
        <textarea value={reason} rows={3} style={inputStyle} onChange={(e) => setReason(e.target.value)} />
      </label>
      {contacts.map((c, i) => (
        <fieldset key={i} role="group" aria-label={`Contato ${i + 1}`} style={fieldset}>
          <legend style={legend}>{`Contato ${i + 1}`}</legend>
          <label style={fieldLabel}>Quem foi avisado<input value={c.person} style={inputStyle} onChange={(e) => setContact(i, { person: e.target.value })} /></label>
          <label style={fieldLabel}>
            Como
            <select value={c.channel} style={inputStyle} onChange={(e) => setContact(i, { channel: e.target.value as ContactDraft["channel"] })}>
              <option value="">—</option>
              {CHANNEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>Quando<input type="datetime-local" value={c.at} style={inputStyle} onChange={(e) => setContact(i, { at: e.target.value })} /></label>
          <div><button type="button" style={secondaryButtonStyle} onClick={() => setContacts((l) => l.filter((_, j) => j !== i))}>Tirar contato</button></div>
        </fieldset>
      ))}
      <div>
        <button type="button" style={secondaryButtonStyle}
          onClick={() => setContacts((l) => [ ...l, { person: "", channel: "", at: cityNowLocal() } ])}>Incluir contato</button>
      </div>
      <SignatureChoice council={council} kind={signature} onKind={(k) => { if (k === "icp") setTotp(""); setChosen(k); }}
        totp={totp} onTotp={setTotp} icpAvailable={available} />
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <ActionButton busy={guard.busy} onClick={submit} disabledReason={noIcpForDoctor ? "sem assinatura ICP o médico não consegue retificar" : null}>Emitir laudo retificado</ActionButton>
        <button type="button" style={secondaryButtonStyle} disabled={guard.busy} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}
