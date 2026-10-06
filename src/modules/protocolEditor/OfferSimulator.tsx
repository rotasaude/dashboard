// src/modules/protocolEditor/OfferSimulator.tsx
// Simulador de perfil (módulo 15; spec §7; contratos §4.3): confere a
// elegibilidade e as sugestões DESTA definição para um perfil, sem gravar
// nada. A restrição da cidade não entra — ela mora no Catálogo de triagens.
import { useState, type CSSProperties } from "react";
import { simulateOffer, type Sex, type SimulateOfferResult, type SimulateOutcome } from "../../lib/api";
import { parseDefinition } from "../../lib/editor";
import { tiersOf } from "../../lib/condition";
import { MAX_AGE, SEX_OPTIONS } from "../../lib/profile";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";

const INTEGER = /^-?\d+$/;

export function OfferSimulator({ definition, valid, answers }: { definition: unknown | null; valid: boolean; answers: string }) {
  const [ age, setAge ] = useState("62");
  const [ sex, setSex ] = useState<Sex>("female");
  const [ tier, setTier ] = useState("");
  const [ score, setScore ] = useState("");
  const [ priority, setPriority ] = useState("");
  const [ shown, setShown ] = useState<{ key: string; result: SimulateOfferResult } | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  const ageOk = /^\d+$/.test(age) && Number(age) <= MAX_AGE;
  const optionalOk = [ score, priority ].every((v) => v.trim() === "" || INTEGER.test(v.trim()));
  const can = valid && definition !== null && ageOk && optionalOk && !busy;

  // Chave das entradas: o resultado só vale enquanto elas não mudam.
  const inputKey = JSON.stringify([ definition, answers, age, sex, tier, score.trim(), priority.trim() ]);
  const result = shown && shown.key === inputKey ? shown.result : null;

  async function run() {
    if (!can) return;
    const parsed = parseDefinition(answers);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      setError("respostas: JSON inválido");
      return;
    }
    const outcome: SimulateOutcome = {
      ...(tier ? { tier } : {}),
      ...(score.trim() ? { score: Number(score) } : {}),
      ...(priority.trim() ? { priority: Number(priority) } : {})
    };
    setBusy(true); setError(null);
    const key = inputKey;
    try {
      const res = await simulateOffer({
        definition, profile: { age: Number(age), sex, neighborhood_id: null },
        answers: parsed.value as Record<string, string>,
        ...(Object.keys(outcome).length > 0 ? { outcome } : {})
      });
      setShown({ key, result: res });
    } catch {
      setError("não foi possível simular — tente de novo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Simulador de perfil" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Simulador de perfil</h3>
      <p style={hint}>
        Confere a elegibilidade e as sugestões desta definição para um perfil, com as respostas acima. Não grava nada.
        A restrição da cidade não entra aqui: ela fica no Catálogo de triagens.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={label}>Idade<input type="number" value={age} style={small} onChange={(e) => setAge(e.target.value)} /></label>
        <label style={label}>
          Sexo
          <select value={sex} style={small} onChange={(e) => setSex(e.target.value as Sex)}>
            {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={label}>
          Classificação
          <select value={tier} style={small} onChange={(e) => setTier(e.target.value)}>
            <option value="">—</option>
            {tiersOf(definition).map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={label}>Pontuação<input type="number" value={score} style={small} onChange={(e) => setScore(e.target.value)} /></label>
        <label style={label}>Prioridade<input type="number" value={priority} style={small} onChange={(e) => setPriority(e.target.value)} /></label>
      </div>
      {(!ageOk || !optionalOk) && (
        <small role="alert" style={alert}>idade de 0 a {MAX_AGE}; pontuação e prioridade, números inteiros</small>
      )}
      <div>
        <button type="button" disabled={!can} style={can ? buttonStyle : disabledButtonStyle} onClick={() => void run()}>Simular</button>
      </div>
      {!valid && <small style={hint}>Corrija os erros para simular.</small>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {result && <SimulationResult result={result} />}
    </section>
  );
}

function SimulationResult({ result }: { result: SimulateOfferResult }) {
  return (
    <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
      <strong>
        {result.eligible
          ? "Elegível: a triagem aparece no catálogo deste perfil"
          : "Não elegível: a triagem não aparece para este perfil"}
      </strong>
      {result.eligibility_text && <small style={hint}>Regra conferida pelo servidor: {result.eligibility_text}</small>}
      {result.suggestions.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {result.suggestions.map((s, i) => <li key={`${s.protocol}-${i}`}>{s.title ?? s.protocol}: {s.matches ? "sugere" : "não sugere"}</li>)}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <div>
          <small style={hint}>Avisos (não impedem a publicação):</small>
          <ul aria-label="avisos" style={{ ...hint, margin: 0, paddingLeft: 18 }}>
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      {result.errors.length > 0 && (
        <ul role="alert" style={{ ...alert, paddingLeft: 18 }}>
          {result.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const small: CSSProperties = { ...inputStyle, width: 110 };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
