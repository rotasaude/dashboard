// Atestado (módulo 19c; spec §4; contrato §2): afastamento (dias e início) ou
// acompanhante (nome, parentesco, motivo da CLT art. 473, dia opcional no api
// mas aqui sempre enviado). O CID só entra com a autorização do paciente
// marcada aqui — ela fica registrada no documento e no prontuário; o atestado
// de acompanhante nunca leva CID nem dias. As datas aceitam de hoje − 30 a hoje
// (hoje = o da cidade, vem em `today`); `noValidate` deixa a frase da tela, não
// a do navegador, dizer o que está errado. Quem emite o api confere.
import { useRef, useState, type FormEvent } from "react";
import { searchTerminology, type CompanionReason, type SickNoteInput } from "../../lib/api";
import {
  COMPANION_REASON_LABEL, backdateLimits, documentError, sickNoteInput, sickNoteProblem, type SickNoteDraft
} from "../../lib/clinicalDocuments";
import { consultationError } from "../../lib/consultation";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CodeSearch } from "../consultation/CodeSearch";
import { alertStyle, checkLabel, formBox, labelStyle, linkButton, mutedStyle, rowStyle } from "./formStyles";

const CID_LABEL = "CID-10 (opcional, só com autorização do paciente)";

interface Props {
  initial: SickNoteDraft;
  today: string;
  onSubmit(content: SickNoteInput): Promise<void>;
  onCancel(): void;
  busy?: boolean;
  searchDelayMs?: number;
  replacing?: boolean;
}

export function SickNoteForm({ initial, today, onSubmit, onCancel, busy: externalBusy = false, searchDelayMs, replacing }: Props) {
  const [ d, setD ] = useState<SickNoteDraft>(initial);
  const [ ownBusy, setOwnBusy ] = useState(false);
  const inFlight = useRef(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const busy = ownBusy || externalBusy;
  const set = (patch: Partial<SickNoteDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const dateLimits = backdateLimits(today);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || externalBusy) return;
    const found = sickNoteProblem(d, today);
    if (found) { setProblem(found); return; }
    inFlight.current = true;
    setOwnBusy(true); setProblem(null);
    try {
      await onSubmit(sickNoteInput(d));
    } catch (err) {
      setProblem(documentError(err));
    } finally {
      inFlight.current = false;
      setOwnBusy(false);
    }
  }

  return (
    <form aria-label="Atestado" noValidate onSubmit={(e) => void submit(e)} style={formBox}>
      <strong>Atestado</strong>
      {replacing && <p style={mutedStyle}>Substitui o documento cancelado.</p>}
      <div role="radiogroup" aria-label="tipo de atestado" style={rowStyle}>
        <label style={checkLabel}>
          <input type="radio" name="sick-note-type" checked={d.type === "leave"} onChange={() => set({ type: "leave" })} />
          Afastamento
        </label>
        <label style={checkLabel}>
          <input type="radio" name="sick-note-type" checked={d.type === "companion"}
            onChange={() => set({ type: "companion", cid: null, cidAuthorized: false })} />
          Acompanhante
        </label>
      </div>

      {d.type === "leave" ? (
        <>
          <div style={rowStyle}>
            <label style={labelStyle}>
              Dias de afastamento
              <input inputMode="numeric" value={d.days} style={inputStyle} onChange={(e) => set({ days: e.target.value })} />
            </label>
            <label style={labelStyle}>
              Início
              <input type="date" value={d.startOn} {...dateLimits} style={inputStyle} onChange={(e) => set({ startOn: e.target.value })} />
            </label>
          </div>
          {d.cid ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0, fontSize: 12.5 }}>
                <span className="mono">{d.cid.code}</span>{` — ${d.cid.label} `}
                <button type="button" style={linkButton} onClick={() => set({ cid: null, cidAuthorized: false })}>tirar o CID</button>
              </p>
              <label style={checkLabel}>
                <input type="checkbox" checked={d.cidAuthorized} onChange={(e) => set({ cidAuthorized: e.target.checked })} />
                O paciente autorizou o CID no atestado
              </label>
              <p style={mutedStyle}>A autorização fica registrada no documento e no prontuário.</p>
            </div>
          ) : (
            <CodeSearch label={CID_LABEL} queryKey="terminologySearch:cid10" search={(term) => searchTerminology(term, "cid10")}
              onPick={(item) => set({ cid: item, cidAuthorized: false })} errorText={consultationError} delayMs={searchDelayMs} />
          )}
        </>
      ) : (
        <>
          <div style={rowStyle}>
            <label style={labelStyle}>
              Nome do acompanhante
              <input value={d.companionName} style={inputStyle} onChange={(e) => set({ companionName: e.target.value })} />
            </label>
            <label style={labelStyle}>
              Parentesco
              <input value={d.companionKinship} style={inputStyle} onChange={(e) => set({ companionKinship: e.target.value })} />
            </label>
            <label style={labelStyle}>
              Dia do acompanhamento
              <input type="date" value={d.startOn} {...dateLimits} style={inputStyle} onChange={(e) => set({ startOn: e.target.value })} />
            </label>
          </div>
          <label style={labelStyle}>
            Motivo (CLT art. 473)
            <select value={d.companionReason} style={inputStyle}
              onChange={(e) => set({ companionReason: e.target.value as CompanionReason | "" })}>
              <option value="">escolha</option>
              {(Object.keys(COMPANION_REASON_LABEL) as CompanionReason[]).map((r) => (
                <option key={r} value={r}>{COMPANION_REASON_LABEL[r]}</option>
              ))}
            </select>
          </label>
        </>
      )}

      <label style={labelStyle}>
        Observação (opcional)
        <textarea value={d.note} rows={2} maxLength={500} style={inputStyle} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {problem && <p role="alert" style={alertStyle}>{problem}</p>}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle}>Emitir atestado</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
