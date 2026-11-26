// Relatório de uma importação do saldo inicial (módulo 27b; contrato §5, Q11, Q20, Q24, Q26; F-17, F-19). Lê `getOpeningImport` com as
// linhas em páginas de 100 pelo cursor `before` e o filtro "só com erro" do api. Os atos seguem a situação: conferida → aplicar (step-up)
// ou descartar; aplicada → desfazer (step-up); descartada e desfeita → só leitura. Todo ato manda a `version` lida. O 409
// `opening_import_changed` mostra a frase e relê uma vez; o 409 `revert_blocked` nomeia os locais e mantém a situação (sem reler);
// rede ou timeout relê e mantém a tela, sem reenviar. Sem pessoa além do nome de quem enviou; sem polling.
import { useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, applyOpeningImport, discardOpeningImport, getOpeningImport, revertOpeningImport, type OpeningImportDetail, type OpeningImportRow
} from "../../lib/api";
import { OPENING_IMPORTS_KEY, STATIC_QUERY, isStale } from "../../lib/bnafar";
import { fmtDateTime } from "../../lib/format";
import {
  IMPORT_ERRORS, ROWS_PAGE, appliedText, blockedLocations, discardedText, fmtCentsBRL, importErrorText, importStatusView,
  missingSendFieldsText, revertBlockedText, revertedText, rowErrorText
} from "../../lib/openingImport";
import { ConfirmButton } from "../../components/ConfirmButton";
import { DataTable } from "../../components/DataTable";
import { KeyValue } from "../../components/KeyValue";
import { SensitiveAction } from "../../components/SensitiveAction";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, grid, list, muted, okText, panel, row, title } from "../exams/styles";

export const importDetailKey = (id: string) => [ OPENING_IMPORTS_KEY, "detail", id ] as const;

type Act = "apply" | "revert";
const lines = (n: number) => `${n} ${n === 1 ? "linha" : "linhas"}`;
const qty = (q: string) => (Number.isFinite(Number(q)) ? Number(q).toLocaleString("pt-BR") : q);

