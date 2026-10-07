import { useEffect, useRef, useState } from "react";
import { gateProtocol, previewProtocol, saveProtocolDraft,
  listAuthorProtocols, loadProtocolDefinition, listAppointmentTypes,
  type AppointmentType, type GateResult, type PreviewResult, type DraftResult, type AuthorProtocolRow } from "../lib/api";
import { parseDefinition, stripIneligibleAnalytic, TEMPLATE } from "../lib/editor";
import { AnalyticQuestions } from "./protocolEditor/AnalyticQuestions";
import { OfferPanel } from "./protocolEditor/OfferPanel";
import { OfferSimulator } from "./protocolEditor/OfferSimulator";
import { QuestionPreview } from "./protocolEditor/QuestionPreview";
import { SchedulingPanel } from "./protocolEditor/SchedulingPanel";
import { RiskRulesPanel } from "./protocolEditor/RiskRulesPanel";
import { ScreeningSimulator } from "./protocolEditor/ScreeningSimulator";
import { SCREENING_TEMPLATE, isScreeningDefinition } from "../lib/riskRules";

export function ProtocolEditor() {
  const [ text, setText ] = useState<string>(TEMPLATE);
  const [ parseError, setParseError ] = useState<string | null>(null);
  const [ gate, setGate ] = useState<GateResult | null>(null);
  const [ answers, setAnswers ] = useState<string>("{}");
  const [ preview, setPreview ] = useState<PreviewResult | null>(null);
  const [ saved, setSaved ] = useState<DraftResult | null>(null);
  const [ offerKey, setOfferKey ] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const [ opts, setOpts ] = useState<AuthorProtocolRow[]>([]);
  const [ loadErr, setLoadErr ] = useState<string | null>(null);

  useEffect(() => {
    listAuthorProtocols().then(setOpts).catch(() => setOpts([]));
  }, []);

  // Tipos de atendimento para o painel "Agendamento". Leem a lista
  // municipal_admin, citizen_verifier, health_professional, protocol_author e
  // protocol_reviewer; null (403 de outro papel que chegue ao editor, ou falha
  // de rede) faz o painel usar texto livre com o padrão da chave.
  // Promise.resolve protege contra mock sem implementação.
  const [ types, setTypes ] = useState<AppointmentType[] | null>(null);
  useEffect(() => {
    Promise.resolve().then(() => listAppointmentTypes())
      .then((list) => setTypes(Array.isArray(list) ? list : null))
      .catch(() => setTypes(null));
  }, []);

  function onPick(value: string) {
    setLoadErr(null);
    setOfferKey(k => k + 1); // remonta o painel: condições meio digitadas não sobrevivem à troca
    if (value === "__new__") { setText(TEMPLATE); return; }
    if (value === "__new_screening__") { setText(SCREENING_TEMPLATE); return; }
    const [ name, version ] = value.split("@@");
    loadProtocolDefinition(name, version).then(def => {
      if (def) setText(JSON.stringify(def, null, 2));
      else setLoadErr("definição não encontrada");
    }).catch(() => setLoadErr("não foi possível carregar"));
  }

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
    // Módulo 14 (spec §7): `analytic` só vale em boolean/enum. Pergunta que
    // virou integer/text perde a marca aqui, e o texto passa a mostrar o que
    // foi salvo (Desvio 1 do plano: o editor é JSON, sem seletor de tipo).
    const { definition, removed } = stripIneligibleAnalytic(parsed.value);
    if (removed.length > 0) setText(JSON.stringify(definition, null, 2));
    saveProtocolDraft(definition).then(setSaved);
  }

  const current = parseDefinition(text);
  // Módulo 18: `kind: "screening"` troca a coluna da direita pelas regras de cor e o simulador do acolhimento.
  const screeningKind = current.ok && isScreeningDefinition(current.value);
  // Nomes de protocolo da cidade para a sugestão (um nome por protocolo, sem a versão).
  const protocolNames = [ ...new Set(opts.map((o) => o.name)) ].sort();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <section>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Definição (JSON)</h2>
        <select
          onChange={e => onPick(e.target.value)}
          defaultValue="__new__"
          style={{ display: "block", marginBottom: 8, fontSize: 13 }}
        >
          <option value="__new__">Nova (template)</option>
          <option value="__new_screening__">Novo acolhimento (modelo)</option>
          {opts.map(o => (
            <option key={`${o.name}@@${o.version}`} value={`${o.name}@@${o.version}`}>
              {o.name}@{o.version} ({o.status})
            </option>
          ))}
        </select>
        {loadErr && <p style={{ color: "var(--danger, #c00)", fontSize: 13 }}>{loadErr}</p>}
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
          {/* Avisos não bloqueiam (tipo inexistente/inativo do módulo 17, destino de
              sugestão do módulo 15); vêm do api como estão, em inglês. */}
          {!parseError && (gate?.warnings ?? []).length > 0 && (
            <ul style={{ color: "var(--warn, #a60)", margin: 0, paddingLeft: 18 }}>
              {(gate?.warnings ?? []).map((w, i) => <li key={i}>{`aviso: ${w}`}</li>)}
            </ul>
          )}
        </div>
        <AnalyticQuestions
          definition={current.ok ? current.value : null}
          onChange={(next) => setText(JSON.stringify(next, null, 2))}
        />
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

      {screeningKind ? (
        <section>
          <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Regras de cor (acolhimento)</h2>
          <RiskRulesPanel
            key={`risk-${offerKey}`}
            definition={current.ok ? current.value : null}
            onChange={(next) => setText(JSON.stringify(next, null, 2))}
          />
          <ScreeningSimulator definition={current.ok ? current.value : null} valid={valid} />
        </section>
      ) : (
      <section>
        <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Oferta e sugestões</h2>
        <OfferPanel
          key={`offer-${offerKey}`}
          definition={current.ok ? current.value : null}
          protocolNames={protocolNames}
          onChange={(next) => setText(JSON.stringify(next, null, 2))}
        />
        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>Agendamento</h2>
        <SchedulingPanel
          key={`sched-${offerKey}`}
          definition={current.ok ? current.value : null}
          types={types}
          onChange={(next) => setText(JSON.stringify(next, null, 2))}
        />
        <h2 style={{ fontSize: 16, margin: "16px 0 8px" }}>Preview ao vivo</h2>
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
        <QuestionPreview definition={current.ok ? current.value : null} />
        <OfferSimulator definition={current.ok ? current.value : null} valid={valid} answers={answers} />
      </section>
      )}
    </div>
  );
}
