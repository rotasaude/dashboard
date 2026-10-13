// src/modules/documents/ConsultationDocuments.tsx
// Documentos da consulta (módulo 19c; spec §7 "Consulta" e "Minhas consultas";
// contrato §3–§4): lista com modo, assinatura, situação e código; emitir os
// quatro tipos (pelo CBO da autora; o api confere), "Renovar receita" (não
// para a enfermagem: a renovação não traz protocolo), Imprimir, Cancelar e
// "Cancelar e emitir outro". Sem `issue` (Minhas consultas), só a lista.
// Leitura com gcTime 0; com assinatura pendente, a lista relê a cada 15 s até
// assentar. O modo (digital/papel) é o que o api devolve.
// Módulo 19d (com `controlled_prescriptions`): "Notificação (papel)" para médico
// e dentista; a receita de controle especial e a de antimicrobiano com número
// SNCR; a frase depois de emitir diz o número ou por que saiu em papel (pelo que
// o api devolveu, nunca pela previsão); emitir ou cancelar uma receita numerada
// relê o estoque do SNCR. Sem o interruptor, a aba é a do 19c.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, errorCode, getPrescriptionRenewal, issueDocument, listConsultationDocuments, recordNotification, type ClinicalDocument,
  type DocumentInput, type DocumentKind, type NotificationRecordInput
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { todayInCity } from "../../lib/campaigns";
import { fmtDateTime } from "../../lib/format";
import {
  DOCUMENTS_KEY, MEDICATIONS_KEY, NO_EXAM_REQUESTS, canCancel, documentError, documentSituation, documentsRefetchInterval, emptyDeclaration, emptySickNote,
  issueModeLabel, itemFromPrescription, kindLabel, kindsFor, professionalKind, reissueDraft, withDocument, type ReissueDraft
} from "../../lib/clinicalDocuments";
import { SIMULATED_NOTICE, usesSimulatedPsc } from "../../lib/signature";
import { hasFeature } from "../../lib/features";
import {
  SNCR_SIMULATED_NOTICE, SNCR_STOCK_KEY, controlledIssuedNotice, controlledOn, documentCategory, documentSncr, documentTitle,
  paperReasonLabel, prescribesControlled, sncrLabel, usesSimulatedSncr
} from "../../lib/controlled";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { SignatureMarker } from "../signature/SignatureMarker";
import { SickNoteForm } from "./SickNoteForm";
import { DeclarationForm } from "./DeclarationForm";
import { PrescriptionForm, type ControlledContext } from "./PrescriptionForm";
import { NotificationRecordForm } from "./NotificationRecordForm";
import { ExamRequisitionForm } from "./ExamRequisitionForm";
import { CancelDocument } from "./CancelDocument";
import { printDocument } from "./printDocument";

// patientCpfMasked: módulo 19d (identificação do paciente na receita de
// controle especial) — sempre o mascarado do prontuário, nunca o CPF completo.
export interface IssueContext { cboCode: string; unitId?: string; patientCpfMasked?: string }

interface Props {
  consultationId: string;
  // Sem `issue`: só a lista (Minhas consultas) — Imprimir e Cancelar.
  issue?: IssueContext;
  // Consulta ainda em rascunho: a requisição de exames só lê os exames da consulta finalizada (ou de adendos).
  draft?: boolean;
  searchDelayMs?: number;
  onGoToSecurity?(): void;
}

// `seq` remonta o formulário a cada abertura (um novo preenchido não herda o anterior).
type OpenForm = ReissueDraft & { replaces?: string; seq: number };

const START_LABEL: Record<DocumentKind, string> = {
  sick_note: "Atestado", attendance_declaration: "Declaração", prescription: "Receita", exam_requisition: "Requisição de exames"
};

// Outro substituto do mesmo cancelado já saiu (outra aba): 422 invalid_content
// com field replaces_document_id. Mesmo tratamento do 409 already_cancelled.
function isStaleReplacement(err: unknown): boolean {
  return errorCode(err) === "invalid_content" && err instanceof ApiError
    && (err.body as { field?: unknown } | null)?.field === "replaces_document_id";
}

