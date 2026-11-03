// Conduta da excursão de temperatura, lote a lote (módulo 29; F-29.6; contrato §8; §15 V14, V24). Só do `room_lead` (sala) ou do
// `stock_keeper` (rede de frio); o api confere. Cada lote bloqueado é um <fieldset> com "Usar" ou "Dar perda" e o "Motivo" (10–500).
// "Revisar" confere TODAS as linhas de uma vez e abre o SensitiveAction (step-up) "Registrar conduta".
// V24: o lote cujo descarte aguarda aprovação ("aguardando aprovação do descarte") não aceita nova conduta e não vai no corpo; um novo
// decide leva só os lotes sem conduta; descarte recusado volta ao lote como bloqueio sem perda pendente (o api devolve o lote sem
// `pending_adjustment_id` e ele reaparece aqui). O descarte passa pelo ajuste do 27a com o motivo `temperature_excursion` (o api põe o
// loss_code; a tela não manda). Recusa do api (409 excursion_closed, 422 por lote) aparece inteira, na linha do lote ou no topo, com
// "Atualizar" — nada relê sozinho. Nada em URL, log ou storage.
import { useEffect, useRef, useState } from "react";
import {
  ApiError, decideExcursion, type ColdChainExcursion, type ExcursionDecisionLine, type ExcursionDecisionResult, type ExcursionLot
} from "../../lib/api";
import { fmtQuantity } from "../../lib/pharmacy";
import { reasonProblem, vaccinationError, vaccinationRefusals } from "../../lib/vaccination";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { adjustmentSavedText } from "../pharmacy/AdjustmentForm";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, panel, row, title } from "../exams/styles";

export const PENDING_DISCARD = "aguardando aprovação do descarte";
export const DECISION_SAVED = "Conduta registrada.";

type Choice = { decision: "" | "use" | "discard"; reason: string };

// Recusas que são da conduta (e não do step-up): ficam aqui, na linha do lote ou no topo.
const STEP_UP_CODES = new Set([ "invalid_code", "code_reused", "mfa_required" ]);
function isDomainRefusal(err: unknown): boolean {
  if (!(err instanceof ApiError) || (err.status !== 409 && err.status !== 422)) return false;
  const body = err.body as Record<string, unknown> | null;
  return !(body && typeof body.error === "string" && STEP_UP_CODES.has(body.error));
}

const lotLabel = (lot: ExcursionLot) => `${lot.immunobiological.name ?? lot.immunobiological.code} — lote ${lot.number}`;

// Uma frase por lote enviado, a partir do retorno (o ajuste do 27a diz se a perda foi aplicada ou aguarda aprovação).
export function decisionSavedLines(sent: ExcursionDecisionLine[], lots: ExcursionLot[], result: ExcursionDecisionResult): string[] {
  return sent.map((line) => {
    const number = lots.find((l) => l.lot_id === line.lot_id)?.number ?? line.lot_id;
    if (line.decision === "use") return `${number}: liberado para uso.`;
    const adj = result.adjustments.find((a) => a.lot?.id === line.lot_id);
    return adj ? `${number}: ${adjustmentSavedText("loss", adj.status)}` : `${number}: descartado (sem saldo no local).`;
  });
}

