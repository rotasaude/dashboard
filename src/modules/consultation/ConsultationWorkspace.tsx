// src/modules/consultation/ConsultationWorkspace.tsx
// Consulta no atendimento chamado (módulo 19; spec §7; contratos §3 e §4): o
// prontuário em contexto (o api confere chamador, CBO e par validado e grava a
// trilha), o rascunho da consulta e a leitura da finalizada. "Iniciar consulta"
// também retoma: o 409 already_exists traz o id do rascunho (Divergência D1).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAttendanceRecord, getConsultation, getConsultationOptions, getConsultationProblems, startConsultation, type ClinicalRecord,
  type Consultation, type HealthUnit
} from "../../lib/api";
import { OPTIONS_KEY, RECORD_KEY, consultationError, existingConsultationId, withAddendum } from "../../lib/consultation";
import { useAuth } from "../../lib/auth";
import { canSign, signatureSettling } from "../../lib/signature";
import { canUseDocuments } from "../../lib/clinicalDocuments";
import { hasFeature } from "../../lib/features";
import { canSuggestNotification, cboCanNotify } from "../../lib/surveillance";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { SegmentedControl } from "../../shell/SegmentedControl";
import { ConsultationDocuments } from "../documents/ConsultationDocuments";
import { PatientPanel } from "./PatientPanel";
import { MedicationsBlock } from "./MedicationsBlock";
import { ConsultationEditor } from "./ConsultationEditor";
import { ConsultationLoader, ConsultationView } from "./ConsultationView";
import { ProceduresPanel } from "../billing/ProceduresPanel";
import { canUseBilling, unitBills } from "../../lib/billing";

interface Props {
  attendanceId: string;
  referenceUnitIds?: string[];
  unit: HealthUnit;
  units: HealthUnit[];
  autosaveDelayMs?: number;
  searchDelayMs?: number;
  onClose(): void;
  onFinalized(): void;
  onGoToSecurity?(): void;
}

// Módulo 19b (Ruling R8): logo depois de finalizar ou de um adendo, o bloco
// de assinatura vem "manual sem pedido" até o job rodar; quem pode assinar
// relê a consulta a cada 3 s, até 3 vezes, parando quando o bloco assenta.
export const SIGNATURE_REREAD_MS = 3000;
export const SIGNATURE_REREAD_LIMIT = 3;

