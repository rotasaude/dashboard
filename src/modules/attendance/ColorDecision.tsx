// src/modules/attendance/ColorDecision.tsx
// Cor sugerida e cor final (módulo 18; spec §3.3; ADR 0030): a sugestão vem do
// protocolo assinado `acolhimento`, com o motivo (regras que casaram); a
// decisão é de quem escuta. Cor final diferente da sugerida pede justificativa.
import type { CSSProperties } from "react";
import type { ScreeningColor, ScreeningSuggestion } from "../../lib/api";
import { COLORS, COLOR_HINT, COLOR_LABEL, COLOR_TONE, needsColorReason } from "../../lib/screening";
import { Tag } from "../../components/Tag";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { inputStyle } from "../../components/formStyles";

export type SuggestionState =
  | { kind: "idle" } | { kind: "loading" } | { kind: "ready"; suggestion: ScreeningSuggestion } | { kind: "error"; message: string };

interface Props {
  state: SuggestionState;
  final: ScreeningColor | null;
  reason: string;
  // O api pediu justificativa (422 color_change_reason_required) com uma sugestão
  // que a tela ainda não tinha: o campo aparece mesmo sem diferença local.
  forceReason?: boolean;
  onFinal(color: ScreeningColor): void;
  onReason(text: string): void;
}

export function ColorDecision({ state, final, reason, forceReason = false, onFinal, onReason }: Props) {
  const suggested = state.kind === "ready" ? state.suggestion.suggested_color : null;
  const askReason = forceReason || needsColorReason(suggested, final);

  return (
    <fieldset aria-label="Classificação de risco" style={box}>
      <legend style={legend}>Classificação de risco</legend>
      <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
        {state.kind === "idle" && <span style={hint}>A cor sugerida aparece quando a queixa estiver escolhida.</span>}
        {state.kind === "loading" && <span className="mono" style={hint}>calculando a sugestão…</span>}
        {state.kind === "error" && <span style={{ color: "var(--down)" }}>{state.message}</span>}
        {state.kind === "ready" && suggested === null && (
          <span>Sem cor sugerida: nenhuma regra do protocolo de acolhimento casou, ou a cidade não tem protocolo ativo.</span>
        )}
        {state.kind === "ready" && suggested !== null && (
          <>
            <span>
              Cor sugerida: <Tag tone={COLOR_TONE[suggested]}>{COLOR_LABEL[suggested]}</Tag> · {COLOR_HINT[suggested]}
            </span>
            {state.suggestion.matched_rules.length > 0 && (
              <ul aria-label="motivo da sugestão" style={{ margin: 0, paddingLeft: 18, color: "var(--ink2)" }}>
                {state.suggestion.matched_rules.map((r) => <li key={r.index}>{r.text}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
      <div role="radiogroup" aria-label="Cor final" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {COLORS.map((c) => (
          <label key={c} style={radio}>
            <input type="radio" name="final-color" checked={final === c} onChange={() => onFinal(c)} />
            <Tag tone={COLOR_TONE[c]}>{COLOR_LABEL[c]}</Tag>
            <span style={hint}>{COLOR_HINT[c]}</span>
          </label>
        ))}
      </div>
      {askReason && (
        <>
          <label style={label}>
            Justificativa da mudança de cor
            <textarea value={reason} style={{ ...inputStyle, minHeight: 56 }} aria-describedby="color-reason-notice"
              onChange={(e) => onReason(e.target.value)} />
          </label>
          <FrozenTextNotice id="color-reason-notice" />
        </>
      )}
    </fieldset>
  );
}

const box: CSSProperties = { border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0, display: "flex", flexDirection: "column", gap: 8 };
const legend: CSSProperties = { fontSize: 13, fontWeight: 600 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const radio: CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 };
const hint: CSSProperties = { fontSize: 12, color: "var(--ink3)" };