export function ExcursionDecision({ excursion, equipmentName, onDone, onRefresh, onGoToSecurity }: {
  excursion: ColdChainExcursion; equipmentName: string; onDone(lines: string[]): void; onRefresh(): void; onGoToSecurity?(): void;
}) {
  const [ choices, setChoices ] = useState<Record<string, Choice>>({});
  const [ lineErrors, setLineErrors ] = useState<Record<string, string[]>>({});
  const [ general, setGeneral ] = useState<string[]>([]);
  const [ refused, setRefused ] = useState(false);
  const [ review, setReview ] = useState<ExcursionDecisionLine[] | null>(null);
  const saved = useRef<ExcursionDecisionResult | null>(null);
  // Depois de uma recusa do api o SensitiveAction some e o foco cairia no body: vai ao primeiro lote com erro ou ao alerta do topo.
  const root = useRef<HTMLElement>(null);
  const [ refocus, setRefocus ] = useState(0);
  useEffect(() => {
    if (refocus === 0) return;
    const target = root.current?.querySelector<HTMLElement>("fieldset[aria-describedby] input") ?? root.current?.querySelector<HTMLElement>('[role="alert"]');
    target?.focus();
  }, [ refocus ]);

  const open = excursion.lots.filter((l) => !l.pending_adjustment_id);
  const pending = excursion.lots.filter((l) => l.pending_adjustment_id);
  const choiceOf = (id: string): Choice => choices[id] ?? { decision: "", reason: "" };
  const set = (id: string, patch: Partial<Choice>) => {
    setChoices((c) => ({ ...c, [id]: { ...choiceOf(id), ...c[id], ...patch } }));
    setLineErrors((e) => ({ ...e, [id]: [] }));
  };

  function check() {
    const errs: Record<string, string[]> = {};
    for (const lot of open) {
      const c = choiceOf(lot.lot_id);
      const list: string[] = [];
      if (c.decision === "") list.push(`${lot.number}: escolha usar ou dar perda`);
      const reason = reasonProblem(c.reason, "o motivo");
      if (reason) list.push(`${lot.number}: ${reason}`);
      if (list.length > 0) errs[lot.lot_id] = list;
    }
    setLineErrors(errs); setGeneral([]); setRefused(false);
    const first = open.find((l) => errs[l.lot_id]);
    if (first) { document.getElementById(`${excursion.id}-${first.lot_id}-use`)?.focus(); return; }
    setReview(open.map((l) => ({ lot_id: l.lot_id, decision: choiceOf(l.lot_id).decision as "use" | "discard", reason: choiceOf(l.lot_id).reason.trim() })));
  }

  // Recusa da conduta: `lots[i].…` volta à linha do lote enviado na posição i; o resto vai ao topo.
  function showRefusal(err: unknown, sent: ExcursionDecisionLine[]) {
    const errs: Record<string, string[]> = {};
    const top: string[] = [];
    for (const r of vaccinationRefusals(err)) {
      const m = /^lots\[(\d+)\]/.exec(r.path);
      const line = m ? sent[Number(m[1])] : undefined;
      const lot = line ? excursion.lots.find((l) => l.lot_id === line.lot_id) : undefined;
      if (line && lot) errs[line.lot_id] = [ ...(errs[line.lot_id] ?? []), `${lot.number}: ${r.text}` ];
      else top.push(r.text);
    }
    setLineErrors(errs); setGeneral(top); setRefused(true); setRefocus((n) => n + 1);
  }

  return (
    <section ref={root} aria-label={`Conduta — ${equipmentName}`} style={panel}>
      <h4 style={title}>{`Conduta — ${equipmentName}`}</h4>
      {general.map((t) => <p key={t} role="alert" tabIndex={-1} style={alert}>{t}</p>)}
      {refused && <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => { setRefused(false); setGeneral([]); onRefresh(); }}>Atualizar</button></div>}
      {pending.map((lot) => (
        <p key={lot.lot_id} style={muted}>{`${lot.number}: ${PENDING_DISCARD}`}</p>
      ))}
      {open.map((lot) => {
        const c = choiceOf(lot.lot_id);
        const errs = lineErrors[lot.lot_id] ?? [];
        const base = `${excursion.id}-${lot.lot_id}`;
        return (
          <fieldset key={lot.lot_id} style={fieldset} disabled={!!review} {...(errs.length > 0 ? { "aria-describedby": `${base}-err` } : {})}>
            <legend style={legend}>{lotLabel(lot)}</legend>
            <small className="mono" style={muted}>{`saldo no local: ${fmtQuantity(lot.balance)} doses`}</small>
            <div style={row}>
              <label style={checkLabel}>
                <input id={`${base}-use`} type="radio" name={`${base}-decision`} checked={c.decision === "use"} onChange={() => set(lot.lot_id, { decision: "use" })} />
                Usar
              </label>
              <label style={checkLabel}>
                <input type="radio" name={`${base}-decision`} checked={c.decision === "discard"} onChange={() => set(lot.lot_id, { decision: "discard" })} />
                Dar perda
              </label>
            </div>
            <div style={fieldLabel}>
              <label htmlFor={`${base}-reason`}>Motivo</label>
              <textarea id={`${base}-reason`} rows={2} style={inputStyle} value={c.reason} onChange={(e) => set(lot.lot_id, { reason: e.target.value })} />
            </div>
            {errs.length > 0 && <div id={`${base}-err`}>{errs.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}</div>}
          </fieldset>
        );
      })}
      {open.length === 0 && <p style={muted}>Todos os lotes desta excursão já têm conduta; falta a aprovação dos descartes.</p>}
      {open.length > 0 && !review && <div style={row}><button type="button" style={buttonStyle} onClick={check}>Revisar</button></div>}
      {review && (
        <SensitiveAction
          title="Confirmar a conduta"
          description={`${review.filter((l) => l.decision === "use").length} lote(s) liberado(s) para uso e ${review.filter((l) => l.decision === "discard").length} com perda, em seu nome. Perda acima do limite da cidade espera a aprovação de outra pessoa do local.`}
          requiresStepUp
          confirmLabel="Registrar conduta"
          run={async () => {
            saved.current = null;
            const sent = review;
            try {
              saved.current = await decideExcursion(excursion.id, sent);
            } catch (err) {
              if (!isDomainRefusal(err)) throw err;
              showRefusal(err, sent);
              setReview(null);
            }
          }}
          onDone={() => {
            const result = saved.current;
            if (!result || !review) return;
            const lines = decisionSavedLines(review, excursion.lots, result);
            setReview(null);
            onDone([ DECISION_SAVED, ...lines ]);
          }}
          onCancel={() => setReview(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => vaccinationError(err)}
        />
      )}
    </section>
  );
}
