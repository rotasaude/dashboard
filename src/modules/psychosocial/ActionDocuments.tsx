// Documentos do CAPS (decisão 19; F-31.4; P8, P47, P50, P58): os mesmos formulários do 19c/19d — receita, registro da
// Notificação de papel e atestado — com outro destino (`POST /psychosocial/actions/:id/documents`). O documento fica fora dos
// documentos do wpda, da linha do tempo geral, da lista de medicamentos e do LEDI (api); o atestado sai genérico no impresso, sem
// o nome do CAPS nem a especialidade (P48/P49, montado pelo api). Emite só o médico autor da ação individual com um usuário
// matriculado (a regra final é do api: `not_author`, `prescriber_required`, `already_cancelled`). A notificação é sempre papel,
// sem SNCR; o SNCR só entra na receita digital (api). Lista lida com a ação aberta (`NOMINAL_QUERY`, id do CAPS na chave; o api
// grava a trilha `documents`); sem polling de assinatura — relê ao emitir, ao cancelar e em "Atualizar". Imprimir e cancelar pelas
// rotas do 19 com o `health_unit_id` do CAPS (aceito e ignorado); a coordenação lotada também cancela (P47 E1). Sem link para o
// detalhe da assinatura (`GET /signature/signatures/:id` é 404 para documento do CAPS): o PDF assinado sai pelo Imprimir.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, issuePsyDocument, listPsyActionDocuments, type ClinicalDocument, type PsyAction, type PsyDocumentInput, type PsyUnit,
  type SignatureBlock
} from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { todayInCity } from "../../lib/campaigns";
import { documentError, documentSituation, emptySickNote, issueModeLabel, kindLabel, withDocument } from "../../lib/clinicalDocuments";
import {
  SNCR_SIMULATED_NOTICE, SNCR_STOCK_KEY, controlledIssuedNotice, controlledOn, documentCategory, documentSncr, documentTitle, paperReasonLabel,
  sncrLabel, usesSimulatedSncr
} from "../../lib/controlled";
import { hasFeature } from "../../lib/features";
import { fmtDateTime } from "../../lib/format";
import {
  NOMINAL_QUERY, PSY_ACTIONS_KEY, PSY_DETAIL_KEY, PSY_DOCUMENTS_NOTE, PSY_NOTIFICATION_RECORDED, PSY_NO_DOCUMENTS, canCancelPsyDocument,
  canIssuePsyDocument, psyDocumentError, psyError, type PsyRoles
} from "../../lib/psychosocial";
import { SIMULATED_NOTICE, canSign, signatureMarker } from "../../lib/signature";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { CancelDocument } from "../documents/CancelDocument";
import { NotificationRecordForm } from "../documents/NotificationRecordForm";
import { PrescriptionForm, type ControlledContext } from "../documents/PrescriptionForm";
import { SickNoteForm } from "../documents/SickNoteForm";
import { printDocument } from "../documents/printDocument";
import { alert, muted, okText, row } from "../exams/styles";

export type ActionDocumentsProps = {
  action: PsyAction; unit: PsyUnit; roles: PsyRoles; today?: string; onGoToSecurity?(): void; searchDelayMs?: number;
};

type IssueKind = PsyDocumentInput["kind"];
const START_LABEL: Record<IssueKind, string> = {
  prescription: "Receita", sick_note: "Atestado", controlled_notification_record: "Notificação (papel)"
};

