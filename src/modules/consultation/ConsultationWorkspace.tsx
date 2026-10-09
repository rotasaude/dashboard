// src/modules/consultation/ConsultationWorkspace.tsx
// Consulta no atendimento chamado (módulo 19; spec §7; contratos §3 e §4): o
// prontuário em contexto (o api confere chamador, CBO e par validado e grava a
// trilha), o rascunho da consulta e a leitura da finalizada. "Iniciar consulta"
// também retoma: o 409 already_exists traz o id do rascunho (Divergência D1).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAttendanceRecord, getConsultation, getConsultationOptions, startConsultation, type Consultation, type HealthUnit
} from "../../lib/api";
import { OPTIONS_KEY, RECORD_KEY, consultationError, existingConsultationId, withAddendum } from "../../lib/consultation";
import { useAuth } from "../../lib/auth";
import { canSign, signatureSettling } from "../../lib/signature";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { PatientPanel } from "./PatientPanel";
import { ConsultationEditor } from "./ConsultationEditor";
import { ConsultationLoader, ConsultationView } from "./ConsultationView";

interface Props {
  attendanceId: string;
  referenceUnitIds?: string[];
  unit: HealthUnit;
  units: HealthUnit[];
  autosaveDelayMs?: number;
  searchDelayMs?: number;
  onClose(): void;
  onFinalized(): void;
}

// Módulo 19b (Ruling R8): logo depois de finalizar ou de um adendo, o bloco
// de assinatura vem "manual sem pedido" até o job rodar; quem pode assinar
// relê a consulta a cada 3 s, até 3 vezes, parando quando o bloco assenta.
export const SIGNATURE_REREAD_MS = 3000;
export const SIGNATURE_REREAD_LIMIT = 3;

export function ConsultationWorkspace(props: Props) {
  const { user } = useAuth();
  const record = useQuery({
    queryKey: [ RECORD_KEY, props.attendanceId ], queryFn: () => getAttendanceRecord(props.attendanceId), gcTime: 0, staleTime: 0
  });
  const options = useQuery({ queryKey: [ OPTIONS_KEY, user?.id ?? null ], queryFn: getConsultationOptions, staleTime: 5 * 60_000 });
  const [ consultation, setConsultation ] = useState<Consultation | null>(null);
  const [ viewing, setViewing ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  // Armada só por finalizar/adendo: abrir uma consulta antiga que ficou à mão não relê.
  const rereads = useRef(SIGNATURE_REREAD_LIMIT);
  const [ rereadTick, setRereadTick ] = useState(0);
  const signer = canSign(user);
  const settling = consultation?.status === "finalized" && signatureSettling(consultation);
  const consultationId = consultation?.id ?? null;

  useEffect(() => {
    if (!signer || !settling || !consultationId || rereads.current >= SIGNATURE_REREAD_LIMIT) return;
    let live = true;
    const timer = setTimeout(async () => {
      rereads.current += 1;
      try {
        const fresh = await getConsultation(consultationId);
        // Um adendo criado enquanto a releitura voava continua na tela.
        if (live) setConsultation((c) => (c?.id === fresh.id ? (c.addenda ?? []).reduce(withAddendum, fresh) : c));
      } catch {
        // Silencioso: fica o que estava (a releitura é só conveniência).
      } finally {
        if (live) setRereadTick((t) => t + 1);
      }
    }, SIGNATURE_REREAD_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [ signer, settling, consultationId, rereadTick ]);

  function restartRereads() {
    rereads.current = 0;
    setRereadTick((t) => t + 1);
  }

  async function open() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      setConsultation(await startConsultation(props.attendanceId));
    } catch (err) {
      const existing = existingConsultationId(err);
      if (!existing) { setError(consultationError(err)); return; }
      try { setConsultation(await getConsultation(existing)); } catch (again) { setError(consultationError(again)); }
    } finally {
      setBusy(false);
    }
  }

  async function reload(message?: string) {
    if (message) setNotice(message);
    if (!consultation) return;
    try { setConsultation(await getConsultation(consultation.id)); } catch (err) { setError(consultationError(err)); }
  }

  return (
    <section aria-label="Consulta do atendimento" style={panel}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <strong style={{ flex: 1 }}>Consulta do atendimento</strong>
        <button type="button" style={secondaryButtonStyle} onClick={props.onClose}>Fechar painel da consulta</button>
      </div>
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {record.isPending && <p className="mono" style={loading}>carregando o prontuário…</p>}
      {record.isError && <p role="alert" style={alert}>{consultationError(record.error)}</p>}

      {record.data && (
        <>
          <PatientPanel record={record.data} onOpenConsultation={setViewing} />
          {viewing && (
            <ConsultationLoader key={viewing} id={viewing} options={options.data ?? null}
              patientProblems={record.data.problems} searchDelayMs={props.searchDelayMs} onClose={() => setViewing(null)} />
          )}

          {!consultation && (
            <div>
              <button type="button" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle} onClick={() => void open()}>
                Iniciar consulta
              </button>
            </div>
          )}

          {consultation?.status === "draft" && options.isError && <p role="alert" style={alert}>{consultationError(options.error)}</p>}
          {consultation?.status === "draft" && options.data && (
            <ConsultationEditor key={consultation.id} consultation={consultation} record={record.data} options={options.data}
              referenceUnitIds={props.referenceUnitIds} unit={props.unit} units={props.units}
              autosaveDelayMs={props.autosaveDelayMs} searchDelayMs={props.searchDelayMs}
              onFinalized={(c) => { setConsultation(c); restartRereads(); props.onFinalized(); }}
              onLocked={(message) => void reload(message)} />
          )}

          {consultation?.status === "finalized" && (
            <ConsultationView consultation={consultation} options={options.data ?? null} patientProblems={record.data.problems}
              searchDelayMs={props.searchDelayMs}
              onAddendumAdded={(addendum) => { setConsultation((c) => (c ? withAddendum(c, addendum) : c)); restartRereads(); }}
              onClose={props.onClose} />
          )}
        </>
      )}
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--rule2)", borderRadius: 8 };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const loading: CSSProperties = { margin: 0, fontSize: 10.5, color: "var(--ink3)" };
