// src/modules/protocolEditor/ScreeningSimulator.tsx
// Simulador do acolhimento (módulo 18; spec §8): confere a cor que ESTA
// definição sugeriria para um perfil, uma queixa e sinais vitais. Não grava
// nada e não usa o protocolo ativo da cidade.
import { useState, type CSSProperties } from "react";
import { simulateScreening, type Sex, type SimulateScreeningResult } from "../../lib/api";
import { COLOR_HINT, COLOR_LABEL, COLOR_TONE, EMPTY_VITALS_FORM, bmiOf, parseVitals, type VitalsForm } from "../../lib/screening";
import { MAX_AGE, SEX_OPTIONS } from "../../lib/profile";
import { Tag } from "../../components/Tag";
import { VitalSignsFields } from "../attendance/VitalSignsFields";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";

const CIAP2 = /^[A-Z]\d{2}$/;

export function ScreeningSimulator({ definition, valid }: { definition: unknown | null; valid: boolean }) {
  const [ age, setAge ] = useState("45");
  const [ sex, setSex ] = useState<Sex>("female");
  const [ code, setCode ] = useState("");
  const [ vitalsForm, setVitalsForm ] = useState<VitalsForm>(EMPTY_VITALS_FORM);
  const [ shown, setShown ] = useState<{ key: string; result: SimulateScreeningResult } | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  const { vitals, problems } = parseVitals(vitalsForm);
  const ciap = code.trim().toUpperCase();
  const ageOk = /^\d+$/.test(age) && Number(age) <= MAX_AGE;
  const codeOk = ciap === "" || CIAP2.test(ciap);
  const can = valid && definition !== null && ageOk && codeOk && Object.keys(problems).length === 0 && !busy;
  const inputKey = JSON.stringify([ definition, age, sex, ciap, vitals ]);
  const result = shown && shown.key === inputKey ? shown.result : null;

  async function run() {
    if (!can) return;
    setBusy(true); setError(null);
    const key = inputKey;
    try {
      const res = await simulateScreening({ definition, ciap2_code: ciap === "" ? null : ciap, vitals, profile: { age: Number(age), sex } });
      setShown({ key, result: res });
    } catch {
      setError("não foi possível simular — tente de novo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Simulador do acolhimento" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 14, margin: 0 }}>Simulador do acolhimento</h3>
      <p style={hint}>Confere a cor que esta definição sugeriria. Não grava nada e não usa o protocolo ativo da cidade.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={label}>Idade<input type="number" value={age} style={small} onChange={(e) => setAge(e.target.value)} /></label>
        <label style={label}>
          Sexo
          <select value={sex} style={small} onChange={(e) => setSex(e.target.value as Sex)}>
            {SEX_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={label}>Código CIAP-2<input value={code} placeholder="K86" style={small} onChange={(e) => setCode(e.target.value)} /></label>
      </div>
      <VitalSignsFields form={vitalsForm} problems={problems} alerts={[]}
        bmi={bmiOf(vitals.weight_kg, vitals.height_cm)} onChange={setVitalsForm} />
      {(!ageOk || !codeOk) && <small role="alert" style={alert}>{`idade de 0 a ${MAX_AGE}; código CIAP-2 como K86`}</small>}
      <div>
        <button type="button" disabled={!can} style={can ? buttonStyle : disabledButtonStyle} onClick={() => void run()}>Simular</button>
      </div>
      {!valid && <small style={hint}>Corrija os erros para simular.</small>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {result && (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          {result.suggested_color ? (
            <strong>Cor sugerida: <Tag tone={COLOR_TONE[result.suggested_color]}>{COLOR_LABEL[result.suggested_color]}</Tag> · {COLOR_HINT[result.suggested_color]}</strong>
          ) : (
            <strong>Nenhuma regra casou: sem cor sugerida</strong>
          )}
          {result.matched_rules.length > 0 && (
            <ul aria-label="regras que casaram" style={{ margin: 0, paddingLeft: 18 }}>
              {result.matched_rules.map((r) => <li key={r.index}>{`regra ${r.index + 1}: ${r.text}`}</li>)}
            </ul>
          )}
          {result.warnings.length > 0 && (
            <ul aria-label="avisos" style={{ ...hint, margin: 0, paddingLeft: 18 }}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {result.errors.length > 0 && (
            <ul role="alert" style={{ ...alert, paddingLeft: 18 }}>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const small: CSSProperties = { ...inputStyle, width: 110 };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
