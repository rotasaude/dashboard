import { useEffect, useRef, useState } from "react";
import { gateProtocol, previewProtocol, saveProtocolDraft,
  type GateResult, type PreviewResult, type DraftResult } from "../lib/api";
import { parseDefinition, TEMPLATE } from "../lib/editor";

export function ProtocolEditor() {
  const [ text, setText ] = useState<string>(TEMPLATE);
  const [ parseError, setParseError ] = useState<string | null>(null);
  const [ gate, setGate ] = useState<GateResult | null>(null);
  const [ answers, setAnswers ] = useState<string>("{}");
  const [ preview, setPreview ] = useState<PreviewResult | null>(null);
  const [ saved, setSaved ] = useState<DraftResult | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Live gate: debounced 400ms. Parse errors short-circuit (no network call).
  useEffect(() => {
    window.clearTimeout(timer.current);
    const parsed = parseDefinition(text);
    if (!parsed.ok) { setParseError(parsed.error); setGate(null); return; }
    setParseError(null);
    timer.current = window.setTimeout(() => {
      gateProtocol(parsed.value).then(setGate).catch(() => setGate(null));
    }, 400);
    return () => window.clearTimeout(timer.current);
  }, [ text ]);

  const valid = gate?.valid === true && !parseError;

  function runPreview() {
    const parsed = parseDefinition(text);
    const ans = parseDefinition(answers);
    if (!parsed.ok || !ans.ok) return;
    previewProtocol(parsed.value, ans.value as Record<string, string>).then(setPreview);
  }

  function save() {
    const parsed = parseDefinition(text);
    if (!parsed.ok) return;
    saveProtocolDraft(parsed.value).then(setSaved);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <section>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Definição (JSON)</h2>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          spellCheck={false}
          style={{ width: "100%", height: 360, fontFamily: "monospace", fontSize: 13 }}
        />
        <div style={{ marginTop: 8 }}>
          {parseError && <p style={{ color: "var(--danger, #c00)" }}>JSON inválido: {parseError}</p>}
          {!parseError && gate?.valid && <p style={{ color: "var(--ok, #2a7) " }}>válido ✓</p>}
          {!parseError && gate && !gate.valid && (
            <ul style={{ color: "var(--danger, #c00)", margin: 0, paddingLeft: 18 }}>
              {(gate.errors ?? []).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          )}
        </div>
        <button onClick={save} style={{ marginTop: 12 }}>Salvar rascunho</button>
        {saved && (
          <p style={{ marginTop: 8 }}>
            {saved.status
              ? `Salvo: ${saved.name}@${saved.version} (${saved.status})`
              : saved.error === "version_not_editable"
                ? "Essa versão já foi publicada; suba a versão."
                : saved.error === "forbidden"
                  ? "Sem permissão de autoria nesta cidade."
                  : `Erro: ${saved.message ?? saved.error}`}
          </p>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Preview ao vivo</h2>
        <label style={{ fontSize: 13 }}>Respostas (JSON step → resposta)</label>
        <textarea
          value={answers}
          onChange={e => setAnswers(e.target.value)}
          spellCheck={false}
          style={{ width: "100%", height: 80, fontFamily: "monospace", fontSize: 13 }}
        />
        <button onClick={runPreview} disabled={!valid} style={{ marginTop: 8 }}>Pré-visualizar</button>
        {!valid && <p style={{ color: "var(--ink3, #888)", fontSize: 13 }}>Corrija os erros para pré-visualizar.</p>}
        {preview?.outcome && (
          <pre style={{ marginTop: 8, fontSize: 12, background: "var(--surface, #f6f6f6)", padding: 8 }}>
            {JSON.stringify(preview.outcome, null, 2)}
          </pre>
        )}
      </section>
    </div>
  );
}