export function ImportReport({ importId, onGoToSecurity, onChanged, onClose }: {
  importId: string; onGoToSecurity?(): void; onChanged(): void; onClose(): void;
}) {
  const client = useQueryClient();
  const [ errorsOnly, setErrorsOnly ] = useState(false);
  const [ confirming, setConfirming ] = useState<Act | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ actError, setActError ] = useState<string | null>(null);
  const result = useRef<OpeningImportDetail | null>(null);

  const q = useInfiniteQuery({
    queryKey: [ ...importDetailKey(importId), errorsOnly ? "error" : "all" ],
    queryFn: ({ pageParam }) => getOpeningImport(importId, {
      ...(pageParam ? { before: pageParam } : {}), ...(errorsOnly ? { status: "error" as const } : {}), limit: ROWS_PAGE
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    placeholderData: keepPreviousData,
    ...STATIC_QUERY
  });
  const head = q.data?.pages[0];
  const rows = (q.data?.pages ?? []).flatMap((p) => p.rows);

  function afterAct() {
    void client.invalidateQueries({ queryKey: importDetailKey(importId) });
    onChanged();
  }
  function start() { setNotice(null); setActError(null); }

  // 401 (step-up ou sessão) é do SensitiveAction; o resto fecha a confirmação e fica com a tela.
  function refused(err: unknown, h: OpeningImportDetail) {
    if (err instanceof ApiError && err.status === 401) return;
    setConfirming(null);
    if (isStale(err, "opening_import_changed")) { setActError(IMPORT_ERRORS.opening_import_changed); void q.refetch(); return; }
    if (isStale(err, "revert_blocked")) { setActError(revertBlockedText(blockedLocations(err), h.report)); return; }
    setActError(importErrorText(err));
    if (err instanceof ApiError && err.status === 404) onChanged();
    else if (!(err instanceof ApiError)) void q.refetch();
  }

  async function run(act: Act, h: OpeningImportDetail) {
    try {
      result.current = act === "apply" ? await applyOpeningImport(h.id, h.version) : await revertOpeningImport(h.id, h.version);
    } catch (err) {
      refused(err, h);
      throw err;
    }
  }

  function done(act: Act) {
    setConfirming(null);
    setNotice(act === "apply" ? appliedText(result.current ?? head!) : revertedText);
    afterAct();
  }

  async function discard(h: OpeningImportDetail) {
    start();
    try {
      await discardOpeningImport(h.id, h.version);
      setNotice(discardedText);
      afterAct();
    } catch (err) {
      refused(err, h);
    }
  }

  const status = head ? importStatusView(head.status) : null;
  return (
    <section aria-label="Importação" style={panel}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <h3 style={title}>{head ? `Importação enviada em ${fmtDateTime(head.created_at)}` : "Importação"}</h3>
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} disabled={q.isFetching} onClick={() => void q.refetch()}>Atualizar</button>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
        </div>
      </div>
      {q.isPending && <p className="mono" style={muted}>carregando…</p>}
      {q.isError && !q.data && <p role="alert" style={alert}>{importErrorText(q.error)}</p>}
      {notice && <p role="status" style={okText}>{notice}</p>}
      {actError && <p role="alert" style={alert}>{actError}</p>}
      {head && status && (
        <>
          <div style={grid}>
            <KeyValue k="Situação" v={<Tag tone={status.tone}>{status.label}</Tag>} />
            <KeyValue k="Linhas válidas" v={`${head.report.rows_valid} de ${head.rows_total}`} />
            <KeyValue k="Linhas com erro" v={head.report.rows_error} />
            <KeyValue k="Enviada por" v={head.uploaded_by?.name || "—"} mono={false} />
            {head.applied_at && <KeyValue k="Aplicada em" v={fmtDateTime(head.applied_at)} />}
            {head.reverted_at && <KeyValue k="Desfeita em" v={fmtDateTime(head.reverted_at)} />}
          </div>
          {head.report.rows_missing_send_fields > 0 && (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--warn)" }}>{missingSendFieldsText(head.report.rows_missing_send_fields)}</p>
          )}

          {!confirming && <Actions head={head} onApply={() => { start(); setConfirming("apply"); }} onRevert={() => { start(); setConfirming("revert"); }} onDiscard={() => discard(head)} />}
          {confirming === "apply" && (
            <SensitiveAction
              title="Aplicar o saldo inicial"
              description={`${lines(head.report.rows_valid)} viram a abertura de ${head.report.totals_by_location.length} ${head.report.totals_by_location.length === 1 ? "local" : "locais"}. As linhas com erro ficam de fora.`}
              requiresStepUp
              confirmLabel="Confirmar aplicação"
              run={() => run("apply", head)}
              onDone={() => done("apply")}
              onCancel={() => setConfirming(null)}
              onGoToSecurity={onGoToSecurity}
              translateError={(err) => importErrorText(err)}
            />
          )}
          {confirming === "revert" && (
            <SensitiveAction
              title="Desfazer a importação"
              description="As aberturas da planilha são estornadas. Só vale antes de qualquer outro movimento ou envio à BNAFAR nos locais da importação."
              requiresStepUp
              confirmLabel="Confirmar desfazer"
              run={() => run("revert", head)}
              onDone={() => done("revert")}
              onCancel={() => setConfirming(null)}
              onGoToSecurity={onGoToSecurity}
              translateError={(err) => importErrorText(err)}
            />
          )}

          <Report head={head} />

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ ...row, justifyContent: "space-between" }}>
              <h4 style={title}>Linhas da planilha</h4>
              <label style={checkLabel}>
                <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
                só com erro
              </label>
            </div>
            {q.isPlaceholderData && <p className="mono" style={muted}>carregando…</p>}
            <DataTable<OpeningImportRow>
              label="Linhas da planilha"
              cols={[
                { label: "Linha", w: "0.5fr", card: "title", render: (r) => <span className="mono">{`linha ${r.line}`}</span> },
                { label: "Situação", w: "0.7fr", render: (r) => r.status === "valid" ? <Tag tone="ok">válida</Tag> : r.status === "error" ? <Tag tone="down">com erro</Tag> : <Tag>{r.status}</Tag> },
                { label: "Erros", w: "2fr", render: (r) => <span>{r.error_codes.map(rowErrorText).join("; ") || "—"}</span> },
                { label: "CNES", w: "0.8fr", render: (r) => <span className="mono">{r.cnes ?? "—"}</span> },
                { label: "Produto", w: "1fr", render: (r) => <span className="mono">{[ r.tipo_produto, r.codigo_produto ].filter(Boolean).join(" ") || "—"}</span> },
                { label: "Lote", w: "0.8fr", render: (r) => <span className="mono">{r.lote ?? "—"}</span> },
                { label: "Validade", w: "0.8fr", render: (r) => <span className="mono">{r.validade ?? "—"}</span> },
                { label: "Quantidade", w: "0.7fr", align: "right", render: (r) => <span className="mono">{r.quantidade ?? "—"}</span> },
                { label: "Valor unitário", w: "0.8fr", align: "right", render: (r) => <span className="mono">{r.valor_unitario ?? "—"}</span> }
              ]}
              rows={rows} rowKey={(r) => `${r.line}`} empty={errorsOnly ? "nenhuma linha com erro" : "nenhuma linha"}
            />
            {q.hasNextPage && (
              <div style={row}>
                <button type="button" style={buttonStyle} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                  {q.isFetchingNextPage ? "Carregando…" : "Carregar mais linhas"}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Actions({ head, onApply, onRevert, onDiscard }: { head: OpeningImportDetail; onApply(): void; onRevert(): void; onDiscard(): Promise<void> }) {
  if (head.status === "validated") {
    const n = head.report.rows_valid;
    return (
      <div style={row}>
        {n > 0
          ? <button type="button" style={buttonStyle} onClick={onApply}>{`Aplicar ${lines(n)}`}</button>
          : <p style={muted}>nenhuma linha válida para aplicar — corrija a planilha e envie de novo</p>}
        <ConfirmButton label="Descartar" variant="danger" question="Descartar esta importação? O arquivo é apagado e nada entra no estoque." onConfirm={onDiscard} />
      </div>
    );
  }
  if (head.status === "applied") {
    return <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onRevert}>Desfazer</button></div>;
  }
  if (head.status === "uploaded") return <p style={muted}>a conferência ainda não terminou — use Atualizar</p>;
  return <p style={muted}>só leitura: esta importação não tem mais atos</p>;
}

function Report({ head }: { head: OpeningImportDetail }) {
  const r = head.report;
  const errors = Object.entries(r.errors_by_code).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {errors.length > 0 && (
        <div>
          <h4 style={title}>Erros por código</h4>
          <ul style={list}>{errors.map(([ code, n ]) => <li key={code}>{`${rowErrorText(code)}: ${n}`}</li>)}</ul>
        </div>
      )}
      {r.products_without_catalog.length > 0 && (
        <div>
          <h4 style={title}>Produtos sem catálogo</h4>
          <ul style={list}>{r.products_without_catalog.map((p, i) => <li key={`${p.tipo_produto}-${p.codigo_produto}-${i}`} className="mono">{`${p.tipo_produto} ${p.codigo_produto}`}</li>)}</ul>
        </div>
      )}
      {r.locations_without_cnes.length > 0 && (
        <div>
          <h4 style={title}>Locais sem CNES</h4>
          <ul style={list}>{r.locations_without_cnes.map((l) => <li key={l.id}>{l.name}</li>)}</ul>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h4 style={title}>Totais por local</h4>
        <DataTable
          label="Totais por local"
          cols={[
            { label: "Local", w: "1.6fr", card: "title", render: (t) => t.location_name },
            { label: "Linhas", w: "0.6fr", align: "right", render: (t) => <span className="mono">{t.rows}</span> },
            { label: "Quantidade", w: "0.8fr", align: "right", render: (t) => <span className="mono">{qty(t.quantity)}</span> },
            { label: "Valor", w: "1fr", align: "right", render: (t) => <span className="mono">{fmtCentsBRL(t.value_cents)}</span> }
          ]}
          rows={r.totals_by_location} rowKey={(t) => t.stock_location_id} empty="nenhuma linha válida"
        />
      </div>
    </div>
  );
}
