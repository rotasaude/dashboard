// Ajustes aguardando aprovação do local (módulo 27a; F-27.4; contrato §6, H4). Só a contagem acima do limite da cidade chega aqui.
// Outra pessoa do local decide: "Aprovar" aplica o ajuste ao saldo; "Rejeitar" exige o motivo (10 a 500 caracteres), conferido ANTES do
// step-up (o código do autenticador não se gasta com motivo recusado). Os dois passam pelo step-up. O ajuste da própria pessoa não oferece nenhum dos dois (`requested_by.user_id` é o id da sessão): diz "aguardando outra pessoa
// do local". `same_user`, `not_pending` e `not_found` fecham a confirmação, mostram a frase e a lista é relida (quem chama guarda a frase).
// O `reason` já vem na lista: não há leitura de detalhe. Sem polling; lê ao abrir e depois de cada decisão. Nada em URL, log ou storage.
import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { approveAdjustment, errorCode, listAdjustments, rejectAdjustment, type PharmacyLocation, type StockAdjustment } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtDateTime } from "../../lib/format";
import {
  PH_ADJUSTMENTS_KEY, PH_POSITIONS_KEY, STATIC_QUERY, adjustmentKindLabel, fmtQuantity, fmtSigned, pharmacyError, reasonProblem
} from "../../lib/pharmacy";
import { DataTable } from "../../components/DataTable";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, stack } from "../exams/styles";

export const ADJUSTMENT_APPROVED_TEXT = "Ajuste aprovado: o saldo foi corrigido.";
export const ADJUSTMENT_REJECTED_TEXT = "Ajuste rejeitado: o saldo não mudou.";
const STALE = new Set([ "same_user", "not_pending", "not_found" ]);

type Action = { kind: "approve" | "reject"; adjustment: StockAdjustment } | null;

// O api aplica a DIFERENÇA guardada no pedido sobre o saldo de agora (não o contado): a frase diz isso, com o que o pedido via.
function approvalText(a: StockAdjustment): string {
  const unit = a.lot.item.dispensing_unit;
  const request = a.counted_quantity === null
    ? `saldo ${fmtQuantity(a.balance_at_request)}`
    : `saldo ${fmtQuantity(a.balance_at_request)} → contado ${fmtQuantity(a.counted_quantity)}`;
  return `Será aplicada ao saldo atual a diferença de ${fmtSigned(a.quantity)} ${unit} (no pedido de ${a.requested_by.name}: ${request}). Fica registrado em seu nome.`;
}

function rejectionText(a: StockAdjustment): string {
  return `O saldo do lote não muda e o pedido de ${a.requested_by.name} é encerrado. Fica registrado em seu nome, com o motivo.`;
}

