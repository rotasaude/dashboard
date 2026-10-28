// src/modules/regulation/OfferForm.tsx
// Nova oferta ou mudança de quantidade (módulo 26a; F-26.4; contrato §6, G1, G5). A oferta é do prestador (ativo), de um alvo
// (busca pelo nome, sem filtro de enfermeiro) e de um mês: cadastra-se o corrente ou um futuro, nunca um passado (conferido
// aqui com o dia da cidade e de novo no api, `invalid_month`). Só o mês corrente é autorizável. Em edição só muda a quantidade;
// abaixo do já autorizado o api recusa (`quantity_below_used`) e a frase fica no formulário, com o que foi digitado.
import { useState, type CSSProperties } from "react";
import { createCareOffer, updateCareOffer } from "../../lib/api";
import type { CareOffer, CareProvider, RegulationTarget, RegulationType } from "../../lib/api";
import {
  currentMonth, monthLabel, monthProblem, parseQuantity, providerKindLabel, quantityProblem, regulationError, typeLabel
} from "../../lib/regulation";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row } from "../exams/styles";
import { TargetSearch } from "./TargetSearch";
import { fieldBox, fieldsetStyle, hintStyle } from "./styles";

const TYPES: RegulationType[] = [ "specialty", "procedure" ];
const AUTHORIZABLE_NOTE = "Só a oferta do mês corrente pode receber autorizações; as dos meses seguintes ficam preparadas.";

export function OfferForm({ offer, providers, today, onSaved, onCancel, onGoToSecurity }: {
  offer: CareOffer | null; providers: CareProvider[]; today: string; onSaved(message: string): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const [ providerId, setProviderId ] = useState("");
  const [ type, setType ] = useState<RegulationType>("specialty");
  const [ target, setTarget ] = useState<RegulationTarget | null>(null);
  const [ month, setMonth ] = useState(currentMonth(today));
  const [ quantity, setQuantity ] = useState(offer ? String(offer.quantity) : "");
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const touch = <T,>(set: (v: T) => void) => (v: T) => { setError(null); set(v); };

  const chosen = providers.find((p) => p.id === providerId);

  function review() {
    const problem = offer
      ? (quantityProblem(quantity) ?? (parseQuantity(quantity) === offer.quantity ? "nada mudou: a quantidade é a mesma" : null))
      : ((chosen ? null : "escolha o prestador")
        ?? (target ? null : "escolha a especialidade ou o procedimento")
        ?? monthProblem(month, today)
        ?? quantityProblem(quantity));
    if (problem) { setError(problem); return; }
    setConfirming(true);
  }

  async function save() {
    if (offer) { await updateCareOffer(offer.id, parseQuantity(quantity)); return; }
    await createCareOffer({
      provider_id: providerId, target_type: (target as RegulationTarget).type, target_code: (target as RegulationTarget).code,
      month, quantity: parseQuantity(quantity)
    });
  }

  const subject = offer
    ? `${offer.target.name} · ${offer.provider.name} · ${monthLabel(offer.month)}`
    : `${target?.name ?? ""} · ${chosen?.name ?? ""} · ${monthLabel(month)}`;
  return (
    <section aria-label={offer ? "Mudar a quantidade da oferta" : "Nova oferta"} style={box}>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          {offer ? (
            <p style={muted}>{`${offer.provider.name} · ${providerKindLabel(offer.provider.kind)} · ${offer.target.name} · ${monthLabel(offer.month)} · já autorizadas: ${offer.used}`}</p>
          ) : (
            <>
              <label style={fieldLabel}>
                Prestador
                <select value={providerId} style={inputStyle} onChange={(e) => touch(setProviderId)(e.target.value)}>
                  <option value="">escolha</option>
                  {providers.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{`${p.name} · ${providerKindLabel(p.kind)}`}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Tipo do alvo
                <select value={type} style={inputStyle} onChange={(e) => { setError(null); setType(e.target.value as RegulationType); setTarget(null); }}>
                  {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
                </select>
              </label>
              {/* Sem `cbo`: a oferta não é filtrada pela lista do enfermeiro. */}
              <TargetSearch key={type} type={type} onPick={(t) => { setError(null); setTarget(t); }} />
              {target && <p style={chosenStyle}>{`Alvo: ${target.code} — ${target.name}`}</p>}
              <div style={fieldBox}>
                <label style={fieldLabel}>
                  Mês
                  <input type="month" value={month} style={inputStyle} onChange={(e) => touch(setMonth)(e.target.value)} />
                </label>
                <span style={hintStyle}>{AUTHORIZABLE_NOTE}</span>
              </div>
            </>
          )}
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Quantidade no mês
              <input value={quantity} inputMode="numeric" style={inputStyle} onChange={(e) => touch(setQuantity)(e.target.value)} />
            </label>
            <span style={hintStyle}>inteiro de 0 a 9999</span>
          </div>
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && (
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={review}>Revisar</button>
              <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
            </div>
          )}
        </div>
      </fieldset>
      {confirming && (
        <SensitiveAction
          title={offer ? "Mudar a quantidade da oferta" : "Criar a oferta"}
          description={offer
            ? `${subject}: de ${offer.quantity} para ${parseQuantity(quantity)}. Não pode ficar abaixo do que já foi autorizado no mês.`
            : `${subject}: ${parseQuantity(quantity)} no mês. ${AUTHORIZABLE_NOTE}`}
          requiresStepUp
          confirmLabel="Confirmar"
          run={save}
          onDone={() => onSaved(offer ? "Quantidade da oferta atualizada." : "Oferta criada.")}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => regulationError(err)}
        />
      )}
    </section>
  );
}

const chosenStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
