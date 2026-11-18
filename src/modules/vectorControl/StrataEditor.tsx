// src/modules/vectorControl/StrataEditor.tsx
// Estratos do levantamento LIRAa no rascunho e o sorteio (módulo 35a, F-35.6; contrato §7; Q16, Q17, Q24). Cada estrato: nome
// (1–60), tipo (padrão, reduzido, censitário: rótulos com a faixa dos parâmetros vigentes) e os quarteirões, escolhidos por bairro
// (todos do bairro, Q18; o número de imóveis do quarteirão ao lado). O N do estrato é o do api (Q24: recontado a cada gravação, SEM
// ponto estratégico), nunca a soma do `households_count` do quarteirão (que conta PE): com os quarteirões salvos, a faixa do tipo é
// conferida ao vivo (stratumRangeProblem) e trava "Salvar estratos" e "Sortear"; com quarteirões mudados, o N é recontado ao salvar
// e o sorteio pede salvar antes. Quarteirão de outro estrato aparece desabilitado (o api recusaria com stratum_overlap); inativo
// também (invalid_request), a não ser que já esteja escolhido (para poder tirar).
// "Salvar estratos" troca a lista inteira (PATCH { strata }); recusa com path strata[i]… cai no estrato i; 409/404 → a frase e
// UMA releitura. "Sortear" por SensitiveAction (step-up); o botão some enquanto a confirmação está aberta; 409 survey_not_draft →
// a frase e UMA releitura; 422 stratum_out_of_range path strata[i] (o sorteio reconta a base na hora) cai no estrato.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { drawLiraaSurvey, listPanelNeighborhoods, updateLiraaSurvey, type LiraaSurvey, type StratumMode, type VectorParameters } from "../../lib/api";
import { fmtNumber } from "../../lib/format";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { sortByName } from "../../lib/territory";
import type { useActionMessage } from "../../lib/useActionMessage";
import { STATIC_QUERY, isVectorStale, stratumModeLabel, stratumRangeProblem, vectorError, vectorRefusals } from "../../lib/vectorControl";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import { useBlocks } from "./BlocksPanel";
import { ActionButton } from "../../components/ActionButton";
import { SensitiveAction } from "../../components/SensitiveAction";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, row, stack } from "../exams/styles";

export const DRAW_DESCRIPTION = "O sorteio é feito uma vez, com início aleatório gravado. Depois dele os estratos não mudam.";
export const STRATA_SAVED = "estratos salvos — o número de imóveis de cada estrato foi recontado";
export const DRAWN = "sorteio feito — os itens e o índice estão abaixo";
export const SAVE_FIRST = "salve os estratos antes de sortear";
export const NO_STRATA = "adicione ao menos um estrato";
export const N_ON_SAVE = "o número de imóveis é recontado ao salvar (sem ponto estratégico)";
export const STRATUM_NAME_PROBLEM = "o nome do estrato tem de 1 a 60 caracteres";
export const FIX_TO_SAVE = "corrija os estratos marcados antes de salvar";
export const FIX_TO_DRAW = "corrija os estratos marcados antes de sortear";
export const OUT_OF_RANGE_RECOUNT = `${VECTOR_ERRORS.stratum_out_of_range} — salve os estratos de novo para recontar os imóveis`;
// SaveSurvey::STRATA_MAX e BLOCKS_MAX.
const STRATA_MAX = 50;
const BLOCKS_MAX = 5000;
const MODES: StratumMode[] = [ "standard", "half", "census" ];

type Msg = ReturnType<typeof useActionMessage>;
type Draft = { key: number; savedId: string | null; name: string; mode: StratumMode; block_ids: string[]; neighborhoodId: string };
type Saved = LiraaSurvey["strata"][number];

const length = (s: string) => [ ...s.trim() ].length;
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
const sameSet = (a: string[], b: string[]) => a.length === b.length && b.every((id) => a.includes(id));
const blocksText = (k: number) => (k === 1 ? "1 quarteirão escolhido" : `${fmtNumber(k)} quarteirões escolhidos`);

