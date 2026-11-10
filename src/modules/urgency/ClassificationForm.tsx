// Classificação de risco na UPA (módulo 32a, F-32.3; contrato §5, §14 Q1–Q3, Q18, Q19, Q22). Só a enfermagem 2235 com vínculo na UPA
// chega aqui (a mesa só oferece a ela; o técnico 3222 receberia cbo_not_allowed).
// - Queixa principal (3–500), os sinais vitais do 18 sem a dor e a dor à parte, obrigatória (Q3/Q22).
// - A cor sugerida vem do api (`suggest`, não grava nem deixa trilha), só depois da dor e com os sinais plausíveis, com espera curta
//   enquanto se digita; resposta velha é ignorada (`seq`). A queixa não entra na sugestão (o api a ignora), então não vai no pedido.
//   Enquanto a sugestão está sendo calculada, não se envia: o corpo depende dela (a justificativa vai só quando exigida, E11).
// - A cor final é sempre escolha de quem classifica (nada pré-marcado). Cor diferente da sugerida, ou sem sugestão, pede
//   "Justificativa" (10–500); `justification_required` do api também a pede e mantém tudo o que foi digitado.
// - Reclassificar é o mesmo formulário (qualquer estado antes do encerramento); o resumo mostra a cor vigente e o histórico.
// - Sigilo: queixa e sinais só no corpo do pedido; nunca em URL, console ou Analytics. A chave do detalhe leva só o id.
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  classifyUrgency, getUrgencyEncounter, suggestUrgencyColor,
  type UrgencyColor, type UrgencyEncounter, type UrgencyLevel, type UrgencySuggestion
} from "../../lib/api";
import { EMPTY_VITALS_FORM, VITALS, bmiOf, parseVitals, type VitalKey, type VitalsForm, type VitalsProblems } from "../../lib/screening";
import {
  DEFAULT_LEVELS, NOMINAL_QUERY, URGENCY_COLORS, URGENCY_COLOR_TONE, URGENCY_DETAIL_KEY, URGENCY_ERRORS, classificationBody,
  chars, classificationProblems, colorLabel, justificationNeeded, maxWaitLabel, painValue, urgencyError, urgencyRefusals,
  type ClassificationDraft
} from "../../lib/urgency";
import type { Refusal } from "../../lib/pharmacy";
import { useDebouncedValue } from "../../lib/useDebouncedValue";
import { useLeaveGuard } from "../../lib/useLeaveGuard";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { VitalSignsFields } from "../attendance/VitalSignsFields";
import { EncounterSummary } from "./EncounterSummary";

export interface ClassificationFormProps {
  encounterId: string;
  suggestDelayMs?: number;
  onDone(encounter: UrgencyEncounter): void;
  onCancel(): void;
  // Algo digitado e não enviado (a mesa pergunta antes de fechar ou trocar o painel).
  onDirtyChange?(dirty: boolean): void;
}

export const PAIN_FIRST = "Informe a dor para ver a cor sugerida.";
export const FIX_VITALS_FIRST = "Corrija os sinais vitais para ver a cor sugerida.";
export const NO_SUGGESTION =
  "Sem cor sugerida: a cidade não tem protocolo ativo ou nenhuma regra casou. Explique a cor escolhida.";
export const SUGGESTION_FAILED = "Não foi possível calcular a cor sugerida agora. Explique a cor escolhida.";

// Q3: a dor vai à parte.
const OMIT: VitalKey[] = [ "pain_score" ];
const VITAL_FIELDS = new Set<string>([ ...VITALS.map((v) => v.key as string).filter((k) => k !== "pain_score"), "glucose_moment" ]);
// Os campos do formulário que mostram a recusa sob si (o resto vai ao topo).
const FORM_FIELDS = new Set([ "complaint", "pain_scale", "color", "justification" ]);

// Cada estado da prévia guarda a chave (sinais + dor + releitura) a que responde: só vale enquanto ela é a da tela.
type SuggestState =
  | { kind: "idle" } | { kind: "loading"; key: string } | { kind: "ready"; key: string; suggested: UrgencySuggestion["suggested"] }
  | { kind: "error"; key: string };