export function ActionDocuments({ action: a, unit, roles, today = todayInCity(), onGoToSecurity, searchDelayMs }: ActionDocumentsProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const key = [ PSY_DETAIL_KEY, unit.id, "action", a.id, "documents" ];
  const docs = useQuery({ queryKey: key, queryFn: () => listPsyActionDocuments(a.id), ...NOMINAL_QUERY });
  const issuer = canIssuePsyDocument(a, userId) && hasFeature(user, "clinical_documents");
  const controlled = controlledOn(user);
  const controlledContext: ControlledContext | undefined = controlled
    ? { userId, simulated: usesSimulatedSncr(user), signatureOn: hasFeature(user, "digital_signature") }
    : undefined;
  const cityUf = user?.memberships?.find((m) => m.city_uf)?.city_uf ?? "";
  const kinds: IssueKind[] = [ "prescription", "sick_note", ...(controlled ? [ "controlled_notification_record" as const ] : []) ];

  // `seq` remonta o formulário a cada abertura (um novo preenchido não herda o anterior).
  const [ form, setForm ] = useState<{ kind: IssueKind; seq: number } | null>(null);
  const seq = useRef(0);
  const [ cancelling, setCancelling ] = useState<ClinicalDocument | null>(null);
  const [ issuing, setIssuing ] = useState(false);
  const sending = useRef(false);
  const [ printing, setPrinting ] = useState<string | null>(null);
  const printingRef = useRef(false);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [ error ]);
  // A resposta que chega depois de fechar a ação não grava nada no cache (a chave já saiu).
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reload = () => { void queryClient.invalidateQueries({ queryKey: key, exact: true }); };
  const put = (doc: ClinicalDocument) => queryClient.setQueryData<ClinicalDocument[]>(key, (list) => withDocument(list ?? [], doc));
  const open = (kind: IssueKind) => {
    seq.current += 1;
    setNotice(null); setError(null); setCancelling(null); setForm({ kind, seq: seq.current });
  };

  // A recusa sobe para o formulário, que a mostra e fica preenchido — exceto a ação que já não aceita documento (cancelada ou
  // sumida noutra aba): fecha, diz e relê a ação, a lista de ações e os documentos.
  async function issue(input: PsyDocumentInput) {
    if (sending.current) return;
    sending.current = true;
    setIssuing(true);
    try {
      const doc = await issuePsyDocument(a.id, input);
      if (!alive.current) return;
      put(doc);
      if (numbered(doc)) void queryClient.invalidateQueries({ queryKey: [ SNCR_STOCK_KEY ] });
      setForm(null);
      setNotice(doc.kind === "controlled_notification_record" ? PSY_NOTIFICATION_RECORDED : controlledIssuedNotice(doc));
    } catch (err) {
      const code = errorCode(err);
      if (code !== "already_cancelled" && code !== "not_found") throw err;
      if (!alive.current) return;
      setForm(null);
      setError(psyError(err));
      void queryClient.invalidateQueries({ queryKey: [ PSY_DETAIL_KEY, unit.id, "action", a.id ], exact: true });
      void queryClient.invalidateQueries({ queryKey: [ PSY_ACTIONS_KEY, unit.id ] });
      reload();
    } finally {
      sending.current = false;
      if (alive.current) setIssuing(false);
    }
  }

  // Uma leitura por vez: a ref barra o duplo clique e os outros Imprimir ficam desligados enquanto ela voa.
  async function print(d: ClinicalDocument) {
    if (printingRef.current) return;
    printingRef.current = true;
    setPrinting(d.id); setNotice(null); setError(null);
    let stale = false;
    const problem = await printDocument(d.id, (err) => {
      stale = errorCode(err) === "already_cancelled";
      return documentError(err);
    }, unit.id);
    printingRef.current = false;
    if (!alive.current) return;
    setPrinting(null);
    if (problem) setError(problem);
    if (stale) reload();
  }

  const what = (d: ClinicalDocument) => `${kindLabel(d.kind)} de ${fmtDateTime(d.issued_at)}`;
  const cols: Column<ClinicalDocument>[] = [
    { label: "Documento", w: "1.4fr", card: "title", render: (d) => {
      const sncr = documentSncr(d);
      return (
        <span style={cell}>
          <span>{documentTitle(d)}</span>
          {sncr && <span className="mono" style={small}>{sncrLabel(sncr)}</span>}
          {sncr?.simulated && <Tag tone="warn" mono={false}>{SNCR_SIMULATED_NOTICE}</Tag>}
        </span>
      );
    } },
    { label: "Emitido em", w: "1fr", render: (d) => fmtDateTime(d.issued_at) },
    { label: "Modo", w: "0.7fr", render: (d) => d.issue_mode === "paper" && d.paper_reason ? (
      <span style={cell}>
        <span>{issueModeLabel(d.issue_mode)}</span>
        <span style={small}>{paperReasonLabel(d.paper_reason)}</span>
      </span>
    ) : issueModeLabel(d.issue_mode) },
    { label: "Assinatura", w: "1.4fr", render: (d) => (d.signature
      ? <SignatureState block={d.signature} linkToPending={d.author.id === userId && canSign(user)} />
      : "—") },
    { label: "Situação", w: "1fr", render: (d) => documentSituation(d) },
    { label: "Código", w: "1fr", render: (d) => <span className="mono">{d.short_code ?? "—"}</span> },
    { label: "Ações", w: "auto", align: "right", card: "actions", render: (d) => (
      <span style={actions}>
        {d.status === "issued" && d.kind !== "controlled_notification_record" && (
          <button type="button" aria-label={`Imprimir ${what(d)}`} disabled={printing !== null}
            style={printing !== null ? disabledButtonStyle : secondaryButtonStyle} onClick={() => void print(d)}>
            {printing === d.id ? "Abrindo…" : "Imprimir"}
          </button>
        )}
        {canCancelPsyDocument(d, userId, roles) && (
          <button type="button" aria-label={`Cancelar ${what(d)}`} disabled={issuing}
            style={issuing ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { setForm(null); setNotice(null); setError(null); setCancelling(d); }}>
            Cancelar
          </button>
        )}
      </span>
    ) }
  ];

  return (
    <section aria-label="Documentos da ação" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={row}>
        <strong style={{ fontSize: 13, flex: 1 }}>Documentos</strong>
        <button type="button" style={docs.isFetching ? disabledButtonStyle : secondaryButtonStyle} disabled={docs.isFetching}
          onClick={reload}>
          Atualizar
        </button>
      </div>
      {!issuer && <p style={muted}>{PSY_DOCUMENTS_NOTE}</p>}
      {issuer && !form && !cancelling && (
        <div role="group" aria-label="emitir documento" style={row}>
          {kinds.map((k) => (
            <button key={k} type="button" disabled={issuing} style={issuing ? disabledButtonStyle : secondaryButtonStyle} onClick={() => open(k)}>
              {START_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {notice && <p ref={noticeRef} tabIndex={-1} role="status" style={okText}>{notice}</p>}
      {error && <p ref={errorRef} tabIndex={-1} role="alert" style={alert}>{error}</p>}

      {issuer && form?.kind === "prescription" && (
        <PrescriptionForm key={form.seq} cboCode={a.professional.cbo_code ?? ""} unitId={unit.id} today={today}
          initial={{ items: [], protocolVersionId: "" }} busy={issuing} searchDelayMs={searchDelayMs} controlled={controlledContext}
          errorText={(err) => psyDocumentError(err, { controlled })} onCancel={() => setForm(null)}
          onSubmit={(content) => issue({ kind: "prescription", content })} />
      )}
      {issuer && form?.kind === "sick_note" && (
        <SickNoteForm key={form.seq} initial={emptySickNote(today)} today={today} busy={issuing} searchDelayMs={searchDelayMs}
          errorText={(err) => psyDocumentError(err)} onCancel={() => setForm(null)}
          onSubmit={(content) => issue({ kind: "sick_note", content })} />
      )}
      {issuer && form?.kind === "controlled_notification_record" && (
        <NotificationRecordForm key={form.seq} unitId={unit.id} defaultUf={cityUf} searchDelayMs={searchDelayMs} busy={issuing}
          errorText={(err) => psyDocumentError(err, { controlled: true })} onCancel={() => setForm(null)}
          onSubmit={(content) => issue({ kind: "controlled_notification_record", content })} />
      )}

      {cancelling && (
        <CancelDocument key={cancelling.id} doc={cancelling} healthUnitId={unit.id} reissue={false} onGoToSecurity={onGoToSecurity}
          onDone={(cancelled) => {
            put(cancelled);
            // O número SNCR fica anulado (o SNCR não cancela): o estoque mudou.
            if (documentSncr(cancelled)) void queryClient.invalidateQueries({ queryKey: [ SNCR_STOCK_KEY ] });
            setCancelling(null);
            setNotice("Documento cancelado.");
          }}
          // Outra aba já cancelou: diz e relê.
          onStale={(message) => { setCancelling(null); setError(message); reload(); }}
          onCancel={() => setCancelling(null)} />
      )}

      {docs.isPending && <p className="mono" style={muted}>carregando os documentos…</p>}
      {docs.isError && <p role="alert" style={alert}>{psyDocumentError(docs.error)}</p>}
      {docs.isSuccess && <DataTable<ClinicalDocument> cols={cols} rows={docs.data} rowKey={(d) => d.id} empty={PSY_NO_DOCUMENTS} />}
    </section>
  );
}

// Marcador da assinatura sem abrir o detalhe (404 para documento do CAPS); sem polling, o pendente sem motivo é "aguardando".
function SignatureState({ block, linkToPending }: { block: SignatureBlock; linkToPending: boolean }) {
  const m = signatureMarker(block, { settled: true, linkToPending });
  return (
    <span style={cell}>
      <Tag tone={m.tone}>{m.label}</Tag>
      {m.simulated && <Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag>}
      {m.detail && <span style={small}>{m.detail}</span>}
      {m.link && <a href={m.link.href} style={small}>{m.link.label}</a>}
    </span>
  );
}

// Receita de controle especial ou de antimicrobiano: emitir pode gastar um número do estoque.
function numbered(doc: ClinicalDocument): boolean {
  const category = documentCategory(doc);
  return !!documentSncr(doc) || category === "special_control" || category === "antimicrobial";
}

const cell: CSSProperties = { display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" };
const small: CSSProperties = { margin: 0, fontSize: 10.5, color: "var(--ink3)" };
const actions: CSSProperties = { display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" };
