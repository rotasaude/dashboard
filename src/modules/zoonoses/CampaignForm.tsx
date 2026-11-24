// src/modules/zoonoses/CampaignForm.tsx
// Criar e editar a campanha antirrábica (módulo 35b, F-35.12). Só a coordenação, e a edição só na etapa `planned`.
// Nome 1–80, início ≤ fim, metas inteiras ≥ 0. A meta vem sugerida por estimativa × cobertura dos parâmetros (sem estimativa,
// nada é sugerido e a meta é pedida). A edição manda só o que mudou, com `expected_version`; 409 (campanha mudou) vai ao pai, que
// mostra a frase e relê UMA vez — nada é reenviado.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createRabiesCampaign, getZooParameters, updateRabiesCampaign, type CampaignInput, type RabiesCampaign } from "../../lib/api";
import { textProblem } from "../../lib/homeVisits";
import { STATIC_QUERY, ZOO_PARAMS_KEY, isZoonosesStale, suggestedGoal, zoonosesRefusals } from "../../lib/zoonoses";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const GOAL = /^\d{1,9}$/;
const NOTHING_CHANGED = "nada mudou";
const GOAL_TEXT = "informe a meta (número inteiro, 0 ou mais)";
const OWN = [ "name", "year", "starts_on", "ends_on", "goal_dogs", "goal_cats" ];

export function CampaignForm({ campaign, onSaved, onStale, onCancel }: {
  campaign?: RabiesCampaign; onSaved(c: RabiesCampaign): void; onStale(text: string): void; onCancel(): void;
}) {
  const params = useQuery({ queryKey: [ ZOO_PARAMS_KEY ], queryFn: getZooParameters, ...STATIC_QUERY, enabled: !campaign }).data?.values;
  const f = useFormProblems({
    refusals: (err) => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isZoonosesStale(err)
  });
  const [ name, setName ] = useState(campaign?.name ?? "");
  const [ year, setYear ] = useState<string | null>(null);
  const [ startsOn, setStartsOn ] = useState(campaign?.starts_on ?? "");
  const [ endsOn, setEndsOn ] = useState(campaign?.ends_on ?? "");
  const [ dogs, setDogs ] = useState<string | null>(null);
  const [ cats, setCats ] = useState<string | null>(null);

  const target = params?.rabies_coverage_target ?? null;
  const sugDogs = params && target !== null ? suggestedGoal(params.dog_population_estimate, target) : null;
  const sugCats = params && target !== null ? suggestedGoal(params.cat_population_estimate, target) : null;
  const goalDogs = dogs ?? (campaign ? String(campaign.goal_dogs) : sugDogs !== null ? String(sugDogs) : "");
  const goalCats = cats ?? (campaign ? String(campaign.goal_cats) : sugCats !== null ? String(sugCats) : "");
  const yearValue = year ?? String(campaign?.year ?? (DATE.test(startsOn) ? startsOn.slice(0, 4) : ""));

  function check() {
    const out: { path: string; text: string }[] = [];
    const n = textProblem(name, { min: 1, max: 80, path: "name" });
    if (n) out.push(n);
    if (!DATE.test(startsOn)) out.push({ path: "starts_on", text: "informe a data de início" });
    if (!DATE.test(endsOn)) out.push({ path: "ends_on", text: "informe a data de fim" });
    if (DATE.test(startsOn) && DATE.test(endsOn) && startsOn > endsOn) out.push({ path: "ends_on", text: "o início não pode ser depois do fim" });
    if (year !== null && !/^\d{4}$/.test(year)) out.push({ path: "year", text: "informe o ano com 4 dígitos" });
    if (!GOAL.test(goalDogs)) out.push({ path: "goal_dogs", text: GOAL_TEXT });
    if (!GOAL.test(goalCats)) out.push({ path: "goal_cats", text: GOAL_TEXT });
    return out;
  }

  function patch(c: RabiesCampaign) {
    const p: Partial<CampaignInput> & { expected_version: number } = { expected_version: c.version };
    if (name.trim() !== c.name) p.name = name.trim();
    if (startsOn !== c.starts_on) p.starts_on = startsOn;
    if (endsOn !== c.ends_on) p.ends_on = endsOn;
    if (year !== null && Number(year) !== c.year) p.year = Number(year);
    if (Number(goalDogs) !== c.goal_dogs) p.goal_dogs = Number(goalDogs);
    if (Number(goalCats) !== c.goal_cats) p.goal_cats = Number(goalCats);
    return p;
  }

  function submit(ev: React.FormEvent) {
    if (campaign) {
      void f.submit(ev, {
        check: () => {
          const local = check();
          if (local.length > 0) return local;
          return Object.keys(patch(campaign)).length === 1 ? [ { path: "", text: NOTHING_CHANGED } ] : [];
        },
        call: () => updateRabiesCampaign(campaign.id, patch(campaign)),
        ok: onSaved,
        stale: onStale
      });
    } else {
      void f.submit(ev, {
        check,
        call: () => createRabiesCampaign({
          name: name.trim(), starts_on: startsOn, ends_on: endsOn, goal_dogs: Number(goalDogs), goal_cats: Number(goalCats),
          ...(year !== null ? { year: Number(year) } : {})
        }),
        ok: onSaved,
        stale: onStale
      });
    }
  }

  const busy = f.busy;
  const heading = campaign ? "Editar campanha" : "Nova campanha";
  const field = (path: string, label: string, value: string, set: (v: string) => void, type = "text") => (
    <>
      <label style={fieldLabel}>
        {label}
        <input type={type} value={value} autoComplete="off" disabled={busy} style={inputStyle} {...f.aria(path)}
          inputMode={type === "text" && path.startsWith("goal") ? "numeric" : undefined}
          onChange={(e) => { set(e.target.value); f.clear(path); }} />
      </label>
      {f.errNode(path)}
    </>
  );

  return (
    <form ref={f.formRef} noValidate style={form} aria-label={heading} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>{heading}</p>
      {field("name", "Nome", name, setName)}
      {field("year", "Ano", yearValue, setYear)}
      {field("starts_on", "Início", startsOn, setStartsOn, "date")}
      {field("ends_on", "Fim", endsOn, setEndsOn, "date")}
      {!campaign && sugDogs !== null && sugCats !== null && target !== null && (
        <p style={muted}>sugestão: {sugDogs} cães e {sugCats} gatos (estimativa × cobertura de {Math.round(target * 100)}%)</p>
      )}
      {field("goal_dogs", "Meta de cães", goalDogs, setDogs)}
      {field("goal_cats", "Meta de gatos", goalCats, setCats)}
      {f.top((p) => OWN.includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Salvar campanha</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