export function ConsultationDocuments({ consultationId, issue, draft, searchDelayMs, onGoToSecurity }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = [ DOCUMENTS_KEY, consultationId ];
  const query = useQuery({
    queryKey: key, queryFn: () => listConsultationDocuments(consultationId), gcTime: 0, retry: false,
    refetchInterval: (q) => documentsRefetchInterval(q.state.data)
  });
  const [ form, setForm ] = useState<OpenForm | null>(null);
  const seq = useRef(0);
  const [ cancelling, setCancelling ] = useState<{ doc: ClinicalDocument; reissue: boolean } | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ renewing, setRenewing ] = useState(false);
  const [ issuing, setIssuing ] = useState(false);
  const issuingRef = useRef(false);
  const [ printing, setPrinting ] = useState<string | null>(null);
  const printingRef = useRef(false);
  const today = todayInCity();
  const kinds = issue ? kindsFor(issue.cboCode) : [];
  const canRenew = !!issue && kinds.includes("prescription") && professionalKind(issue.cboCode) !== "nurse";
  // Módulo 19d.
  const controlled = controlledOn(user);
  const canNotify = !!issue && controlled && prescribesControlled(issue.cboCode);
  const [ notifying, setNotifying ] = useState(false);
  const cityUf = user?.memberships?.find((m) => m.city_uf)?.city_uf ?? "";
  const controlledContext: ControlledContext | undefined = issue && controlled ? {
    userId: user?.id ?? null, simulated: usesSimulatedSncr(user), signatureOn: hasFeature(user, "digital_signature"),
    consultationId, patientCpfMasked: issue.patientCpfMasked
  } : undefined;
  const refusal = (err: unknown) => documentError(err, { controlled });

  function open(next: ReissueDraft & { replaces?: string }) {
    seq.current += 1;
    setNotifying(false);
    setNotice(null); setError(null); setCancelling(null); setForm({ ...next, seq: seq.current });
  }

  // Toda ação que trocaria o formulário aberto pergunta antes de descartar
  // (AT-06, I2): outro tipo, o mesmo tipo de novo, Renovar, Notificação e o
  // Cancelar da linha. A tela não sabe se ele foi preenchido.
  const [ switching, setSwitching ] = useState<(() => void) | null>(null);
  function guarded(action: () => void) {
    if (issuingRef.current) return;
    if (form) { setSwitching(() => action); return; }
    action();
  }
  function start(kind: DocumentKind) {
    guarded(() => openKind(kind));
  }

  function openKind(kind: DocumentKind) {
    if (kind === "sick_note") open({ kind, draft: emptySickNote(today) });
    else if (kind === "attendance_declaration") open({ kind, draft: emptyDeclaration(today) });
    else if (kind === "prescription") open({ kind, draft: { items: [], protocolVersionId: "" } });
    else open({ kind, draft: { note: "" } });
  }

  async function renew() {
    if (renewing || issuingRef.current) return;
    setRenewing(true); setNotice(null); setError(null);
    try {
      const items = await getPrescriptionRenewal(consultationId);
      if (items.length === 0) { setForm(null); setNotice("nenhum medicamento de uso contínuo ativo para renovar"); return; }
      open({ kind: "prescription", draft: { items: items.map(itemFromPrescription), protocolVersionId: "" } });
    } catch (err) {
      setError(refusal(err));
    } finally {
      setRenewing(false);
    }
  }

  // A recusa sobe para o formulário, que a mostra e fica preenchido — exceto o
  // substituto concorrente: fecha, diz e relê (não deixa um substituto órfão aberto).
  async function issueIt(input: DocumentInput) {
    if (issuingRef.current) return;
    issuingRef.current = true;
    setIssuing(true);
    try {
      const doc = await issueDocument(consultationId, input, form?.replaces);
      queryClient.setQueryData<ClinicalDocument[]>(key, (list) => withDocument(list ?? [], doc));
      if (doc.kind === "prescription") void queryClient.invalidateQueries({ queryKey: [ MEDICATIONS_KEY ] });
      // Receita de controle especial ou de antimicrobiano (com número ou não): o estoque pode ter mudado.
      if (numbered(doc)) void queryClient.invalidateQueries({ queryKey: [ SNCR_STOCK_KEY ] });
      setForm(null);
      setNotice(controlledIssuedNotice(doc));
    } catch (err) {
      if (!isStaleReplacement(err)) throw err;
      setForm(null);
      setError(refusal(err));
      void queryClient.invalidateQueries({ queryKey: key });
    } finally {
      issuingRef.current = false;
      setIssuing(false);
    }
  }

  // Uma leitura por vez: a ref barra o duplo clique rápido e os outros
  // Imprimir ficam desligados enquanto ela voa.
  async function print(doc: ClinicalDocument) {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(doc.id); setError(null);
    let stale = false;
    const problem = await printDocument(doc.id, (err) => {
      stale = errorCode(err) === "already_cancelled";
      return documentError(err);
    });
    printingRef.current = false;
    setPrinting(null);
    if (problem) setError(problem);
    // Outra aba cancelou: a frase diz "a lista foi atualizada" — então relê.
    if (stale) void queryClient.invalidateQueries({ queryKey: key });
  }

  function askCancel(doc: ClinicalDocument, reissue: boolean) {
    if (issuingRef.current) return;
    setNotifying(false);
    setForm(null); setNotice(null); setError(null);
    setCancelling({ doc, reissue });
  }

  function startNotification() {
    if (issuingRef.current) return;
    setNotice(null); setError(null); setCancelling(null); setForm(null); setNotifying(true);
  }

  // Mesma trava do emitir (estado + ref). A recusa sobe para o formulário, que
  // a mostra e fica preenchido.
  async function recordIt(content: NotificationRecordInput) {
    if (issuingRef.current) return;
    issuingRef.current = true;
    setIssuing(true);
    try {
      const doc = await recordNotification(consultationId, content);
      queryClient.setQueryData<ClinicalDocument[]>(key, (list) => withDocument(list ?? [], doc));
      void queryClient.invalidateQueries({ queryKey: [ MEDICATIONS_KEY ] });
      setNotifying(false);
      setNotice(controlledIssuedNotice(doc));
    } finally {
      issuingRef.current = false;
      setIssuing(false);
    }
  }

  const what = (d: ClinicalDocument) => `${kindLabel(d.kind)} de ${fmtDateTime(d.issued_at)}`;
  const cols: Column<ClinicalDocument>[] = [
    { label: "Documento", w: "1.4fr", render: (d) => {
      const sncr = documentSncr(d);
      return (
        <span style={cell}>
          <span>{`${documentTitle(d)}${d.replaces_document_id ? " · substitui um cancelado" : ""}`}</span>
          {sncr && <span className="mono" style={muted}>{sncrLabel(sncr)}</span>}
          {sncr?.simulated && <Tag tone="warn" mono={false}>{SNCR_SIMULATED_NOTICE}</Tag>}
        </span>
      );
    } },
    { label: "Emitido em", w: "1fr", render: (d) => fmtDateTime(d.issued_at) },
    // Em papel com motivo, o motivo (de todo documento); voltou ao papel (motivo nulo): só "papel".
    { label: "Modo", w: "0.6fr", render: (d) => d.issue_mode === "paper" && d.paper_reason ? (
      <span style={cell}>
        <span>{issueModeLabel(d.issue_mode)}</span>
        <span style={muted}>{paperReasonLabel(d.paper_reason)}</span>
      </span>
    ) : issueModeLabel(d.issue_mode) },
    { label: "Assinatura", w: "1.6fr", render: (d) => d.signature
      ? <SignatureMarker label={`assinatura: ${kindLabel(d.kind)}`} block={d.signature} consultationId={consultationId}
        onVerified={() => void queryClient.invalidateQueries({ queryKey: key })} />
      : "—" },
    { label: "Situação", w: "1fr", render: (d) => documentSituation(d) },
    { label: "Código", w: "1fr", render: (d) => <span className="mono">{d.short_code ?? "—"}</span> },
    { label: "", w: "auto", align: "right", render: (d) => (
      <span style={actions}>
        {d.status === "issued" && d.kind !== "controlled_notification_record" && (
          <button type="button" aria-label={`Imprimir ${what(d)}`} disabled={printing !== null}
            style={printing !== null ? disabledButtonStyle : secondaryButtonStyle} onClick={() => void print(d)}>
            {printing === d.id ? "Abrindo…" : "Imprimir"}
          </button>
        )}
        {canCancel(d, user?.id) && (
          <button type="button" aria-label={`Cancelar ${what(d)}`} disabled={issuing}
            style={issuing ? disabledButtonStyle : secondaryButtonStyle} onClick={() => guarded(() => askCancel(d, false))}>Cancelar</button>
        )}
        {issue && canCancel(d, user?.id) && d.kind !== "controlled_notification_record" && (
          <button type="button" aria-label={`Cancelar e emitir outro: ${what(d)}`} disabled={issuing}
            style={issuing ? disabledButtonStyle : secondaryButtonStyle} onClick={() => guarded(() => askCancel(d, true))}>Cancelar e emitir outro</button>
        )}
      </span>
    ) }
  ];

  // Sem formulário aberto, a pergunta de descartar não faz sentido.
  useEffect(() => { if (!form) setSwitching(null); }, [ form ]);

  // O resultado da emissão recebe o foco, perto de onde se clicou (AT-07).
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [ error ]);

  return (
    <section aria-label="Documentos da consulta" style={panel}>
      {usesSimulatedPsc(user) && <div><Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag></div>}
      {issue && (
        <div role="group" aria-label="emitir documento" style={row}>
          {kinds.map((k) => {
            const off = issuing || (draft && k === "exam_requisition");
            return (
              <button key={k} type="button" disabled={off} style={off ? disabledButtonStyle : secondaryButtonStyle}
                onClick={() => start(k)}>{START_LABEL[k]}</button>
            );
          })}
          {canRenew && (
            <button type="button" disabled={renewing || issuing} style={renewing || issuing ? disabledButtonStyle : buttonStyle}
              onClick={() => guarded(() => void renew())}>
              Renovar receita
            </button>
          )}
          {canNotify && (
            <button type="button" disabled={issuing} style={issuing ? disabledButtonStyle : secondaryButtonStyle}
              onClick={() => guarded(startNotification)}>Notificação (papel)</button>
          )}
        </div>
      )}
      {issue && draft && kinds.includes("exam_requisition") && <p style={mutedStyle}>{NO_EXAM_REQUESTS}</p>}
      {switching && (
        <div role="group" aria-label="Descartar o formulário em edição?" style={row}>
          <span>Descartar o formulário em edição?</span>
          <button type="button" style={buttonStyle} onClick={() => { if (issuingRef.current) return; const run = switching; setSwitching(null); run(); }}>Descartar e abrir</button>
          <button type="button" style={secondaryButtonStyle} onClick={() => setSwitching(null)}>Cancelar</button>
        </div>
      )}
      {notice && <p ref={noticeRef} tabIndex={-1} role="status" style={statusStyle}>{notice}</p>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" style={alert}>{error}</p>}

      {issue && form?.kind === "sick_note" && (
        <SickNoteForm key={form.seq} initial={form.draft} today={today} replacing={!!form.replaces} busy={issuing}
          searchDelayMs={searchDelayMs} onCancel={() => setForm(null)} onSubmit={(content) => issueIt({ kind: "sick_note", content })} />
      )}
      {issue && form?.kind === "attendance_declaration" && (
        <DeclarationForm key={form.seq} initial={form.draft} replacing={!!form.replaces} busy={issuing} onCancel={() => setForm(null)}
          onSubmit={(content) => issueIt({ kind: "attendance_declaration", content })} />
      )}
      {issue && form?.kind === "prescription" && (
        <PrescriptionForm key={form.seq} cboCode={issue.cboCode} unitId={issue.unitId} today={today} initial={form.draft}
          replacing={!!form.replaces} busy={issuing} searchDelayMs={searchDelayMs} onCancel={() => setForm(null)}
          controlled={controlledContext}
          onSubmit={(content) => issueIt({ kind: "prescription", content })} />
      )}
      {issue && form?.kind === "exam_requisition" && (
        <ExamRequisitionForm key={form.seq} initialNote={form.draft.note} replacing={!!form.replaces} busy={issuing}
          onCancel={() => setForm(null)} onSubmit={(content) => issueIt({ kind: "exam_requisition", content })} />
      )}
      {issue && notifying && (
        <NotificationRecordForm unitId={issue.unitId} defaultUf={cityUf} searchDelayMs={searchDelayMs} busy={issuing}
          onCancel={() => setNotifying(false)} onSubmit={recordIt} />
      )}

      {cancelling && (
        <CancelDocument
          key={`${cancelling.doc.id}:${cancelling.reissue}`}
          doc={cancelling.doc}
          reissue={cancelling.reissue}
          onGoToSecurity={onGoToSecurity}
          onDone={(cancelledDoc) => {
            queryClient.setQueryData<ClinicalDocument[]>(key, (list) => withDocument(list ?? [], cancelledDoc));
            // O número SNCR fica anulado (o SNCR não cancela): o estoque mudou.
            if (documentSncr(cancelledDoc)) void queryClient.invalidateQueries({ queryKey: [ SNCR_STOCK_KEY ] });
            const next = cancelling.reissue ? reissueDraft(cancelledDoc) : null;
            setCancelling(null);
            if (next) open({ ...next, replaces: cancelledDoc.id });
            setNotice(next ? "Documento cancelado. Confira os dados e emita o novo." : "Documento cancelado.");
          }}
          // Outra aba já cancelou: diz, relê e NÃO abre o novo preenchido.
          onStale={(message) => {
            setCancelling(null);
            setError(message);
            void queryClient.invalidateQueries({ queryKey: key });
          }}
          onCancel={() => setCancelling(null)}
        />
      )}

      {query.isPending && <p className="mono" style={muted}>carregando os documentos…</p>}
      {query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
      {query.isSuccess && (
        <DataTable cols={cols} rows={query.data} rowKey={(d) => d.id} empty="nenhum documento emitido nesta consulta" />
      )}
    </section>
  );
}

// Receita de controle especial ou de antimicrobiano: emitir pode gastar um número do estoque.
function numbered(doc: ClinicalDocument): boolean {
  const category = documentCategory(doc);
  return !!documentSncr(doc) || category === "special_control" || category === "antimicrobial";
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10 };
const row: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };
const actions: CSSProperties = { display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" };
const mutedStyle: CSSProperties = { margin: 0, fontSize: 12.5, opacity: 0.8 };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
const muted: CSSProperties = { margin: 0, fontSize: 10.5, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const cell: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" };
