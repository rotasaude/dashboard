// src/modules/zoonoses/SurveyForm.tsx
// Inquérito canino de leishmaniose (módulo 35b, F-35.15): o rascunho da coordenação e o detalhe. Os quarteirões, a população e
// os cães a examinar vêm da sugestão do api (`POST /zoonoses/leish_surveys/suggest`, Q28): no foco, o api amplia os anéis em volta
// do quarteirão central até o mínimo de cães (ou 5 anéis) e, sem chegar, `below_focus_min`. A tela nunca calcula `target_dogs`
// nem a prevalência: mostra o que o api devolve. Editar só em `draft`, com `expected_version`; 409 vai ao pai, que relê UMA vez.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  createLeishSurvey, getLeishSurvey, getZooParameters, listCityBlocks, listPanelNeighborhoods, suggestLeishSurvey, updateLeishSurvey,
  type LeishSuggestion, type LeishSurvey, type LeishSurveyDetail, type LeishSurveyInput, type SurveyKind
} from "../../lib/api";
import { fmtDay, textProblem } from "../../lib/homeVisits";
import {
  STATIC_QUERY, ZOO_PARAMS_KEY, ZOO_SURVEYS_KEY, focusBelowMinText, isZoonosesStale, sampleCensusText, zooLabel, zoonosesError, zoonosesRefusals
} from "../../lib/zoonoses";
import type { Problem } from "../../lib/pharmacy";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ActionButton } from "../../components/ActionButton";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, panel, row, title } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { useZooDomains } from "./useZooDomains";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const OWN = [ "name", "kind", "neighborhood_id", "center_city_block_id", "rings", "city_block_ids", "dog_population", "starts_on", "ends_on" ];
const NOTHING_CHANGED = "nada mudou";
const FOCUS_MIN_DEFAULT = 100;

// Os parâmetros (leitura de quem lê o centro): o mínimo do foco e o `min_population` da 1ª linha da tabela da amostra.
function useLeishParams() {
  const v = useQuery({ queryKey: [ ZOO_PARAMS_KEY ], queryFn: getZooParameters, ...STATIC_QUERY }).data?.values;
  return { focusMin: v?.leish_focus_min_dogs ?? FOCUS_MIN_DEFAULT, sampleMin: v?.leish_sample_table[0]?.min_population ?? null };
}

