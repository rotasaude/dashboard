// src/modules/SignaturePending.tsx
// Pendentes de assinatura (módulo 19b; spec §5 "Lote" e §9; contrato §5): o
// que espera a assinatura digital do próprio profissional, "Assinar todas"
// (lote de até 50, pelo prestador) e "Voltar ao papel" (motivo ≥ 10). O api
// confere autor e estado; a tela relê a lista quando o mundo mudou.
import { useState, type CSSProperties, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorCode, returnToPaper, startSignatureBatch, type SignatureRequest } from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { fmtDateTime } from "../lib/format";
import { CONSULTATION_KEY } from "../lib/consultation";
import {
  BATCH_LIMIT, PENDING_KEY, RETURNED_TO_PAPER, RETURN_TO, SIGNATURE_DISABLED, canSign, documentLabel, goToProvider,
  SIMULATED_NOTICE, reasonLabel, returnToPaperProblem, signatureError, usesSimulatedPsc
} from "../lib/signature";
import { usePendingSignatures } from "../hooks/usePendingSignatures";
import type { ModuleId } from "../shell/modules";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";

const EMPTY = "nenhum documento esperando a sua assinatura";
const BATCH_NOTE = `cada lote assina até ${BATCH_LIMIT} documentos, os mais antigos primeiro — depois do retorno, clique de novo para os demais`;

interface Props {
  onNavigate(id: ModuleId): void;
  redirect?(url: string): void;
}

export function SignaturePending({ onNavigate, redirect = goToProvider }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const allowed = canSign(user);
  const pending = usePendingSignatures(allowed);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ failure, setFailure ] = useState<{ text: string; linkCertificate: boolean } | null>(null);
  const [ paperFor, setPaperFor ] = useState<SignatureRequest | null>(null);

  const batch = useMutation({
    mutationFn: () => startSignatureBatch(RETURN_TO.pending),
    onMutate: () => { setNotice(null); setFailure(null); },
    onSuccess: ({ authorize_url }) => redirect(authorize_url),
    onError: (err) => {
      const code = errorCode(err);
      if (code === "nothing_pending") {
        setNotice(signatureError(err));
        void queryClient.invalidateQueries({ queryKey: [ PENDING_KEY ] });
        return;
      }
      setFailure({ text: signatureError(err), linkCertificate: code === "certificate_not_linked" });
    }
  });

  if (!allowed) {
    return (
      <div style={page}>
        <PageHeader title="Pendentes de assinatura" sub="atendimento · assinatura digital" />
        <EmptyState title={hasFeature(user, "digital_signature") ? "só profissionais de saúde assinam documentos" : SIGNATURE_DISABLED} />
      </div>
    );
  }

  const items = pending.data ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: [ PENDING_KEY ] });
  }

  const cols: Column<SignatureRequest>[] = [
    { label: "Paciente", w: "2fr", render: (r) => r.patient_display_name ?? "—" },
    { label: "Documento", w: "1fr", render: (r) => documentLabel(r.document_type) },
    { label: "Finalizado em", w: "1.4fr", render: (r) => fmtDateTime(r.finalized_at) },
    { label: "Motivo", w: "2fr", render: (r) => reasonLabel(r.reason_code) },
    { label: "Tentativas", w: "0.8fr", align: "right", render: (r) => String(r.attempts) },
    {
      label: "", w: "1.2fr", render: (r) => (
        <button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setPaperFor(r); }}>Voltar ao papel</button>
      )
    }
  ];

  return (
    <div style={page}>
      <PageHeader title="Pendentes de assinatura" sub="atendimento · assinatura digital" />
      <Panel
        title="Pendentes"
        sub="consultas e adendos que esperam a sua assinatura digital"
        right={(
          <button type="button" disabled={items.length === 0 || batch.isPending}
            style={items.length === 0 || batch.isPending ? disabledButtonStyle : buttonStyle}
            onClick={() => batch.mutate()}>Assinar todas</button>
        )}
      >
        <div style={body}>
          {usesSimulatedPsc(user) && <div><Tag tone="warn" mono={false}>{SIMULATED_NOTICE}</Tag></div>}
          {notice && <p role="status" style={text}>{notice}</p>}
          {failure && (
            <div style={row}>
              <p role="alert" style={alert}>{failure.text}</p>
              {failure.linkCertificate && (
                <button type="button" style={secondaryButtonStyle} onClick={() => onNavigate("signature")}>Vincular certificado</button>
              )}
            </div>
          )}
          {items.length > BATCH_LIMIT && <p style={muted}>{BATCH_NOTE}</p>}
          {pending.isPending && <p style={muted}>carregando…</p>}
          {pending.isError && <p role="alert" style={alert}>{signatureError(pending.error)}</p>}
          {pending.isSuccess && <DataTable cols={cols} rows={items} rowKey={(r) => r.id} empty={EMPTY} />}
          {paperFor && (
            <ReturnToPaperForm
              request={paperFor}
              onDone={() => {
                setPaperFor(null); setNotice(RETURNED_TO_PAPER); refresh();
                void queryClient.invalidateQueries({ queryKey: [ CONSULTATION_KEY ] });
              }}
              onStale={(message) => { setPaperFor(null); setNotice(message); refresh(); }}
              onCancel={() => setPaperFor(null)}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}

function ReturnToPaperForm({ request, onDone, onStale, onCancel }: {
  request: SignatureRequest; onDone(): void; onStale(message: string): void; onCancel(): void;
}) {
  const [ reason, setReason ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const mutation = useMutation({ mutationFn: (text: string) => returnToPaper(request.id, text) });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    const found = returnToPaperProblem(reason);
    if (found) { setProblem(found); return; }
    setProblem(null);
    try {
      await mutation.mutateAsync(reason.trim());
      onDone();
    } catch (err) {
      const code = errorCode(err);
      if (code === "not_pending" || code === "not_author") { onStale(signatureError(err)); return; }
      setProblem(signatureError(err));
    }
  }

  return (
    <section aria-label="Voltar ao papel" style={panel}>
      <strong>{`Voltar ao papel: ${documentLabel(request.document_type)} de ${fmtDateTime(request.finalized_at)}`}</strong>
      <p style={muted}>O documento deixa de esperar a assinatura digital e o impresso volta a ter espaço para assinatura à mão. O motivo fica registrado.</p>
      <form onSubmit={(e) => void submit(e)} style={body}>
        <label style={label}>
          Motivo para voltar ao papel
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={inputStyle} />
        </label>
        {problem && <p role="alert" style={alert}>{problem}</p>}
        <div style={row}>
          <button type="submit" disabled={mutation.isPending} style={mutation.isPending ? disabledButtonStyle : buttonStyle}>
            Confirmar volta ao papel
          </button>
          <button type="button" disabled={mutation.isPending} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </section>
  );
}

const page: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };
const body: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 };
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const text: CSSProperties = { margin: 0, fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
