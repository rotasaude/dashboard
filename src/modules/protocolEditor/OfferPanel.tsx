// src/modules/protocolEditor/OfferPanel.tsx
// Painel "Oferta e sugestões" (módulo 15; spec §7), ao lado do JSON. Lê
// `offer` e `suggestions` da definição a cada render e devolve uma definição
// nova a cada edição: o JSON continua a fonte, e o que muda num lado aparece
// no outro. O conteúdo é parte da versão assinada (ADR 0016).
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ConditionBuilder } from "../protocols/ConditionBuilder";
import { fieldsFor } from "../../lib/condition";
import {
  RETAKE_PRESETS, SUGGESTIONS_MAX, SUMMARY_MAX, TITLE_MAX, parseRetake, protocolNameOf, readOffer, retakeLabel,
  suggestionProblem, writeOffer, writeSuggestions, type OfferDraft, type SuggestionDraft
} from "../../lib/offer";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

export function OfferPanel({ definition, protocolNames, onChange }: {
  definition: unknown | null; protocolNames: string[]; onChange(next: unknown): void;
}) {
  if (definition === null) return <Section><p style={hint}>Corrija o JSON para editar a oferta e as sugestões.</p></Section>;
  const read = readOffer(definition);
  if (!read.ok) return <Section><p role="alert" style={alert}>{read.reason}</p></Section>;
  return (
    <OfferForm definition={definition} offer={read.offer} suggestions={read.suggestions}
      protocolNames={protocolNames} onChange={onChange} />
  );
}

function OfferForm({ definition, offer, suggestions, protocolNames, onChange }: {
  definition: unknown; offer: OfferDraft; suggestions: SuggestionDraft[]; protocolNames: string[]; onChange(next: unknown): void;
}) {
  const ownName = protocolNameOf(definition);
  const eligibilityFields = useMemo(() => fieldsFor("eligibility"), []);
  const suggestionFields = fieldsFor("suggestion", { definition });
  const choices = protocolNames.filter((n) => n !== ownName);
  const setOffer = (patch: Partial<OfferDraft>) => onChange(writeOffer(definition, { ...offer, ...patch }));
  const setSuggestions = (list: SuggestionDraft[]) => onChange(writeSuggestions(definition, list));
  const replace = (i: number, next: SuggestionDraft) => setSuggestions(suggestions.map((s, j) => (j === i ? next : s)));

  return (
    <Section>
      <label style={label}>
        Título no catálogo
        <input value={offer.title} maxLength={TITLE_MAX} style={inputStyle} onChange={(e) => setOffer({ title: e.target.value })} />
      </label>
      <small style={hint}>{offer.title.length}/{TITLE_MAX} · sem título, o cidadão vê o nome do protocolo</small>
      <label style={label}>
        Resumo
        <textarea value={offer.summary} maxLength={SUMMARY_MAX} style={{ ...inputStyle, minHeight: 56 }}
          onChange={(e) => setOffer({ summary: e.target.value })} />
      </label>
      <small style={hint}>{offer.summary.length}/{SUMMARY_MAX}</small>

      <ConditionBuilder label="Quem pode fazer (elegibilidade)" fields={eligibilityFields} value={offer.eligibility}
        emptyText="para todos" onChange={(tree) => setOffer({ eligibility: tree })} />

      <RetakeField days={offer.retakeAfterDays} onChange={(days) => setOffer({ retakeAfterDays: days })} />

      <h3 style={{ fontSize: 14, margin: "8px 0 0" }}>Sugestões ao fim da triagem</h3>
      <p style={hint}>Aparecem em “Recomendamos também” e ficam pendentes no catálogo do cidadão. Resultado urgente nunca sugere.</p>
      {suggestions.map((s, i) => {
        const problem = suggestionProblem(s, ownName);
        return (
          <div key={i} role="group" aria-label={`sugestão ${i + 1}`} style={card}>
            <label style={label}>
              Protocolo sugerido
              <select value={s.protocol} style={inputStyle} onChange={(e) => replace(i, { ...s, protocol: e.target.value })}>
                <option value="">escolha…</option>
                {choices.map((n) => <option key={n} value={n}>{n}</option>)}
                {s.protocol !== "" && !choices.includes(s.protocol) && (
                  <option value={s.protocol}>
                    {s.protocol} {s.protocol === ownName ? "(este protocolo)" : "(não existe nesta cidade)"}
                  </option>
                )}
              </select>
            </label>
            <ConditionBuilder label="Quando sugerir" fields={suggestionFields} value={s.when} emptyText="—"
              onChange={(tree) => replace(i, { ...s, when: tree })} />
            {problem && <small style={hint}>{problem}</small>}
            <div>
              <button type="button" style={secondaryButtonStyle}
                onClick={() => setSuggestions(suggestions.filter((_, j) => j !== i))}>remover sugestão</button>
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" disabled={suggestions.length >= SUGGESTIONS_MAX}
          style={suggestions.length >= SUGGESTIONS_MAX ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => setSuggestions([ ...suggestions, { protocol: "", when: null } ])}>+ sugestão</button>
      </div>
    </Section>
  );
}

// O texto digitado fica local: "0" ou "1,5" mostram o motivo e não chegam ao
// JSON. Só um valor válido (ou o campo vazio) grava.
function RetakeField({ days, onChange }: { days: number | null; onChange(days: number | null): void }) {
  const [ text, setText ] = useState(days === null ? "" : String(days));
  useEffect(() => {
    if (parseRetake(text).days !== days) setText(days === null ? "" : String(days));
  }, [ days ]);
  const { problem } = parseRetake(text);

  function type(value: string) {
    setText(value);
    const parsed = parseRetake(value);
    if (!parsed.problem) onChange(parsed.days);
  }

  return (
    <div role="group" aria-label="Intervalo para refazer" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={label}>
        Intervalo para refazer (dias)
        <input inputMode="numeric" value={text} style={inputStyle} onChange={(e) => type(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {RETAKE_PRESETS.map((p) => (
          <button key={p.label} type="button" aria-pressed={p.days === days} style={secondaryButtonStyle}
            onClick={() => { setText(p.days === null ? "" : String(p.days)); onChange(p.days); }}>
            {p.label}
          </button>
        ))}
      </div>
      {problem ? <small role="alert" style={alert}>{problem}</small> : <small style={hint}>{retakeLabel(days)}</small>}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section aria-label="Oferta e sugestões" style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</section>;
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid var(--rule)", borderRadius: 8 };
