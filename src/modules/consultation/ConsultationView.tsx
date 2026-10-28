// src/modules/consultation/ConsultationView.tsx
// Consulta finalizada (módulo 19; spec §4 e §7; contratos §4): leitura, adendos
// em ordem, Adendo e Imprimir. Ler pelo GET gera a trilha no api. O PDF é lido
// com a sessão e aberto numa janela nova por um endereço `blob:` (nada do
// conteúdo passa pela URL da aplicação).
import { useEffect, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../lib/auth";
import {
  errorCode, fetchConsultationPdf, getConsultation,
  type Addendum, type Consultation, type ConsultationOptions, type PatientProblem, type RegulationNotSent
} from "../../lib/api";
import { ACTION_LABEL, CONSULTATION_KEY, SOAP_FIELDS, changesLines, codedLabel, consultationError, withAddendum } from "../../lib/consultation";
import { fmtDateTime } from "../../lib/format";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { VitalsList } from "./PatientPanel";
import { AddendumForm } from "./AddendumForm";
import { SignatureMarker } from "../signature/SignatureMarker";
import { canSign, printHint } from "../../lib/signature";
import { hasFeature } from "../../lib/features";
import { ConsultationExamStatus } from "../exams/ConsultationExamStatus";
import { useReveal } from "../../lib/useReveal";
import { RegulationRequestsField } from "./RegulationRequestsField";
import { openGuide } from "../regulation/openGuide";

export interface ConsultationViewProps {
  consultation: Consultation;
  options: ConsultationOptions | null;
  patientProblems: PatientProblem[];
  // "Minhas consultas" (dashboard#12): busca a lista completa ao abrir o adendo.
  loadPatientProblems?: () => Promise<PatientProblem[]>;
  // dashboard#14: false enquanto o atendimento relê a assinatura; fora dele ninguém relê (padrão true).
  signatureSettled?: boolean;
  // Administrador: leitura sem Imprimir e sem Adendo, mesmo que o id coincida.
  readOnly?: boolean;
  searchDelayMs?: number;
  // Módulo 26a (F-26.2): a autora, na consulta finalizada, vê os pedidos de regulação (peça em modo adendo, com a guia).
  regulation?: boolean;
  // `regulation_not_sent` da finalização (só na memória de quem finalizou); depois de um adendo vale o dele.
  notSent?: RegulationNotSent[];
  // O 201 devolve o adendo: quem mostra a consulta o acrescenta sem reler
  // (o api recusa a releitura da autora depois que o atendimento fechou).
  onAddendumAdded(addendum: Addendum): void;
  onClose(): void;
  // Módulo 19b (Ruling R7): a abertura justificada venceu ao ler o que foi assinado.
  onOpeningRequired?(): void;
}

const PDF_URL_TTL_MS = 60_000;
const POPUP_BLOCKED = "o navegador bloqueou a janela nova — permita janelas deste site para imprimir";

export function ConsultationView(props: ConsultationViewProps) {
  const { consultation: c, options } = props;
  const { user } = useAuth();
  // Imprimir e Adendo são só da autora (decide a sessão, não o chamador).
  const isAuthor = !props.readOnly && !!user && user.id === c.author.id;
  // Módulo 21a: na consulta finalizada, cada exame com a situação de agora
  // (não na leitura administrativa, que é só do registro).
  const examTracking = hasFeature(user, "exam_tracking") && !props.readOnly && c.status === "finalized";
  // dashboard#14: "veja Pendentes" só para quem assina esta consulta (a autora com assinatura digital).
  const linkToPending = isAuthor && canSign(user);
  const [ adding, setAdding ] = useState(false);
  const [ printing, setPrinting ] = useState(false);
  const [ printError, setPrintError ] = useState<string | null>(null);
  const [ notSent, setNotSent ] = useState<RegulationNotSent[]>(props.notSent ?? []);
  const [ regulationKey, setRegulationKey ] = useState(0);
  const showRegulation = !!props.regulation && isAuthor && c.status === "finalized";
  // Abre à vista, com o foco no título (AT-07).
  const revealRef = useReveal<HTMLElement>(true);
  const conductLabel = (code: string) => codedLabel(options?.conducts, code);
  const addenda = [ ...(c.addenda ?? []) ].sort((a, b) => a.created_at.localeCompare(b.created_at));
  // Módulo 19b: como sai o impresso (o api escolhe; contrato 19b §6).
  const hint = printHint(c.signature, addenda.length > 0);

  async function print() {
    if (printing) return;
    setPrinting(true); setPrintError(null);
    // Aberta no clique: depois de um await, o navegador trataria como pop-up.
    const win = window.open("", "_blank");
    try {
      const blob = await fetchConsultationPdf(c.id);
      if (!win) { setPrintError(POPUP_BLOCKED); return; }
      const url = URL.createObjectURL(blob);
      win.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), PDF_URL_TTL_MS);
    } catch (err) {
      win?.close();
      setPrintError(consultationError(err));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <section ref={revealRef} aria-label="Consulta finalizada" style={panel}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{`Consulta de ${fmtDateTime(c.finalized_at)}`}</h3>
        <span style={muted}>{`${c.author.name} · ${codedLabel(options?.care_types, c.care_type)}`}</span>
      </div>
      {c.signature && (
        <SignatureMarker label="assinatura da consulta" block={c.signature} settled={props.signatureSettled ?? true} linkToPending={linkToPending} readOnly={props.readOnly} consultationId={c.id}
          onOpeningRequired={props.onOpeningRequired} />
      )}
      {hint && <p style={muted}>{hint}</p>}

      {SOAP_FIELDS.map((f) => c[f.key] ? (
        <div key={f.key} style={block}>
          <strong style={sub}>{f.label}</strong>
          <p style={textStyle}>{c[f.key]}</p>
        </div>
      ) : null)}

      <VitalsList vitals={c.vitals ?? {}} label="sinais vitais da consulta" />

      {c.evaluated_problems.length > 0 && (
        <ul aria-label="problemas avaliados" style={list}>
          {c.evaluated_problems.map((p) => (
            <li key={`${p.terminology}:${p.code}`}>{`${p.code} — ${p.label} · ${ACTION_LABEL[p.action]}`}</li>
          ))}
        </ul>
      )}
      <p style={textStyle}>{`Condutas: ${c.conducts.map(conductLabel).join(" · ") || "—"}`}</p>
      {c.exam_requests.length > 0 && (examTracking
        ? <ConsultationExamStatus consultationId={c.id} requests={c.exam_requests} />
        : (
          <ul aria-label="exames solicitados" style={list}>
            {c.exam_requests.map((e) => (
              <li key={e.sigtap_code}>
                {`${e.sigtap_code} — ${e.label}${e.cid10_justification ? ` · CID-10 ${e.cid10_justification}` : ""}`}
              </li>
            ))}
          </ul>
        ))}

      {showRegulation && (
        <RegulationRequestsField consultationId={c.id} cbo={c.cbo_code} cid10Allowed={options?.cid10_allowed_for_cbo ?? false}
          mode="addendum" searchDelayMs={props.searchDelayMs} refreshKey={regulationKey} notSent={notSent}
          onOpenGuide={async (id) => { const out = await openGuide(id); return out.ok ? null : out.text; }} />
      )}

      {addenda.length > 0 && (
        <ol aria-label="adendos" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          {addenda.map((a) => (
            <li key={a.id} style={{ fontSize: 12.5 }}>
              <strong>{`Adendo de ${a.author_name} em ${fmtDateTime(a.created_at)}`}</strong>
              {a.signature && (
                <SignatureMarker label="assinatura do adendo" block={a.signature} settled={props.signatureSettled ?? true} linkToPending={linkToPending} readOnly={props.readOnly} consultationId={c.id}
                  onOpeningRequired={props.onOpeningRequired} />
              )}
              <p style={textStyle}>{`Motivo: ${a.reason}`}</p>
              <p style={textStyle}>{a.text}</p>
              {changesLines(a.changes, conductLabel).map((line) => <p key={line} style={textStyle}>{line}</p>)}
            </li>
          ))}
        </ol>
      )}

      {printError && <p role="alert" style={alert}>{printError}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        {isAuthor && (
          <button type="button" disabled={printing} style={printing ? disabledButtonStyle : buttonStyle} onClick={() => void print()}>
            Imprimir
          </button>
        )}
        {isAuthor && !adding && (
          <button type="button" style={secondaryButtonStyle} onClick={() => setAdding(true)}>Adendo</button>
        )}
        <button type="button" style={secondaryButtonStyle} onClick={props.onClose}>Fechar painel</button>
      </div>

      {adding && (
        <AddendumForm consultation={c} options={options} patientProblems={props.patientProblems}
          loadPatientProblems={props.loadPatientProblems}
          searchDelayMs={props.searchDelayMs} examPriority={hasFeature(user, "exam_tracking")}
          onDone={(addendum) => {
            setAdding(false);
            // Os rascunhos seguiram (ou não) com o adendo: relê a peça e troca os avisos pelos dele (vazio se tudo foi).
            setNotSent(addendum.regulation_not_sent ?? []); setRegulationKey((k) => k + 1);
            props.onAddendumAdded(addendum);
          }}
          onCancel={() => setAdding(false)} />
      )}
    </section>
  );
}

type LoaderProps = Omit<ConsultationViewProps, "consultation" | "onAddendumAdded"> & {
  id: string;
  // Só a leitura justificada: sem a abertura, o api responde 403 out_of_context.
  endOnOutOfContext?: boolean;
  onAddendumAdded?(addendum: Addendum): void;
};

export function ConsultationLoader({ id, onAddendumAdded, endOnOutOfContext, onOpeningRequired, ...rest }: LoaderProps) {
  const queryClient = useQueryClient();
  // Sem nova tentativa: um 403 opening_required encerra a abertura na hora.
  const query = useQuery({
    queryKey: [ CONSULTATION_KEY, id ], queryFn: () => getConsultation(id), gcTime: 0, staleTime: 0, retry: false
  });
  const code = query.isError ? errorCode(query.error) : null;
  const openingGone = code === "opening_required" || (!!endOnOutOfContext && code === "out_of_context");

  useEffect(() => {
    if (openingGone) onOpeningRequired?.();
  }, [ openingGone, onOpeningRequired ]);

  if (query.isPending) return <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando a consulta…</p>;
  if (query.isError) return <p role="alert" style={alert}>{consultationError(query.error)}</p>;
  return (
    <ConsultationView consultation={query.data} onOpeningRequired={onOpeningRequired}
      onAddendumAdded={(addendum) => {
        queryClient.setQueryData<Consultation>([ CONSULTATION_KEY, id ], (c) => (c ? withAddendum(c, addendum) : c));
        onAddendumAdded?.(addendum);
      }} {...rest} />
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const block: CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
const sub: CSSProperties = { fontSize: 12 };
const list: CSSProperties = { margin: 0, paddingLeft: 18, fontSize: 12.5 };
const textStyle: CSSProperties = { margin: 0, fontSize: 12.5, whiteSpace: "pre-wrap" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
