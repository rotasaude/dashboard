// src/modules/regulation/AuthorizeForm.tsx
// Autorizar um pedido numa oferta com saldo (módulo 26a; F-26.3). Só as ofertas do mês corrente da cidade e do alvo do
// pedido (G1); a esgotada aparece desabilitada. Mudar a cor pede motivo (10–500); o motivo de autorizar fora da ordem só
// aparece depois do 422 `skip_reason_required`, que não traz dado de outros pedidos (G5). A recusa do api fica no
// formulário, com o que foi digitado; `stale_version` e `invalid_transition` sobem para quem tem o "Recarregar".
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { errorCode, listCareOffers, authorizeRegulationRequest } from "../../lib/api";
import type { AuthorizeInput, CareOffer, RegulationRequest, RiskColor } from "../../lib/api";
import {
  COLORS, COLOR_REASON_TEXT, NOMINAL_QUERY, REG_OFFERS_KEY, SKIP_REASON_TEXT, currentMonth, providerKindLabel, reasonProblem, regulationError
} from "../../lib/regulation";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export const NO_OFFER_TEXT = "nenhuma oferta com saldo para este alvo neste mês — cadastre em Prestadores e cotas";
const CHOOSE_OFFER_TEXT = "escolha a oferta com saldo";

export function successText(o: CareOffer): string {
  return o.provider.kind === "own"
    ? `Autorizado em ${o.provider.name}. A unidade vai marcar o horário pelo pedido de agendamento.`
    : `Autorizado em ${o.provider.name}. Registre a data e o local quando o prestador marcar.`;
}

export function AuthorizeForm({ request, today, onDone, onStale, onCancel }: {
  request: RegulationRequest; today: string; onDone(text: string): void; onStale(text: string): void; onCancel(): void;
}) {
  const month = currentMonth(today);
  const offers = useQuery({
    queryKey: [ REG_OFFERS_KEY, month, request.target.code ],
    queryFn: () => listCareOffers({ month, targetCode: request.target.code }),
    ...NOMINAL_QUERY
  });
  const [ offerId, setOfferId ] = useState<string | null>(null);
  // A cor escolhida vale só para a versão do pedido em que foi escolhida: um "Recarregar" com outra cor confirmada
  // volta a seguir o pedido, sem acender o motivo sem o usuário mexer.
  const [ pick, setPick ] = useState<{ version: number; color: string } | null>(null);
  const color = pick && pick.version === request.version ? pick.color : request.color;
  const [ colorReason, setColorReason ] = useState("");
  const [ skipAsked, setSkipAsked ] = useState(false);
  const [ skipReason, setSkipReason ] = useState("");
  const [ message, setMessage ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  const list = offers.data ?? [];
  const anyAvailable = list.some((o) => o.available > 0);
  const chosen = list.find((o) => o.id === offerId && o.available > 0) ?? null;
  const colorChanged = color !== request.color;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!chosen) { setMessage(CHOOSE_OFFER_TEXT); return; }
    if (colorChanged) {
      const reason = colorReason.trim() === "" ? COLOR_REASON_TEXT : reasonProblem(colorReason);
      if (reason) { setMessage(reason); return; }
    }
    if (skipAsked) {
      const problem = reasonProblem(skipReason);
      if (problem) { setMessage(problem); return; }
    }
    const body: AuthorizeInput = { offer_id: chosen.id, version: request.version };
    if (colorChanged) { body.color = color as RiskColor; body.color_reason = colorReason.trim(); }
    if (skipAsked) body.skip_reason = skipReason.trim();
    setMessage(null);
    setBusy(true);
    try {
      await authorizeRegulationRequest(request.id, body);
      onDone(successText(chosen));
    } catch (err) {
      const code = errorCode(err);
      if (code === "stale_version" || code === "invalid_transition") onStale(regulationError(err));
      else if (code === "skip_reason_required") { setSkipAsked(true); setMessage(SKIP_REASON_TEXT); }
      else if (code === "quota_exhausted") { setOfferId(null); setMessage(regulationError(err)); void offers.refetch(); }
      else setMessage(regulationError(err));
    } finally {
      setBusy(false);
    }
  }

  // O formulário só nasce com as ofertas lidas (ou com a recusa da leitura): antes disso não há o que escolher.
  if (offers.isPending) return <p style={muted}>carregando ofertas…</p>;

  return (
    <form aria-label="Autorizar o pedido" onSubmit={submit} noValidate style={form}>
      <fieldset style={fieldset}>
        <legend style={legend}>Oferta</legend>
        {offers.isError && <p role="alert" style={alert}>{regulationError(offers.error)}</p>}
        {list.map((o) => {
          const out = o.available <= 0;
          return (
            <div key={o.id} style={row}>
              <label style={checkLabel}>
                <input type="radio" name="care-offer" value={o.id} checked={chosen?.id === o.id} disabled={out}
                  onChange={() => setOfferId(o.id)} />
                {`${o.provider.name} · ${providerKindLabel(o.provider.kind)} · saldo ${o.available} de ${o.quantity}`}
              </label>
              {out && <Tag tone="down">esgotada</Tag>}
            </div>
          );
        })}
        {offers.data && !anyAvailable && <p style={muted}>{NO_OFFER_TEXT}</p>}
      </fieldset>
      <label style={fieldLabel}>
        Cor confirmada
        <select value={color} style={inputStyle} onChange={(e) => setPick({ version: request.version, color: e.target.value })}>
          {COLORS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          {!COLORS.some((c) => c.key === request.color) && <option value={request.color}>{request.color}</option>}
        </select>
      </label>
      {colorChanged && (
        <label style={fieldLabel}>
          Motivo da mudança de cor
          <textarea value={colorReason} rows={3} style={inputStyle} onChange={(e) => setColorReason(e.target.value)} />
        </label>
      )}
      {skipAsked && (
        <label style={fieldLabel}>
          Motivo para autorizar fora da ordem
          <textarea value={skipReason} rows={3} style={inputStyle} onChange={(e) => setSkipReason(e.target.value)} />
        </label>
      )}
      {message && <p role="alert" style={alert}>{message}</p>}
      <div style={row}>
        <button type="submit" style={busy || !anyAvailable ? disabledButtonStyle : buttonStyle} disabled={busy || !anyAvailable}>
          Confirmar autorização
        </button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