export function ConsultationWorkspace(props: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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
  // Módulo 19c: documentos clínicos e medicamentos em uso, com o interruptor ligado.
  const documentsOn = canUseDocuments(user);
  // Módulo 20: a aba "Linha do tempo" no painel do paciente, pelo atendimento (em contexto).
  const timelineOn = hasFeature(user, "patient_timeline");
  const examsOn = hasFeature(user, "exam_tracking");
  // Módulo 22: procedimentos realizados no atendimento, nunca na UBS (ADR 0039).
  const proceduresOn = canUseBilling(user) && unitBills(props.unit);
  // Aba Documentos: o editor continua montado (escondido) para o autosave não
  // perder o que foi digitado; os documentos só montam na primeira abertura da
  // aba e depois ficam montados (escondidos), para a volta à Consulta não perder
  // um formulário aberto (ex.: o substituto de "Cancelar e emitir outro").
  const [ tab, setTab ] = useState<"consultation" | "documents">("consultation");
  const [ documentsOpened, setDocumentsOpened ] = useState(false);
  const showTabs = documentsOn && !!consultation;
  const onDocuments = showTabs && tab === "documents";
  const settling = consultation?.status === "finalized" && signatureSettling(consultation);
  const consultationId = consultation?.id ?? null;
  // dashboard#14: esgotadas as releituras (ou nunca armadas), o marcador para de dizer "assinando…".
  const signatureSettled = !settling || rereads.current >= SIGNATURE_REREAD_LIMIT;

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

  // dashboard#13: o atendimento fecha na finalização e o api recusa reler o prontuário por
  // ele; a autora relê só a lista de problemas pela rota da consulta (o api aplica as
  // regras de incluir, reativar, resolver e corrigir). Falhou: o painel fica como estava.
  async function rereadProblems(consultationId: string) {
    try {
      const problems = await getConsultationProblems(consultationId);
      queryClient.setQueryData<ClinicalRecord>([ RECORD_KEY, props.attendanceId ], (current) => (current ? { ...current, problems } : current));
    } catch {
      // Silencioso: é só conveniência; recarregar a tela relê tudo.
    }
  }

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
      // Retomar também é "Iniciar consulta" (o painel só sabe que há rascunho
      // depois do clique): diz que retomou (AT-10).
      try { setConsultation(await getConsultation(existing)); setNotice("Rascunho retomado."); } catch (again) { setError(consultationError(again)); }
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
          <PatientPanel record={record.data} onOpenConsultation={setViewing}
            exams={examsOn ? { patientId: record.data.patient.id, consultationId: consultation?.status === "draft" ? consultation.id : null } : undefined}
            timeline={timelineOn ? { subject: { attendanceId: props.attendanceId }, searchDelayMs: props.searchDelayMs } : undefined}
            besideProblems={documentsOn ? (
            <MedicationsBlock patientId={record.data.patient.id} unitId={props.unit.id} searchDelayMs={props.searchDelayMs}
              draftConsultationId={consultation?.status === "draft" ? consultation.id : null} />
          ) : undefined} />
          {viewing && (
            <ConsultationLoader key={viewing} id={viewing} options={options.data ?? null}
              patientProblems={record.data.problems} searchDelayMs={props.searchDelayMs} onClose={() => setViewing(null)} />
          )}

          {!consultation && (
            <div>
              <button type="button" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle} onClick={() => void open()}>
                Iniciar consulta
              </button>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--ink3)" }}>Se você já começou esta consulta, o seu rascunho abre.</p>
            </div>
          )}

          {showTabs && (
            <SegmentedControl
              options={[ { key: "consultation", label: "Consulta" }, { key: "documents", label: "Documentos" } ]}
              value={tab} onChange={(key) => { setTab(key); if (key === "documents") setDocumentsOpened(true); }} />
          )}

          {/* display: contents não mexe no gap do painel; só vale com a aba Consulta
              aberta (um display no style venceria o hidden). */}
          <div hidden={onDocuments} style={onDocuments ? undefined : { display: "contents" }}>
            {consultation?.status === "draft" && options.isError && <p role="alert" style={alert}>{consultationError(options.error)}</p>}
            {consultation?.status === "draft" && options.data && (
              <ConsultationEditor key={consultation.id} consultation={consultation} record={record.data} options={options.data}
                referenceUnitIds={props.referenceUnitIds} unit={props.unit} units={props.units} examPriority={examsOn}
                notifications={canSuggestNotification(user) && cboCanNotify(consultation.cbo_code)}
                autosaveDelayMs={props.autosaveDelayMs} searchDelayMs={props.searchDelayMs}
                onFinalized={(c) => { setConsultation(c); restartRereads(); void rereadProblems(c.id); props.onFinalized(); }}
                onLocked={(message) => void reload(message)} />
            )}

            {consultation?.status === "finalized" && (
              <ConsultationView consultation={consultation} options={options.data ?? null} patientProblems={record.data.problems}
                signatureSettled={signatureSettled}
                searchDelayMs={props.searchDelayMs}
                onAddendumAdded={(addendum) => {
                  setConsultation((c) => (c ? withAddendum(c, addendum) : c)); restartRereads();
                  void rereadProblems(consultation.id);
                }}
                onClose={props.onClose} />
            )}

            {proceduresOn && (
              <ProceduresPanel unit={props.unit} attendanceId={props.attendanceId} consultationId={consultation?.id ?? null}
                patientId={record.data.patient.id} searchDelayMs={props.searchDelayMs} />
            )}
          </div>

          {showTabs && documentsOpened && consultation && (
            <div hidden={!onDocuments} style={onDocuments ? { display: "contents" } : undefined}>
              <ConsultationDocuments consultationId={consultation.id} searchDelayMs={props.searchDelayMs}
                onGoToSecurity={props.onGoToSecurity} draft={consultation.status === "draft"}
                issue={user?.id === consultation.author.id ? {
                  // O CPF vai mascarado (do prontuário), nunca completo.
                  cboCode: consultation.cbo_code, unitId: props.unit.id, patientCpfMasked: record.data.patient.cpf_masked ?? undefined
                } : undefined} />
            </div>
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
