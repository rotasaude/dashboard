import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmErasure, listPendingErasures, rejectErasure, type PendingErasure } from "../../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError } from "../../lib/attendance";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { RETAINED_MESSAGE } from "./ErasureRequest";

// Pedidos de exclusão pendentes (ADR 0026), só para municipal_admin. Confirmar
// apaga de vez e passa pelo step-up (SensitiveAction); quem registrou o pedido
// não o confirma (own_request, recusado pela API).
const KEY = [ "erasureRequests" ];
const ERRORS = [ "own_request", "not_pending", "try_again" ];

export function ErasureRequests({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: listPendingErasures, refetchInterval: ATTENDANCE_REFETCH_MS });
  const [ confirming, setConfirming ] = useState<PendingErasure | null>(null);
  const [ rejecting, setRejecting ] = useState<PendingErasure | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const outcome = useRef<string>("");

  const reload = () => void queryClient.invalidateQueries({ queryKey: KEY });

  return (
    <Panel title="Pedidos de exclusão" sub="aguardando confirmação do administrador">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {query.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>}
        {done && <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{done}</p>}

        {query.data && (
          query.data.requests.length === 0 ? <EmptyState title="nenhum pedido pendente" /> : (
            <DataTable<PendingErasure>
              cols={[
                { label: "Data", w: "1fr", render: (r) => fmtDateTime(r.created_at) },
                { label: "Pedido por", w: "1.5fr", render: (r) => <span className="mono">{r.requested_by}</span> },
                { label: "Cadastros", w: "0.7fr", render: (r) => String(r.pairs) },
                { label: "Celular", w: "1fr", render: (r) => r.phone_masked },
                {
                  label: "", w: "auto", align: "right", render: (r) => (
                    <span style={{ display: "flex", gap: 8 }}>
                      <button type="button" style={buttonStyle} onClick={() => { setDone(null); setRejecting(null); setConfirming(r); }}>Confirmar exclusão</button>
                      <button type="button" style={secondaryButtonStyle} onClick={() => { setDone(null); setConfirming(null); setRejecting(r); }}>Recusar</button>
                    </span>
                  )
                }
              ]}
              rows={query.data.requests}
              rowKey={(r) => r.id}
            />
          )
        )}

        {confirming && (
          <SensitiveAction
            key={confirming.id}
            title="Confirmar exclusão"
            description="A exclusão é irreversível. O cadastro deste cidadão será apagado."
            requiresStepUp
            run={async () => {
              const { request } = await confirmErasure(confirming.id);
              outcome.current = request.status === "retained" ? RETAINED_MESSAGE : "Cadastro excluído.";
            }}
            onDone={() => { setConfirming(null); setDone(outcome.current); reload(); }}
            onCancel={() => setConfirming(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => {
              const code = (err as { body?: { error?: string } })?.body?.error;
              return code && ERRORS.includes(code) ? attendanceError(err) : null;
            }}
          />
        )}

        {rejecting && (
          <RejectPanel
            row={rejecting}
            onCancel={() => setRejecting(null)}
            onDone={() => { setRejecting(null); setDone("Pedido recusado."); reload(); }}
          />
        )}
      </div>
    </Panel>
  );
}

function RejectPanel({ row, onCancel, onDone }: { row: PendingErasure; onCancel(): void; onDone(): void }) {
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const valid = reason.trim().length >= 10;

  async function submit() {
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try {
      await rejectErasure(row.id, reason.trim());
      onDone();
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Recusar pedido de exclusão</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" }}>
        Motivo
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!valid || busy} onClick={() => void submit()} style={(!valid || busy) ? disabledButtonStyle : buttonStyle}>
          Confirmar recusa
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}