// A chave é "<sinais e dor>#<releitura>"; a primeira parte é a base (o que a pessoa digitou).
const baseOf = (key: string): string => key.slice(0, key.lastIndexOf("#"));

export function ClassificationForm({ encounterId, suggestDelayMs = 400, onDone, onCancel, onDirtyChange }: ClassificationFormProps) {
  const detail = useQuery({
    queryKey: [ URGENCY_DETAIL_KEY, encounterId ], queryFn: () => getUrgencyEncounter(encounterId), ...NOMINAL_QUERY
  });

  if (detail.isPending) return <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>;
  if (detail.isError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p role="alert" style={alertStyle}>{urgencyError(detail.error)}</p>
        <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button></div>
      </div>
    );
  }
  return <Form encounter={detail.data} suggestDelayMs={suggestDelayMs} onDone={onDone} onCancel={onCancel} onDirtyChange={onDirtyChange} />;
}

type FormProps = { encounter: UrgencyEncounter; suggestDelayMs: number } & Pick<ClassificationFormProps, "onDone" | "onCancel" | "onDirtyChange">;

function Form({ encounter, suggestDelayMs, onDone, onCancel, onDirtyChange }: FormProps) {
  const ids = useId();
  const [ complaint, setComplaint ] = useState("");
  const [ vitalsForm, setVitalsForm ] = useState<VitalsForm>(EMPTY_VITALS_FORM);
  const [ pain, setPain ] = useState("");
  const [ color, setColor ] = useState<UrgencyColor | null>(null);
  const [ justification, setJustification ] = useState("");
  // O api pediu a justificativa com uma sugestão que a tela não tinha: o campo fica, e ela vai no corpo, até chegar uma
  // sugestão nova para outros sinais ou outra dor (a base em que o api pediu).
  const [ forceBase, setForceBase ] = useState<string | null>(null);
  const forceJustification = forceBase !== null;
  const [ suggest, setSuggest ] = useState<SuggestState>({ kind: "idle" });
  const [ levels, setLevels ] = useState<UrgencyLevel[]>(DEFAULT_LEVELS);
  const [ refresh, setRefresh ] = useState(0);
  const [ tried, setTried ] = useState(false);
  const [ refusals, setRefusals ] = useState<Refusal[]>([]);
  const [ busy, setBusy ] = useState(false);
  const inFlight = useRef(false);
  const seq = useRef(0);

  // Os sinais sem a dor (o formulário dos sinais não tem o campo).
  const { vitals, problems: vitalProblems } = parseVitals({ ...vitalsForm, pain_score: "" });
  const painNum = painValue(pain);
  const vitalsOk = Object.keys(vitalProblems).length === 0;
  const inputKey = painNum !== null && vitalsOk ? `${JSON.stringify({ vitals, pain: painNum })}#${refresh}` : "";
  const settledKey = useDebouncedValue(inputKey, suggestDelayMs);

  useEffect(() => {
    if (!settledKey) { seq.current += 1; setSuggest({ kind: "idle" }); return; }
    const { vitals: v, pain: p } = JSON.parse(baseOf(settledKey)) as { vitals: typeof vitals; pain: number };
    const mine = ++seq.current;
    const key = settledKey;
    setSuggest({ kind: "loading", key });
    suggestUrgencyColor({ encounter_id: encounter.id, vital_signs: v, pain_scale: p })
      .then((s) => {
        if (mine !== seq.current) return;
        setSuggest({ kind: "ready", key, suggested: s.suggested });
        // Sugestão nova para outra base: o pedido de justificativa do api era para a antiga.
        setForceBase((fb) => (fb !== null && fb !== baseOf(key) ? null : fb));
        if (Array.isArray(s.levels) && s.levels.length > 0) setLevels(s.levels);
      })
      // A prévia não é recusa: sem alerta, a classificação segue com a justificativa.
      .catch(() => { if (mine === seq.current) setSuggest({ kind: "error", key }); });
  }, [ settledKey, encounter.id ]);
  // Resposta que chegar depois de fechar é ignorada.
  useEffect(() => () => { seq.current += 1; }, []);

  // A prévia só vale para a chave que está na tela: mudou a dor ou um sinal, a antiga some na hora e o envio espera a nova.
  const current = suggest.kind === "ready" || suggest.kind === "error" ? (suggest.key === inputKey ? suggest : null) : null;
  const pending = inputKey !== "" && current === null;
  const suggestedColor = current?.kind === "ready" ? current.suggested?.color ?? null : null;
  const decided = current !== null;
  // Para a regra da justificativa: com o pedido do api, como se não houvesse sugestão.
  const ruleSuggested = forceJustification ? null : suggestedColor;
  const askJustification = forceJustification || (decided && justificationNeeded(suggestedColor, color));

  const draft: ClassificationDraft = { complaint, vitals: vitalsForm, pain, color, justification };
  // Os problemas dos sinais o formulário do 18 já mostra sob cada campo: aqui não se repetem. A justificativa só conta com o
  // campo à vista (antes da sugestão, a dor ou os sinais já seguram o envio).
  const localProblems = classificationProblems(draft, ruleSuggested)
    .filter((p) => !p.path.startsWith("vital_signs.") && (p.path !== "justification" || askJustification));

  const fieldText = (path: string): string | null =>
    (tried ? localProblems.find((p) => p.path === path)?.text : undefined) ?? refusals.find((r) => r.path === path)?.text ?? null;
  // Recusas do api nos sinais: sob o campo, se a tela não tem já a sua frase.
  const serverVitals: VitalsProblems = {};
  for (const r of refusals) {
    const m = /^vital_signs\.(.+)$/.exec(r.path);
    if (m && VITAL_FIELDS.has(m[1])) serverVitals[m[1] as keyof VitalsProblems] = r.text;
  }
  const topRefusals = refusals.filter((r) => {
    if (FORM_FIELDS.has(r.path)) return false;
    const m = /^vital_signs\.(.+)$/.exec(r.path);
    return !(m && VITAL_FIELDS.has(m[1]));
  });

  // Algo digitado e não enviado: o navegador avisa ao sair (useLeaveGuard) e a mesa pergunta antes de fechar.
  const dirty = complaint !== "" || pain !== "" || color !== null || justification !== ""
    || JSON.stringify(vitalsForm) !== JSON.stringify(EMPTY_VITALS_FORM);
  useLeaveGuard(dirty && !busy);
  useEffect(() => { onDirtyChange?.(dirty); }, [ dirty, onDirtyChange ]);

  const closed = encounter.state === "closed";
  const reclassify = encounter.classifications.length > 0;
  const blocked = busy || pending;

  async function submit() {
    if (inFlight.current || blocked) return;
    setTried(true); setRefusals([]);
    if (!vitalsOk || localProblems.length > 0 || color === null) return;
    inFlight.current = true; setBusy(true);
    try {
      const res = await classifyUrgency(encounter.id, classificationBody({ ...draft, color }, vitals, ruleSuggested));
      onDone(res.encounter);
    } catch (err) {
      const list = urgencyRefusals(err);
      if (list.some((r) => r.code === "justification_required")) {
        setForceBase(baseOf(inputKey));
        // A sugestão do api mudou (ex.: protocolo ativado agora): pede de novo.
        setRefresh((n) => n + 1);
      }
      setRefusals(list);
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }

  const levelOf = (c: UrgencyColor) =>
    (levels.find((l) => l.color === c) ?? DEFAULT_LEVELS.find((l) => l.color === c) as UrgencyLevel).max_wait_minutes;
  const errId = (path: string) => `${ids}-err-${path}`;
  // O erro do campo o descreve (junto do aviso do texto congelado, quando o campo tem um).
  const describedBy = (path: string, extra?: string) => [ fieldText(path) ? errId(path) : null, extra ].filter(Boolean).join(" ") || undefined;
  const problemEl = (path: string) => {
    const text = fieldText(path);
    return text ? <small id={errId(path)} role="alert" style={problemStyle}>{text}</small> : null;
  };

  if (closed) {
    return (
      <div style={panel}>
        <EncounterSummary encounter={encounter} />
        <p role="alert" style={alertStyle}>{URGENCY_ERRORS.encounter_closed}</p>
        <div><button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button></div>
      </div>
    );
  }

  return (
    <div style={panel}>
      <EncounterSummary encounter={encounter} />
      {topRefusals.map((r, i) => <p key={`${r.code}-${i}`} role="alert" style={alertStyle}>{r.text}</p>)}

      <label style={label}>
        Queixa principal
        <textarea value={complaint} maxLength={500} style={{ ...inputStyle, minHeight: 48 }} aria-describedby={describedBy("complaint", `${ids}-complaint`)}
          aria-invalid={fieldText("complaint") ? true : undefined} onChange={(e) => setComplaint(e.target.value)} />
      </label>
      <span className="mono" style={hint}>{`${chars(complaint)}/500`}</span>
      {problemEl("complaint")}
      <FrozenTextNotice id={`${ids}-complaint`} />

      <VitalSignsFields form={vitalsForm} problems={{ ...serverVitals, ...vitalProblems }} alerts={[]} omit={OMIT}
        bmi={bmiOf(vitals.weight_kg, vitals.height_cm)} onChange={setVitalsForm} />

      <label style={{ ...label, maxWidth: 220 }}>
        Dor (0 a 10)
        <input value={pain} inputMode="numeric" style={inputStyle} aria-invalid={fieldText("pain_scale") ? true : undefined}
          aria-describedby={describedBy("pain_scale")}
          onChange={(e) => setPain(e.target.value)} />
      </label>
      {problemEl("pain_scale")}

      <fieldset aria-label="Cor" style={box}>
        <legend style={legend}>Cor</legend>
        <div role="status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          {inputKey === "" && <span style={hint}>{vitalsOk ? PAIN_FIRST : FIX_VITALS_FIRST}</span>}
          {pending && <span className="mono" style={hint}>calculando a sugestão…</span>}
          {current?.kind === "error" && <span style={hint}>{SUGGESTION_FAILED}</span>}
          {current?.kind === "ready" && current.suggested === null && <span>{NO_SUGGESTION}</span>}
          {current?.kind === "ready" && current.suggested !== null && (
            <>
              <Tag tone={URGENCY_COLOR_TONE[current.suggested.color]}>{colorLabel(current.suggested.color)}</Tag>
              <span>{`Sugerida: ${colorLabel(current.suggested.color)} — ${current.suggested.criterion}`}</span>
            </>
          )}
        </div>
        <div role="radiogroup" aria-label="Cor final" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {URGENCY_COLORS.map((c) => (
            <label key={c} style={radio}>
              <input type="radio" name={`${ids}-color`} checked={color === c} aria-label={`${colorLabel(c)} · ${maxWaitLabel(levelOf(c))}`}
                onChange={() => setColor(c)} />
              {/* Laranja: o tom de urgente com o texto (o tema não tem laranja). */}
              <Tag tone={URGENCY_COLOR_TONE[c]}>{colorLabel(c)}</Tag>
              <span style={hint}>{maxWaitLabel(levelOf(c))}</span>
            </label>
          ))}
        </div>
        {problemEl("color")}
        {askJustification && (
          <>
            <label style={label}>
              Justificativa
              <textarea value={justification} maxLength={500} style={{ ...inputStyle, minHeight: 56 }}
                aria-describedby={describedBy("justification", `${ids}-justification`)} aria-invalid={fieldText("justification") ? true : undefined}
                onChange={(e) => setJustification(e.target.value)} />
            </label>
            {problemEl("justification")}
            <FrozenTextNotice id={`${ids}-justification`} />
          </>
        )}
      </fieldset>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={blocked} onClick={() => void submit()} style={blocked ? disabledButtonStyle : buttonStyle}>
          {reclassify ? "Reclassificar" : "Classificar"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </div>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 12 };
const box: CSSProperties = { border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0, display: "flex", flexDirection: "column", gap: 8 };
const legend: CSSProperties = { fontSize: 13, fontWeight: 600 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const radio: CSSProperties = { display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12 };
const hint: CSSProperties = { fontSize: 12, color: "var(--ink3)" };
const problemStyle: CSSProperties = { fontSize: 11.5, color: "var(--down)" };
const alertStyle: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
