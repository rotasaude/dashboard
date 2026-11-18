// src/modules/VectorStockShortfalls.tsx
// "Faltas de insumo de campo" (módulo 35a; F-35.3; ADR 0054; contrato §4, §12; Q9, Q21): o boletim aplicou um produto que o local de
// estoque não tinha (VectorControl::ApplyStock grava a falta: `no_location` sem local configurado, `no_lot` sem nenhum lote do produto no
// local, `insufficient_balance` com lote zerado, vencido ou bloqueado). Quem confere por fora registra a conciliação com uma nota.
// Papel (StockShortfallsController#readable_scope, sem `pharmacy`): a coordenação lê todas, inclusive as `no_location`, sem `location_id`;
// o almoxarife lê as do local vector_control escolhido — só os locais `vector_control` em que ele é `stock_keeper` (o almoxarife do central
// recebe outros locais com `roles: []`). Sem esse local, o aviso aparece ANTES de ler as faltas; o 403 missing_role diz a mesma frase.
// Duas abas ("Abertas" | "Conciliadas"), cada uma com o seu cursor (`next_before`), mais novas primeiro. "Conciliar" com nota 10–500 →
// POST /stock_shortfalls/:id/reconcile { note } (ReconcileShortfall; a nota nunca volta do api). A conciliação NÃO mexe no saldo.
// Tela velha (409 already_reconciled, 404) e rede/5xx (não se sabe se gravou): a frase e UMA releitura, nenhum reenvio.
// Sem cidadão nem paciente: só o dia da visita, o produto, a quantidade, a causa e o local. Na aba Conciliadas, quem conciliou (Q40(2): o
// profissional que agiu, como no 32b): "conciliada por <nome>", ou "conciliada pelo sistema" com `reconciled_by: null` (estorno W-6). Sem trilha:
// STATIC_QUERY, relida depois de cada ação; nenhum polling; nada em URL além de ids, estado e cursor; nada em storage.
import { useRef, useState, type FormEvent } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, errorCode, listVectorShortfalls, reconcileVectorShortfall, type VectorShortfall } from "../lib/api";
import { fmtDay } from "../lib/exams";
import { fmtDateTime } from "../lib/format";
import { isNetworkOrServer } from "../lib/homeVisits";
import { errorPath, fmtQuantity, isVectorLocation } from "../lib/pharmacy";
import { STATIC_QUERY, VC_SHORTFALLS_KEY, noteProblem, shortfallCauseLabel, vectorError } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { SegmentedControl } from "../shell/SegmentedControl";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, form, muted, okText, row, stack } from "./exams/styles";
import { LocationPick } from "./pharmacy/LocationPick";
import { VectorGate } from "./vectorControl/VectorGate";

export const VC_NO_STOCK_LOCATION = "você não é almoxarife de nenhum local de estoque do controle vetorial — peça ao administrador da cidade";
export const RECONCILE_HINT = "a conciliação só registra a conferência — o ajuste de saldo é feito em Inventário e ajustes";
export const SHORTFALL_RECONCILED = "Falta conciliada.";
export const SHORTFALL_GONE = "esta falta não existe mais — a lista foi relida";
export const SHORTFALL_UNCERTAIN = "não foi possível confirmar a conciliação — a lista foi relida; confira a falta antes de tentar de novo";
export const SHORTFALLS_OPEN_EMPTY = "nenhuma falta aberta";
export const SHORTFALLS_RECONCILED_EMPTY = "nenhuma falta conciliada";

type State = "open" | "reconciled";
const TABS: { key: State; label: string }[] = [ { key: "open", label: "Abertas" }, { key: "reconciled", label: "Conciliadas" } ];

export function VectorStockShortfalls() {
  return (
    <VectorGate title="Faltas de insumo de campo" sub="endemias · insumo aplicado sem saldo no local" allow={(r) => r.coordinator || r.stockKeeper}>
      {(roles) => roles.coordinator ? <Shortfalls scope={null} /> : (
        <LocationPick allow={(r) => r.keeper} where={isVectorLocation} empty={VC_NO_STOCK_LOCATION}>
          {(loc) => <Shortfalls scope={loc.id} />}
        </LocationPick>
      )}
    </VectorGate>
  );
}

const productText = (s: VectorShortfall) => `${s.product.code} — ${s.product.name}`;
const quantityText = (s: VectorShortfall) => `${fmtQuantity(s.quantity)} ${s.product.unit}`;
// Json.shortfalls: `reconciled_by` nulo = o sistema (estorno da visita retirada); `{ name: null }` = pessoa sem perfil profissional ("—", como o 32b).
const reconcilerText = (s: VectorShortfall) => (s.reconciled_by ? `conciliada por ${s.reconciled_by.name ?? "—"}` : "conciliada pelo sistema");