export function PendingAdjustments({ location, onNotice, onStale, onGoToSecurity }: {
  location: PharmacyLocation; onNotice(text: string): void; onStale(text: string): void; onGoToSecurity?(): void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ action, setAction ] = useState<Action>(null);
  // A decisão que o api recusou por já estar decidida / ser da mesma pessoa: a frase sobe, a confirmação fecha.
  const staleText = useRef<string | null>(null);
  // O motivo da rejeição é conferido ANTES do SensitiveAction existir: assim o código do autenticador nunca é gasto com um motivo recusado.
  const [ rejectReason, setRejectReason ] = useState("");

  const pending = useInfiniteQuery({
    queryKey: [ PH_ADJUSTMENTS_KEY, location.id, "pending" ],
    queryFn: ({ pageParam }) => listAdjustments({ locationId: location.id, status: "pending", before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rejectProblem = action?.kind === "reject" ? reasonProblem(rejectReason) : null;
  const rows = (pending.data?.pages ?? []).flatMap((p) => p.adjustments);

  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: [ PH_ADJUSTMENTS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
  };

  async function decide(a: Action) {
    if (!a) return;
    staleText.current = null;
    try {
      if (a.kind === "approve") await approveAdjustment(a.adjustment.id);
      else await rejectAdjustment(a.adjustment.id, rejectReason.trim());
    } catch (err) {
      reread();
      if (STALE.has(errorCode(err) ?? "")) { staleText.current = pharmacyError(err); return; }
      throw err;
    }
    reread();
  }

  return (
    <Panel title="Ajustes aguardando aprovação" sub="contagens acima do limite da cidade; outra pessoa do local decide">
      <div style={stack}>
        {pending.isPending && <p className="mono" style={muted}>carregando…</p>}
        {pending.isError && !pending.data && <p role="alert" style={alert}>{pharmacyError(pending.error)}</p>}
        {pending.data && (
          <DataTable<StockAdjustment>
            cols={[
              { label: "Lote", w: "2fr", card: "title", render: (a) => (
                <span>{`${a.lot.item.name} · lote ${a.lot.lot_number}`}</span>
              ) },
              { label: "Tipo", w: "1fr", render: (a) => adjustmentKindLabel(a.kind) },
              { label: "Saldo antes", w: "1fr", render: (a) => `${fmtQuantity(a.balance_at_request)} ${a.lot.item.dispensing_unit}` },
              { label: "Contado", w: "1fr", render: (a) => (a.counted_quantity === null ? "—" : `${fmtQuantity(a.counted_quantity)} ${a.lot.item.dispensing_unit}`) },
              { label: "Diferença", w: "1fr", render: (a) => `${fmtSigned(a.quantity)} ${a.lot.item.dispensing_unit}` },
              { label: "Motivo", w: "2fr", render: (a) => a.reason },
              { label: "Por", w: "1fr", render: (a) => (
                <span>{a.requested_by.name}<br /><small className="mono" style={muted}>{fmtDateTime(a.created_at)}</small></span>
              ) },
              { label: "", w: "auto", card: "actions", render: (a) => (a.requested_by.user_id === user?.id ? (
                <span style={muted}>aguardando outra pessoa do local</span>
              ) : (
                <span style={row}>
                  <button type="button" style={buttonStyle} disabled={action !== null} onClick={() => { staleText.current = null; setAction({ kind: "approve", adjustment: a }); }}>Aprovar</button>
                  <button type="button" style={secondaryButtonStyle} disabled={action !== null} onClick={() => { staleText.current = null; setRejectReason(""); setAction({ kind: "reject", adjustment: a }); }}>Rejeitar</button>
                </span>
              )) }
            ]}
            rows={rows} rowKey={(a) => a.id} empty="nenhum ajuste aguardando aprovação"
          />
        )}
        {pending.data && pending.hasNextPage && (
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={pending.isFetchingNextPage} onClick={() => void pending.fetchNextPage()}>
              {pending.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}

        {action && (
          <div style={{ ...box, background: "var(--panel)" }}>
            {action.kind === "reject" && (
              <>
                <label style={fieldLabel}>
                  Motivo da rejeição
                  <textarea value={rejectReason} rows={3} style={inputStyle} onChange={(e) => setRejectReason(e.target.value)} />
                </label>
                {rejectProblem && <p style={muted}>{rejectProblem}</p>}
                {rejectProblem && <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => setAction(null)}>Cancelar</button></div>}
              </>
            )}
            {(action.kind === "approve" || !rejectProblem) && (
              <SensitiveAction
                key={`${action.kind}-${action.adjustment.id}`}
                title={`${action.kind === "approve" ? "Aprovar" : "Rejeitar"}: ${action.adjustment.lot.item.name}, lote ${action.adjustment.lot.lot_number}`}
                description={action.kind === "approve" ? approvalText(action.adjustment) : rejectionText(action.adjustment)}
                requiresStepUp
                confirmLabel={action.kind === "approve" ? "Aprovar ajuste" : "Rejeitar ajuste"}
                run={() => decide(action)}
                onDone={() => {
                  const done = action;
                  setAction(null);
                  if (staleText.current) { onStale(staleText.current); staleText.current = null; return; }
                  onNotice(done?.kind === "approve" ? ADJUSTMENT_APPROVED_TEXT : ADJUSTMENT_REJECTED_TEXT);
                }}
                onCancel={() => setAction(null)}
                onGoToSecurity={onGoToSecurity}
                translateError={(err) => pharmacyError(err)}
              />
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
