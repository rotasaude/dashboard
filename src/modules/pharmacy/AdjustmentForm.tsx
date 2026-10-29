// Ajuste de inventário, perda e vencimento (módulo 27a; F-27.4; contrato §6, H4). Por local, pelo farmacêutico ou pelo almoxarife.
// "Contagem de inventário" é um SALDO: a pessoa digita o que contou e a tela mostra a diferença antes de enviar ("Saldo 30 → 20 (-10)");
// a contagem pode passar de 99999,99 (a tela só recusa diferença maior que isso para o saldo). "Perda" e "Vencimento" saem do saldo e são
// aplicados na hora; só a contagem acima do limite da cidade fica pendente (o limite é do api — a tela não o calcula) e a frase de
// sucesso vem do `status` da resposta. O lote só oferece o que vale para o tipo: perda, lote não vencido; vencimento, lote já vencido.
// "Revisar" confere tudo de uma vez e abre o SensitiveAction (step-up). Nada em URL, log ou storage; nada de editar ou apagar movimento.
import { useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { listPositions, recordAdjustment, type AdjustmentKind, type PharmacyLocation, type StockAdjustment, type StockPosition } from "../../lib/api";
import { fmtDay } from "../../lib/exams";
import {
  PH_ADJUSTMENTS_KEY, PH_POSITIONS_KEY, STATIC_QUERY, adjustmentBody, adjustmentDelta, adjustmentKindLabel, adjustmentProblem, cents,
  fmtQuantity, fmtSigned, lotKindProblem, lotOptionLabel, lotsForKind, lotsWithBalance, pharmacyError, reasonProblem, type AdjustmentDraft
} from "../../lib/pharmacy";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, title } from "../exams/styles";

export const ADJUSTMENT_PENDING_TEXT = "Ajuste acima do limite da cidade: aguardando a aprovação de outra pessoa do local.";

// A frase de sucesso vem do `status` da resposta: `pending` → aguarda outra pessoa; o resto foi aplicado.
export function adjustmentSavedText(kind: string, status: string): string {
  if (status === "pending") return ADJUSTMENT_PENDING_TEXT;
  if (kind === "loss") return "Perda registrada.";
  if (kind === "expiry") return "Vencimento registrado.";
  return "Ajuste registrado.";
}

const EMPTY: AdjustmentDraft = { lotId: "", kind: "", amount: "", reason: "" };
const KINDS: AdjustmentKind[] = [ "adjustment", "loss", "expiry" ];
const KIND_OPTION: Record<AdjustmentKind, string> = { adjustment: "Contagem de inventário", loss: "Perda", expiry: "Vencimento" };