export function SurveyForm({ survey, onSaved, onStale, onCancel }: {
  survey?: LeishSurvey; onSaved(d: LeishSurveyDetail): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const { focusMin } = useLeishParams();
  const f = useFormProblems({
    refusals: (err) => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isZoonosesStale(err)
  });
  const [ name, setName ] = useState(survey?.name ?? "");
  const [ kind, setKind ] = useState<string>(survey?.kind ?? "");
  const [ nb, setNb ] = useState(survey?.neighborhood_id ?? "");
  const [ center, setCenter ] = useState("");
  const [ rings, setRings ] = useState("1");
  const [ blocks, setBlocks ] = useState<string[]>(survey?.city_block_ids ?? []);
  const [ population, setPopulation ] = useState(survey ? String(survey.dog_population) : "");
  const [ startsOn, setStartsOn ] = useState(survey?.starts_on ?? "");
  const [ endsOn, setEndsOn ] = useState(survey?.ends_on ?? "");
  const [ suggestion, setSuggestion ] = useState<LeishSuggestion | null>(null);
  const [ suggesting, setSuggesting ] = useState(false);

  const neighborhoods = useQuery({ queryKey: [ "zooNeighborhoods" ], queryFn: listPanelNeighborhoods, ...STATIC_QUERY }).data ?? [];
  const blockList = useQuery({ queryKey: [ "zooBlocks", nb ], queryFn: () => listCityBlocks(nb), ...STATIC_QUERY, enabled: nb !== "" }).data ?? [];
  const activeBlocks = blockList.filter((b) => b.active || blocks.includes(b.id));
  const focus = kind === "focus";
  const busy = f.busy;

  async function suggest() {
    if (suggesting) return;
    const out: Problem[] = [];
    if (!kind) out.push({ path: "kind", text: "escolha o tipo do inquérito" });
    if (!nb) out.push({ path: "neighborhood_id", text: "escolha o bairro" });
    if (focus && !center) out.push({ path: "center_city_block_id", text: "escolha o quarteirão central" });
    if (focus && !/^[0-5]$/.test(rings)) out.push({ path: "rings", text: "anéis: de 0 a 5" });
    if (out.length > 0) { f.show(out); return; }
    setSuggesting(true);
    f.setProblems([]);
    try {
      const s = await suggestLeishSurvey({
        kind: kind as SurveyKind, neighborhood_id: nb, ...(focus ? { center_city_block_id: center, rings: Number(rings) } : {})
      });
      setSuggestion(s);
      setBlocks(s.city_block_ids);
      setPopulation(String(s.dog_population_suggested));
    } catch (err) {
      f.show([ { path: "", text: zoonosesError(err) } ]);
    } finally {
      setSuggesting(false);
    }
  }

  function check(): Problem[] {
    const out: Problem[] = [];
    const n = textProblem(name, { min: 1, max: 80, path: "name" });
    if (n) out.push(n);
    if (!kind) out.push({ path: "kind", text: "escolha o tipo do inquérito" });
    if (!nb) out.push({ path: "neighborhood_id", text: "escolha o bairro" });
    if (blocks.length === 0) out.push({ path: "city_block_ids", text: "marque ao menos um quarteirão" });
    const pop = Number(population);
    if (!/^\d{1,8}$/.test(population) || pop < 1 || pop > 10_000_000) out.push({ path: "dog_population", text: "população de cães: número inteiro de 1 a 10.000.000" });
    if (!DATE.test(startsOn)) out.push({ path: "starts_on", text: "informe a data de início" });
    if (!DATE.test(endsOn)) out.push({ path: "ends_on", text: "informe a data de fim" });
    if (DATE.test(startsOn) && DATE.test(endsOn) && endsOn < startsOn) out.push({ path: "ends_on", text: "o fim não pode ser antes do início" });
    return out;
  }

  function full(): LeishSurveyInput {
    return {
      name: name.trim(), kind: kind as SurveyKind, neighborhood_id: nb, dog_population: Number(population), starts_on: startsOn, ends_on: endsOn,
      city_block_ids: blocks
    };
  }
  function patch(s: LeishSurvey): Partial<LeishSurveyInput> & { expected_version: number } {
    const b = full();
    const p: Partial<LeishSurveyInput> & { expected_version: number } = { expected_version: s.version };
    if (b.name !== s.name) p.name = b.name;
    if (b.kind !== s.kind) p.kind = b.kind;
    if (b.neighborhood_id !== s.neighborhood_id) p.neighborhood_id = b.neighborhood_id;
    if (b.dog_population !== s.dog_population) p.dog_population = b.dog_population;
    if (b.starts_on !== s.starts_on) p.starts_on = b.starts_on;
    if (b.ends_on !== s.ends_on) p.ends_on = b.ends_on;
    if ([ ...blocks ].sort().join() !== [ ...s.city_block_ids ].sort().join()) p.city_block_ids = blocks;
    return p;
  }

  function submit(ev: React.FormEvent) {
    void f.submit(ev, {
      check: () => {
        const local = check();
        if (local.length > 0 || !survey) return local;
        return Object.keys(patch(survey)).length === 1 ? [ { path: "", text: NOTHING_CHANGED } ] : [];
      },
      call: () => (survey ? updateLeishSurvey(survey.id, patch(survey)) : createLeishSurvey(full())),
      ok: onSaved,
      stale: onStale
    });
  }

  const toggle = (id: string) => { setBlocks((bs) => (bs.includes(id) ? bs.filter((x) => x !== id) : [ ...bs, id ])); f.clear("city_block_ids"); };
  const heading = survey ? "Editar inquérito" : "Novo inquérito";
  const field = (path: string, label: string, value: string, set: (v: string) => void, type = "text") => (
    <>
      <label style={fieldLabel}>
        {label}
        <input type={type} value={value} autoComplete="off" disabled={busy} style={inputStyle} {...f.aria(path)}
          inputMode={path === "dog_population" ? "numeric" : undefined} onChange={(e) => { set(e.target.value); f.clear(path); }} />
      </label>
      {f.errNode(path)}
    </>
  );

  return (
    <form ref={f.formRef} noValidate style={form} aria-label={heading} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>{heading}</p>
      {field("name", "Nome", name, setName)}
      <label style={fieldLabel}>
        Tipo
        <select value={kind} disabled={busy} style={inputStyle} {...f.aria("kind")}
          onChange={(e) => { setKind(e.target.value); setSuggestion(null); if (e.target.value !== "focus") setCenter(""); f.clear("kind"); }}>
          <option value="">escolha</option>
          {(domains?.leish_survey_kinds ?? []).map((k) => <option key={k.code} value={k.code}>{k.label}</option>)}
        </select>
      </label>
      {f.errNode("kind")}
      <label style={fieldLabel}>
        Bairro
        <select value={nb} disabled={busy} style={inputStyle} {...f.aria("neighborhood_id")}
          onChange={(e) => { setNb(e.target.value); setBlocks([]); setCenter(""); setSuggestion(null); f.clear("neighborhood_id"); }}>
          <option value="">escolha</option>
          {neighborhoods.filter((n) => n.active || n.id === nb).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
        </select>
      </label>
      {f.errNode("neighborhood_id")}
      {focus && (
        <>
          <label style={fieldLabel}>
            Quarteirão central
            <select value={center} disabled={busy} style={inputStyle} {...f.aria("center_city_block_id")}
              onChange={(e) => { setCenter(e.target.value); setSuggestion(null); f.clear("center_city_block_id"); }}>
              <option value="">escolha</option>
              {activeBlocks.map((b) => <option key={b.id} value={b.id}>Quarteirão {b.number}</option>)}
            </select>
          </label>
          {f.errNode("center_city_block_id")}
          {field("rings", "Anéis em volta do central (o api amplia até o mínimo de cães)", rings, setRings)}
        </>
      )}
      <div style={row}>
        <ActionButton variant="secondary" busy={suggesting} onClick={() => void suggest()}>Sugerir quarteirões</ActionButton>
      </div>
      {suggestion && (
        <p role="status" style={muted}>
          sugestão do cadastro: {suggestion.dog_population_suggested} cães · cães a examinar: {suggestion.target_dogs}
        </p>
      )}
      {suggestion?.below_focus_min && <p role="alert" style={alert}>{focusBelowMinText(focusMin)}</p>}
      {nb && (
        <fieldset style={fieldset} {...f.aria("city_block_ids")}>
          <legend style={legend}>Quarteirões</legend>
          {activeBlocks.length === 0 && <p style={muted}>nenhum quarteirão neste bairro</p>}
          {activeBlocks.map((b) => (
            <label key={b.id} style={checkLabel}>
              <input type="checkbox" checked={blocks.includes(b.id)} disabled={busy} onChange={() => toggle(b.id)} />
              Quarteirão {b.number}
            </label>
          ))}
        </fieldset>
      )}
      {f.errNode("city_block_ids")}
      {field("dog_population", "População de cães", population, setPopulation)}
      {field("starts_on", "Início", startsOn, setStartsOn, "date")}
      {field("ends_on", "Fim", endsOn, setEndsOn, "date")}
      {f.top((p) => OWN.includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Salvar rascunho</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}

// O detalhe (sem trilha): o tamanho que o api calculou, a população sugerida pelo cadastro e a prevalência por cão (último
// resultado final; o api calcula). Abaixo do mínimo da tabela, a amostra é o censo (Q32).
export function SurveyDetail({ id }: { id: string }) {
  const domains = useZooDomains().data;
  const { focusMin, sampleMin } = useLeishParams();
  const q = useQuery({ queryKey: [ ZOO_SURVEYS_KEY, id ], queryFn: () => getLeishSurvey(id), ...STATIC_QUERY });
  const s = q.data;
  const prevalence = s?.prevalence.prevalence;
  return (
    <section aria-label="Inquérito selecionado" style={panel}>
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <p role="alert" style={alert}>{zoonosesError(q.error)}</p>}
      {s && (
        <>
          <strong style={title}>{s.name}</strong>
          <p style={muted}>{zooLabel(domains?.leish_survey_kinds, s.kind)} · {s.neighborhood.name} · {fmtDay(s.starts_on)} a {fmtDay(s.ends_on)}</p>
          <p style={muted}>{s.city_block_ids.length} quarteirões · {s.household_ids.length} domicílios</p>
          <p style={muted}>população de cães: {s.dog_population}</p>
          <p style={muted}>população sugerida pelo cadastro: {s.dog_population_suggested} cães</p>
          <p style={{ margin: 0, fontWeight: 600 }}>cães a examinar: {s.target_dogs}</p>
          {s.kind === "sample" && sampleMin !== null && s.dog_population < sampleMin && <p style={muted}>{sampleCensusText(sampleMin)}</p>}
          {s.below_focus_min && <p role="alert" style={alert}>{focusBelowMinText(focusMin)}</p>}
          <p style={muted}>examinados: {s.prevalence.examined} · reagentes: {s.prevalence.reactive}</p>
          <p style={muted}>prevalência: {prevalence === null || prevalence === undefined ? "—" : `${String(prevalence).replace(".", ",")}%`}</p>
        </>
      )}
    </section>
  );
}