// `scope`: o local vector_control do almoxarife; null = a coordenação lendo todas.
function Shortfalls({ scope }: { scope: string | null }) {
  const queryClient = useQueryClient();
  const [ state, setState ] = useState<State>("open");
  const [ target, setTarget ] = useState<VectorShortfall | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ stale, setStale ] = useState<string | null>(null);

  const list = useInfiniteQuery({
    queryKey: [ VC_SHORTFALLS_KEY, scope, state ],
    queryFn: ({ pageParam }) => listVectorShortfalls({ state, locationId: scope, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.items);
  // Uma releitura por ação: as páginas da aba à vista (a outra, já lida, fica velha e relê ao voltar).
  const reread = () => { void queryClient.invalidateQueries({ queryKey: [ VC_SHORTFALLS_KEY ] }); };
  const clear = () => { setDone(null); setStale(null); };

  if (list.isError && !list.data && errorCode(list.error) === "missing_role") return <EmptyState title={VC_NO_STOCK_LOCATION} />;

  return (
    <Panel title="Faltas de insumo de campo" sub="só o produto, a quantidade, a causa, o local e o dia da visita">
      <div style={{ ...stack, padding: 16 }}>
        <p style={muted}>{RECONCILE_HINT}</p>
        <div><SegmentedControl options={TABS} value={state} onChange={(s) => { setState(s); setTarget(null); clear(); }} /></div>
        {done && <p role="status" style={okText}>{done}</p>}
        {stale && <p role="alert" style={alert}>{stale}</p>}
        {list.isPending && <p className="mono" style={muted}>carregando…</p>}
        {list.isError && !list.data && <p role="alert" style={alert}>{vectorError(list.error)}</p>}
        {list.data && (
          <DataTable<VectorShortfall>
            cols={[
              { label: "Data da visita", w: "1fr", render: (s) => <span className="mono">{fmtDay(s.visit_on)}</span> },
              { label: "Produto", w: "2fr", card: "title", render: (s) => productText(s) },
              { label: "Quantidade", w: "1fr", render: (s) => quantityText(s) },
              { label: "Causa", w: "1.5fr", render: (s) => shortfallCauseLabel(s.cause) },
              { label: "Local", w: "1.5fr", render: (s) => s.stock_location?.name ?? "sem local" },
              ...(state === "reconciled" ? [ {
                label: "Conciliada", w: "2fr", render: (s: VectorShortfall) => (
                  <span><span className="mono">{fmtDateTime(s.reconciled_at)}</span>{` · ${reconcilerText(s)}`}</span>
                )
              } ] : [ {
                label: "", w: "auto", card: "actions" as const, render: (s: VectorShortfall) => (
                  <button type="button" style={secondaryButtonStyle} aria-label={`Conciliar falta de ${productText(s)}`} disabled={target !== null}
                    onClick={() => { clear(); setTarget(s); }}>
                    Conciliar
                  </button>
                )
              } ])
            ]}
            rows={rows} rowKey={(s) => s.id} empty={state === "open" ? SHORTFALLS_OPEN_EMPTY : SHORTFALLS_RECONCILED_EMPTY}
          />
        )}
        {list.data && list.hasNextPage && (
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
        {target && (
          <ReconcileForm key={target.id} shortfall={target} onCancel={() => setTarget(null)}
            onDone={() => { setTarget(null); setDone(SHORTFALL_RECONCILED); reread(); }}
            onStale={(text) => { setTarget(null); setStale(text); reread(); }}
            onRefused={(text) => { setTarget(null); setStale(text); }} />
        )}
      </div>
    </Panel>
  );
}

// ─── Conciliar ──────────────────────────────────────────────────────────────
function ReconcileForm({ shortfall, onDone, onStale, onRefused, onCancel }: {
  shortfall: VectorShortfall; onDone(): void; onStale(text: string): void; onRefused(text: string): void; onCancel(): void;
}) {
  const [ note, setNote ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  // O segundo clique chega antes do re-render: a trava é a ref.
  const inFlight = useRef(false);
  const label = `Conciliar falta de ${productText(shortfall)}`;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (inFlight.current) return;
    const local = noteProblem(note, "note");
    if (local) { setProblem(local.text); return; }
    inFlight.current = true; setBusy(true); setProblem(null);
    try {
      await reconcileVectorShortfall(shortfall.id, note.trim());
      onDone();
    } catch (err) {
      if (isNetworkOrServer(err)) onStale(SHORTFALL_UNCERTAIN);
      else if (errorCode(err) === "already_reconciled") onStale(VECTOR_ERRORS.already_reconciled);
      else if (err instanceof ApiError && err.status === 404) onStale(SHORTFALL_GONE);
      else if (errorCode(err) === "missing_role") onRefused(VC_NO_STOCK_LOCATION);
      else if (errorPath(err) === "note") setProblem(noteProblem("", "note")?.text ?? vectorError(err));
      else setProblem(vectorError(err));
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  return (
    <form noValidate aria-label={label} style={{ ...box, ...form }} onSubmit={(ev) => void submit(ev)}>
      <strong>{`${label} (${quantityText(shortfall)})`}</strong>
      <label style={fieldLabel}>
        Nota da conciliação
        <textarea value={note} rows={3} disabled={busy} style={{ ...inputStyle, minHeight: 56 }} aria-invalid={problem ? true : undefined}
          onChange={(e) => { setNote(e.target.value); setProblem(null); }} />
      </label>
      <span style={muted}>de 10 a 500 caracteres; a nota fica só no registro da conciliação</span>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Conciliar falta</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
