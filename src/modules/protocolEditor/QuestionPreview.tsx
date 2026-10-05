// src/modules/protocolEditor/QuestionPreview.tsx
// Pré-visualização das perguntas no visual do wpda (módulo 15; spec §7). Uma
// pergunta por vez, na ordem do JSON, sem seguir ramificações: o que se
// confere aqui é texto e opções. Nenhum botão do "celular" responde nada.
import { useState } from "react";
import { secondaryButtonStyle, disabledButtonStyle } from "../../components/formStyles";
import { WPDA } from "./wpdaLook";

export interface PreviewStep { id: string; prompt: string; answerType: string; options: string[] }

export function previewSteps(definition: unknown): PreviewStep[] {
  const steps = definition && typeof definition === "object" ? (definition as { steps?: unknown }).steps : undefined;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && !Array.isArray(s))
    .map((s) => {
      const id = String(s.id ?? "");
      const answerType = typeof s.answer_type === "string" ? s.answer_type : "";
      const options = answerType === "boolean"
        ? [ "Sim", "Não" ]
        : Array.isArray(s.options) ? s.options.filter((o): o is string => typeof o === "string") : [];
      return { id, prompt: typeof s.prompt === "string" && s.prompt ? s.prompt : id, answerType, options };
    });
}

export function QuestionPreview({ definition }: { definition: unknown | null }) {
  const steps = previewSteps(definition);
  const [ index, setIndex ] = useState(0);
  if (steps.length === 0) return null;
  const i = Math.min(index, steps.length - 1);
  const step = steps[i];
  const choice = step.answerType === "boolean" || step.answerType === "enum";
  const typed = step.answerType === "integer" || step.answerType === "text";
  const nav = (disabled: boolean) => (disabled ? disabledButtonStyle : secondaryButtonStyle);

  return (
    <section aria-label="Como o cidadão vê" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Como o cidadão vê (wpda)</h3>
      <div style={WPDA.screen}>
        <strong style={WPDA.brand}>Rota Saúde</strong>
        <h4 style={WPDA.title}>{step.prompt}</h4>
        <p style={WPDA.counter}>Pergunta {i + 1} de {steps.length}</p>
        <progress value={i + 1} max={steps.length} style={WPDA.progress} />
        {choice && (
          <div style={{ display: "grid", gap: 12 }}>
            {step.options.map((o) => (
              <button key={o} type="button" tabIndex={-1} style={{ ...WPDA.button, ...WPDA.secondary }}>{o}</button>
            ))}
          </div>
        )}
        {typed && (
          <div style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 600 }}>{step.prompt}</span>
            <input aria-label="campo do cidadão" readOnly tabIndex={-1} style={WPDA.field}
              inputMode={step.answerType === "integer" ? "numeric" : undefined} />
          </div>
        )}
        <div style={{ display: "grid", gap: 12, paddingTop: 16 }}>
          {!choice && <button type="button" tabIndex={-1} style={{ ...WPDA.button, ...WPDA.primary }}>Continuar</button>}
          {i > 0 && <button type="button" tabIndex={-1} style={{ ...WPDA.button, ...WPDA.secondary }}>Voltar</button>}
        </div>
        <p style={WPDA.footer}>Em emergência, ligue 192.</p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={i === 0} style={nav(i === 0)} onClick={() => setIndex(i - 1)}>← pergunta anterior</button>
        <button type="button" disabled={i === steps.length - 1} style={nav(i === steps.length - 1)}
          onClick={() => setIndex(i + 1)}>próxima pergunta →</button>
      </div>
    </section>
  );
}
