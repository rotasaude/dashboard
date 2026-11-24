// src/modules/zoonoses/EuthanasiaForm.tsx
// Eutanásia (módulo 35b, F-35.16; contrato §7, §13). Mostra o VETERINÁRIO LOGADO (nome e "CRMV-UF número"), o motivo, a nota (10–1000) e
// a base legal (ao menos uma); `euthanasiaProblems` roda antes. O registro passa por `SensitiveAction` com step-up e vai UMA vez
// (a nota vai só no corpo). `403 veterinarian_required` e `409 already_euthanized`: a frase e UMA releitura do histórico (`onRefused`);
// nunca um reenvio. A eutanásia não se edita nem se apaga: depois do 201 o formulário some e o histórico a mostra só para leitura.
import { useRef, useState } from "react";
import { ZOONOSES_ERROR_CODES } from "../../lib/zoonosesErrors";
import { errorCode, recordEuthanasia, type Euthanasia, type MyProfessional } from "../../lib/api";
import { euthanasiaProblems, vetIdentity, zoonosesError } from "../../lib/zoonoses";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { KeyValue } from "../../components/KeyValue";
import { SensitiveAction } from "../../components/SensitiveAction";
import { box, checkLabel, fieldLabel, fieldset, form, legend, row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { useZooDomains } from "./useZooDomains";

export const EUTHANASIA_DESCRIPTION = "A eutanásia não se edita nem se apaga. O animal passa a morto na data informada.";
const REREAD_CODES = [ "veterinarian_required", "already_euthanized" ];
const OWN = [ "reason", "reason_note", "legal_basis", "performed_on" ];

export function EuthanasiaForm({ animal, me, today, stayId, observationId, onDone, onRefused, onCancel, onGoToSecurity }: {
  animal: { id: string }; me: MyProfessional; today: string;
  // A estada aberta e a observação aberta do animal: o api as liga à eutanásia (a observação só fecha como "eutanasiado" com ela).
  stayId?: string | null; observationId?: string | null;
  onDone(e: Euthanasia): void; onRefused(text: string): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems();
  const [ reason, setReason ] = useState("");
  const [ note, setNote ] = useState("");
  const [ basis, setBasis ] = useState<string[]>([]);
  const [ performedOn, setPerformedOn ] = useState(today);
  const [ confirming, setConfirming ] = useState(false);
  const sending = useRef(false);
  const result = useRef<Euthanasia | null>(null);

  function review(ev: React.FormEvent) {
    ev.preventDefault();
    const problems = euthanasiaProblems({ reason, note, legalBasis: basis, performedOn }, today);
    if (problems.length > 0) { f.show(problems.map(({ path, text }) => ({ path, text }))); return; }
    f.setProblems([]);
    setConfirming(true);
  }

  // Um envio por vez; só a eutanásia que o api devolveu chega ao `onDone` (depois do `SensitiveAction`).
  async function run(): Promise<void> {
    if (sending.current) return;
    sending.current = true;
    try {
      result.current = await recordEuthanasia({
        animal_id: animal.id, performed_on: performedOn, reason, reason_note: note.trim(), legal_basis: basis,
        ...(stayId ? { shelter_stay_id: stayId } : {}), ...(observationId ? { bite_observation_id: observationId } : {})
      });
    } catch (err) {
      if (REREAD_CODES.includes(errorCode(err) ?? "")) onRefused(zoonosesError(err));
      throw err;
    } finally {
      sending.current = false;
    }
  }
  // Só as recusas do módulo; `mfa_required` e sessão vencida seguem com o `SensitiveAction`.
  const translate = (err: unknown): string | null => {
    const code = errorCode(err);
    return code && code !== "mfa_required" && (ZOONOSES_ERROR_CODES as readonly string[]).includes(code) ? zoonosesError(err) : null;
  };

  const toggle = (code: string) => setBasis((b) => (b.includes(code) ? b.filter((x) => x !== code) : [ ...b, code ]));
  const inputs = !confirming;

  return (
    <div style={{ ...form, ...box }}>
      <form ref={f.formRef} noValidate style={form} aria-label="Eutanásia" onSubmit={review}>
        <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Eutanásia</p>
        <KeyValue k="Veterinário" v={vetIdentity(me)} mono={false} />
        <label style={fieldLabel}>
          Motivo
          <select value={reason} disabled={!inputs} style={inputStyle} {...f.aria("reason")} onChange={(e) => { setReason(e.target.value); f.clear("reason"); }}>
            <option value="">escolha</option>
            {(domains?.euthanasia_reasons ?? []).map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
          </select>
        </label>
        {f.errNode("reason")}
        <label style={fieldLabel}>
          Nota do motivo
          <textarea rows={3} value={note} disabled={!inputs} style={inputStyle} {...f.aria("reason_note")}
            onChange={(e) => { setNote(e.target.value); f.clear("reason_note"); }} />
        </label>
        {f.errNode("reason_note")}
        <fieldset style={fieldset} {...f.aria("legal_basis")}>
          <legend style={legend}>Base legal</legend>
          {(domains?.legal_bases ?? []).map((o) => (
            <label key={o.code} style={checkLabel}>
              <input type="checkbox" checked={basis.includes(o.code)} disabled={!inputs} onChange={() => { toggle(o.code); f.clear("legal_basis"); }} />
              {o.label}
            </label>
          ))}
        </fieldset>
        {f.errNode("legal_basis")}
        <label style={fieldLabel}>
          Data da eutanásia
          <input type="date" value={performedOn} disabled={!inputs} style={inputStyle} {...f.aria("performed_on")}
            onChange={(e) => { setPerformedOn(e.target.value); f.clear("performed_on"); }} />
        </label>
        {f.errNode("performed_on")}
        {f.top((p) => OWN.includes(p))}
        {inputs && (
          <div style={row}>
            <button type="submit" style={buttonStyle}>Revisar eutanásia</button>
            <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
          </div>
        )}
      </form>
      {confirming && (
        <SensitiveAction
          title="Registrar eutanásia" description={EUTHANASIA_DESCRIPTION} requiresStepUp confirmLabel="Registrar eutanásia"
          run={run} translateError={translate} onGoToSecurity={onGoToSecurity} onCancel={() => setConfirming(false)}
          onDone={() => { if (result.current) onDone(result.current); }} />
      )}
    </div>
  );
}