export function AdjustmentForm({ location, today, onStart, onDone, onGoToSecurity }: {
  location: PharmacyLocation; today: string; onStart?(): void; onDone(saved: StockAdjustment, kind: AdjustmentKind): void; onGoToSecurity?(): void;
}) {
  const queryClient = useQueryClient();
  const positions = useInfiniteQuery({
    queryKey: [ PH_POSITIONS_KEY, location.id, "adjustment" ],
    queryFn: ({ pageParam }) => listPositions({ locationId: location.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const [ itemId, setItemId ] = useState("");
  const [ draft, setDraft ] = useState<AdjustmentDraft>(EMPTY);
  const [ problems, setProblems ] = useState<string[]>([]);
  const [ review, setReview ] = useState<AdjustmentDraft | null>(null);
  const saved = useRef<StockAdjustment | null>(null);

  const all = (positions.data?.pages ?? []).flatMap((p) => p.positions);
  const offered = all.filter((p) => lotsWithBalance(p).length > 0);
  const position: StockPosition | undefined = all.find((p) => p.item.catalog_item_id === itemId);
  const unit = position?.item.dispensing_unit ?? "";
  const lots = lotsForKind(position, draft.kind, today);
  const lot = (position?.lots ?? []).find((b) => b.lot.id === draft.lotId);
  const counting = draft.kind === "adjustment";
  const amountLabel = counting ? "Quantidade contada" : "Quantidade";
  const locked = review !== null;

  const patch = (over: Partial<AdjustmentDraft>) => { setProblems([]); setDraft((cur) => ({ ...cur, ...over })); };
  // Trocar o tipo tira o lote que não vale para o novo tipo (perda, não vencido; vencimento, vencido).
  const chooseKind = (kind: AdjustmentKind | "") => {
    const keep = lotsForKind(position, kind, today).some((b) => b.lot.id === draft.lotId);
    patch({ kind, lotId: keep ? draft.lotId : "" });
  };
  const chooseItem = (id: string) => { setItemId(id); patch({ lotId: "" }); };

  function problemsOf(): string[] {
    if (!position) return [ "escolha o medicamento" ];
    const out: string[] = [];
    const first = adjustmentProblem(draft, lot?.balance ?? "0") ?? lotKindProblem(draft.kind, lot?.lot, today);
    const reason = reasonProblem(draft.reason);
    if (first) out.push(first);
    if (reason && reason !== first) out.push(reason);
    return out;
  }

  function startReview() {
    onStart?.();
    const found = problemsOf();
    setProblems(found);
    if (found.length === 0) setReview(draft);
  }

  function reread() {
    void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ PH_ADJUSTMENTS_KEY ] });
  }

  function reset() { setReview(null); setDraft(EMPTY); setItemId(""); setProblems([]); }

  // O que o saldo vira, na régua do que a tela leu (o saldo relido atualiza este resumo).
  const summary = review && lot ? (() => {
    const delta = adjustmentDelta(review, lot.balance);
    const after = (cents(lot.balance) + cents(delta)) / 100;
    return `Saldo ${fmtQuantity(lot.balance)} → ${fmtQuantity(String(after))} (${fmtSigned(delta)})`;
  })() : null;

  // O formulário só aparece com as posições lidas: o seletor de medicamento nasce com as opções.
  if (positions.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (positions.isError && !positions.data) return <p role="alert" style={alert}>{pharmacyError(positions.error)}</p>;

  return (
    <form aria-label="Registrar ajuste, perda ou vencimento" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}
      onSubmit={(e) => { e.preventDefault(); if (!locked) startReview(); }}>
      <h3 style={title}>{`Ajuste, perda ou vencimento em ${location.name}`}</h3>
      <p style={muted}>Para corrigir o saldo, registre um ajuste novo: nenhum movimento é editado nem apagado.</p>
      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={row}>
          <label style={{ ...fieldLabel, flex: "1 1 28ch" }}>
            Medicamento
            <select value={itemId} style={inputStyle} onChange={(e) => chooseItem(e.target.value)}>
              <option value="">{offered.length === 0 ? "nenhum medicamento com saldo" : "Escolha o medicamento"}</option>
              {offered.map((p) => (
                <option key={p.item.catalog_item_id} value={p.item.catalog_item_id}>{`${p.item.name} — saldo ${fmtQuantity(p.balance)} ${p.item.dispensing_unit}`}</option>
              ))}
            </select>
          </label>
          <label style={{ ...fieldLabel, flex: "1 1 20ch" }}>
            Tipo
            <select value={draft.kind} style={inputStyle} onChange={(e) => chooseKind(e.target.value as AdjustmentKind | "")}>
              <option value="">Escolha o tipo</option>
              {KINDS.map((k) => <option key={k} value={k}>{KIND_OPTION[k]}</option>)}
            </select>
          </label>
        </div>
        <div style={row}>
          <label style={{ ...fieldLabel, flex: "2 1 32ch" }}>
            Lote
            <select value={draft.lotId} style={inputStyle} onChange={(e) => patch({ lotId: e.target.value })}>
              <option value="">{position && lots.length === 0 ? lotsHint(draft.kind) : "Escolha o lote"}</option>
              {lots.map((b) => <option key={b.lot.id} value={b.lot.id}>{lotOptionLabel(b, false)}</option>)}
            </select>
          </label>
          <label style={{ ...fieldLabel, flex: "1 1 18ch" }}>
            {unit ? `${amountLabel} (${unit})` : amountLabel}
            <input value={draft.amount} inputMode="decimal" style={inputStyle} aria-label={amountLabel} onChange={(e) => patch({ amount: e.target.value })} />
          </label>
        </div>
        <label style={fieldLabel}>
          Motivo
          <textarea value={draft.reason} rows={2} style={inputStyle} onChange={(e) => patch({ reason: e.target.value })} />
        </label>
      </fieldset>

      {problems.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {!review && <div style={row}><button type="submit" style={buttonStyle}>Revisar ajuste</button></div>}

      {review && !(lot && position) && (
        <div style={box}>
          <p role="alert" style={alert}>O lote não está mais na posição do local — volte e escolha de novo.</p>
          <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => setReview(null)}>Voltar</button></div>
        </div>
      )}
      {review && lot && position && (
        <div style={{ ...box, background: "var(--panel)" }}>
          <strong>{`${adjustmentKindLabel(review.kind)}: ${position.item.name}`}</strong>
          <small className="mono" style={muted}>{`lote ${lot.lot.lot_number} · vence ${fmtDay(lot.lot.expires_on)}`}</small>
          <p style={{ margin: 0 }}>{summary}</p>
          <small style={muted}>{`Motivo: ${review.reason.trim()}`}</small>
          <SensitiveAction
            title={`Confirmar: ${adjustmentKindLabel(review.kind).toLowerCase()}`}
            description={review.kind === "adjustment"
              ? "O ajuste fica registrado em seu nome e não se edita. Se passar do limite da cidade, espera a aprovação de outra pessoa do local."
              : "O saldo do lote muda agora, em seu nome, e o registro não se edita; correção é um ajuste novo."}
            requiresStepUp
            confirmLabel="Registrar ajuste"
            run={async () => {
              try {
                saved.current = await recordAdjustment(adjustmentBody(review, location.id));
              } catch (err) {
                reread(); // o saldo pode ter mudado: a tela mostra o novo e mantém o que foi digitado
                throw err;
              }
            }}
            onDone={() => {
              const result = saved.current;
              reread();
              const kind = review.kind as AdjustmentKind;
              reset();
              if (result) onDone(result, kind);
            }}
            onCancel={() => setReview(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => pharmacyError(err)}
          />
        </div>
      )}
    </form>
  );
}

function lotsHint(kind: AdjustmentKind | ""): string {
  if (kind === "expiry") return "nenhum lote vencido com saldo";
  if (kind === "loss") return "nenhum lote não vencido com saldo";
  return "nenhum lote com saldo";
}