export function StrataEditor({ survey, params, msg, onSaved, onDrawn, onStale, onGoToSecurity }: {
  survey: LiraaSurvey; params: VectorParameters; msg: Msg; onSaved(s: LiraaSurvey): Promise<void>; onDrawn(s: LiraaSurvey): Promise<void>;
  onStale(): Promise<void>; onGoToSecurity?: () => void;
}) {
  const nextKey = useRef(survey.strata.length);
  const [ draft, setDraft ] = useState<Draft[]>(() => survey.strata.map((s, i) => ({
    key: i, savedId: s.id, name: s.name, mode: s.mode, block_ids: [ ...s.block_ids ], neighborhoodId: ""
  })));
  // Recusas do api por estrato (pela chave): somem quando o estrato muda.
  const [ apiProblems, setApiProblems ] = useState<Record<number, string>>({});
  const [ confirming, setConfirming ] = useState(false);
  const drawn = useRef<LiraaSurvey | null>(null);
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, ...STATIC_QUERY });

  const saved = (d: Draft): Saved | undefined => survey.strata.find((s) => s.id === d.savedId);
  // Q24: o N do api vale só enquanto os quarteirões são os salvos; o tipo e o nome não mudam o N.
  const knownN = (d: Draft): number | null => {
    const s = saved(d);
    return s && s.households_count !== null && sameSet(s.block_ids, d.block_ids) ? s.households_count : null;
  };
  const problems = (d: Draft): string[] => {
    const out: string[] = [];
    if (length(d.name) < 1 || length(d.name) > 60) out.push(STRATUM_NAME_PROBLEM);
    const b = d.block_ids.length;
    if (b === 0) out.push(stratumRangeProblem(d.mode, 0, params, 0) as string);
    else if (b > BLOCKS_MAX) out.push(`no máximo ${fmtNumber(BLOCKS_MAX)} quarteirões por estrato`);
    else {
      const n = knownN(d);
      const range = n === null ? null : stratumRangeProblem(d.mode, n, params, b);
      if (range) out.push(range);
    }
    return out;
  };
  const dirty = draft.length !== survey.strata.length || draft.some((d, i) => {
    const s = survey.strata[i];
    return d.savedId !== s.id || d.name.trim() !== s.name || d.mode !== s.mode || !sameList(d.block_ids, s.block_ids);
  });
  const invalid = draft.some((d) => problems(d).length > 0);
  const saveReason = invalid ? FIX_TO_SAVE : null;
  const drawReason = invalid ? FIX_TO_DRAW : draft.length === 0 ? NO_STRATA
    : dirty || survey.strata.some((s) => s.households_count === null) ? SAVE_FIRST : null;

  // O dono de cada quarteirão (índice do estrato), para desabilitar o quarteirão nos outros.
  const ownerOf = new Map<string, number>();
  draft.forEach((d, i) => d.block_ids.forEach((id) => ownerOf.set(id, i)));
  const nameOf = (i: number) => draft[i].name.trim() || `Estrato ${i + 1}`;

  function change(key: number, f: (d: Draft) => Draft) {
    setDraft((list) => list.map((d) => (d.key === key ? f(d) : d)));
    setApiProblems((p) => { const { [key]: _, ...rest } = p; return rest; });
    setConfirming(false);
    msg.start();
  }
  function add() {
    const key = nextKey.current++;
    setDraft((list) => [ ...list, { key, savedId: null, name: `Estrato ${list.length + 1}`, mode: "standard", block_ids: [], neighborhoodId: "" } ]);
    setConfirming(false);
    msg.start();
  }
  function remove(key: number) {
    setDraft((list) => list.filter((d) => d.key !== key));
    setApiProblems((p) => { const { [key]: _, ...rest } = p; return rest; });
    setConfirming(false);
    msg.start();
  }

  // Recusa com path strata[i]…: no estrato i. Devolve se coube num estrato.
  function onStratum(err: unknown): boolean {
    const refusal = vectorRefusals(err)[0];
    const m = /^strata\[(\d+)\]/.exec(refusal.path);
    const d = m ? draft[Number(m[1])] : undefined;
    if (!d) return false;
    const text = refusal.code === "stratum_out_of_range" ? OUT_OF_RANGE_RECOUNT : refusal.text;
    setApiProblems((p) => ({ ...p, [d.key]: text }));
    return true;
  }

  async function save() {
    msg.start();
    if (saveReason) return;
    try {
      const result = await updateLiraaSurvey(survey.id, { strata: draft.map((d) => ({ name: d.name.trim(), mode: d.mode, block_ids: d.block_ids })) });
      msg.ok(STRATA_SAVED);
      await onSaved(result);
    } catch (err) {
      if (isVectorStale(err)) { msg.fail(vectorError(err)); await onStale(); return; }
      if (!onStratum(err)) msg.fail(vectorError(err));
    }
  }

  return (
    <div style={stack}>
      {draft.map((d, i) => {
        const found = [ ...problems(d), ...(apiProblems[d.key] ? [ apiProblems[d.key] ] : []) ];
        const n = knownN(d);
        const nameId = `lr-name-${survey.id}-${d.key}`;
        return (
          <fieldset key={d.key} style={fieldset}>
            <legend style={legend}>{`Estrato ${i + 1}`}</legend>
            <div style={row}>
              <label style={{ ...fieldLabel, minWidth: 200 }}>
                Nome do estrato
                <input value={d.name} style={inputStyle} aria-invalid={problems(d).includes(STRATUM_NAME_PROBLEM) || undefined}
                  aria-describedby={found.length > 0 ? nameId : undefined} onChange={(e) => change(d.key, (x) => ({ ...x, name: e.target.value }))} />
              </label>
              <label style={{ ...fieldLabel, minWidth: 220 }}>
                Tipo
                <select value={d.mode} style={inputStyle} onChange={(e) => change(d.key, (x) => ({ ...x, mode: e.target.value as StratumMode }))}>
                  {MODES.map((m) => <option key={m} value={m}>{stratumModeLabel(m, params)}</option>)}
                </select>
              </label>
              <button type="button" style={secondaryButtonStyle} onClick={() => remove(d.key)}>{`Remover estrato ${i + 1}`}</button>
            </div>
            <p style={muted}>{blocksText(d.block_ids.length)}</p>
            {n !== null && <p style={muted}>{`N = ${fmtNumber(n)} imóveis (sem ponto estratégico)`}</p>}
            {n === null && d.block_ids.length > 0 && <p style={muted}>{N_ON_SAVE}</p>}
            {found.length > 0 && (
              <div id={nameId} style={stack}>
                {found.map((t) => <p key={t} style={alert}>{t}</p>)}
              </div>
            )}
            <label style={{ ...fieldLabel, maxWidth: 320 }}>
              Bairro
              <select value={d.neighborhoodId} style={inputStyle} disabled={neighborhoods.isPending}
                onChange={(e) => setDraft((list) => list.map((x) => (x.key === d.key ? { ...x, neighborhoodId: e.target.value } : x)))}>
                <option value="">escolha o bairro</option>
                {sortByName(neighborhoods.data ?? []).map((nb) => (
                  <option key={nb.id} value={nb.id}>{nb.active ? nb.name : `${nb.name} (inativo)`}</option>
                ))}
              </select>
            </label>
            {neighborhoods.isError && <p style={alert}>{vectorError(neighborhoods.error)}</p>}
            {d.neighborhoodId === "" ? <p style={muted}>escolha um bairro para ver os quarteirões</p>
              : <BlockChoices neighborhoodId={d.neighborhoodId} chosen={d.block_ids} owner={(id) => {
                const o = ownerOf.get(id);
                return o === undefined || o === i ? null : nameOf(o);
              }} onToggle={(id, on) => change(d.key, (x) => ({ ...x, block_ids: on ? [ ...x.block_ids, id ] : x.block_ids.filter((b) => b !== id) }))} />}
          </fieldset>
        );
      })}
      <div style={row}>
        <ActionButton variant="secondary" onClick={add} disabledReason={draft.length >= STRATA_MAX ? `no máximo ${STRATA_MAX} estratos` : null}>
          Adicionar estrato
        </ActionButton>
        <ActionButton onClick={save} disabledReason={saveReason}>Salvar estratos</ActionButton>
        {!confirming && <ActionButton onClick={() => { msg.start(); setConfirming(true); }} disabledReason={drawReason}>Sortear</ActionButton>}
      </div>
      {confirming && (
        <SensitiveAction
          title="Sortear o levantamento"
          description={DRAW_DESCRIPTION}
          requiresStepUp
          run={async () => { drawn.current = await drawLiraaSurvey(survey.id); }}
          onDone={() => { setConfirming(false); msg.ok(DRAWN); if (drawn.current) void onDrawn(drawn.current); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => {
            // A confirmação fecha; a frase fica na tela do levantamento (sobrevive à troca para o sorteado).
            setConfirming(false);
            if (isVectorStale(e)) { msg.fail(vectorError(e)); void onStale(); return vectorError(e); }
            if (!onStratum(e)) msg.fail(vectorError(e));
            return vectorError(e);
          }}
        />
      )}
    </div>
  );
}
function BlockChoices({ neighborhoodId, chosen, owner, onToggle }: {
  neighborhoodId: string; chosen: string[]; owner(id: string): string | null; onToggle(id: string, on: boolean): void;
}) {
  const blocks = useBlocks(neighborhoodId);
  if (blocks.isError) return <p role="alert" style={alert}>{vectorError(blocks.error)}</p>;
  if (!blocks.data) return <p role="status" style={muted}>Carregando…</p>;
  if (blocks.data.length === 0) return <p style={muted}>nenhum quarteirão neste bairro</p>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 6 }}>
      {blocks.data.map((b) => {
        const checked = chosen.includes(b.id);
        const other = owner(b.id);
        const disabled = !!other || (!b.active && !checked);
        return (
          <label key={b.id} style={{ ...checkLabel, opacity: disabled ? 0.6 : 1 }}>
            <input type="checkbox" aria-label={`Quarteirão ${b.number}`} checked={checked} disabled={disabled}
              onChange={(e) => onToggle(b.id, e.target.checked)} />
            <span>{`Quarteirão ${b.number}`}</span>
            <span style={muted}>{`${fmtNumber(b.households_count)} imóveis`}</span>
            {other && <span style={muted}>{`já em ${other}`}</span>}
            {!b.active && <span style={muted}>inativo</span>}
          </label>
        );
      })}
    </div>
  );
}
