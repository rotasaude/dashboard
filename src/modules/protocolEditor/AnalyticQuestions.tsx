// Caixa "Usar em Analytics" (módulo 14; spec §7), derivada do JSON do editor:
// só pergunta boolean/enum tem a caixa. Marca que sobrou numa pergunta que
// virou integer/text ganha aviso e sai ao salvar (ProtocolEditor.save).
import { ANALYTIC_HINT, analyticSteps, setAnalytic } from "../../lib/editor";

export function AnalyticQuestions({ definition, onChange }: { definition: unknown; onChange(next: unknown): void }) {
  const steps = analyticSteps(definition);
  if (steps.length === 0) return null;
  const eligible = steps.filter((s) => s.eligible);
  const stranded = steps.filter((s) => s.analytic && !s.eligible);

  return (
    <section aria-label="Perguntas para Analytics" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Perguntas para Analytics</h3>
      {eligible.length === 0 && (
        <p style={hintStyle}>Só perguntas de sim/não ou de lista podem ir para o Analytics.</p>
      )}
      {eligible.map((s) => (
        <fieldset key={s.id} style={{ border: "1px solid var(--rule)", borderRadius: 6, padding: "6px 10px", margin: 0 }}>
          <legend style={{ fontSize: 13 }}>{s.prompt}</legend>
          <label style={{ fontSize: 13, display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={s.analytic}
              onChange={(e) => onChange(setAnalytic(definition, s.id, e.target.checked))} />
            Usar em Analytics
          </label>
          <p style={hintStyle}>{ANALYTIC_HINT}</p>
        </fieldset>
      ))}
      {stranded.map((s) => (
        <p key={s.id} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>
          “{s.prompt}” não é de sim/não nem de lista: a marca de Analytics sai ao salvar.
        </p>
      ))}
      <p style={hintStyle}>A marca vale para a versão salva e passa pelas assinaturas como o resto do protocolo.</p>
    </section>
  );
}

const hintStyle = { margin: 0, fontSize: 12, color: "var(--ink3)" };
