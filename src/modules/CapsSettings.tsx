// Módulo 31 — F-31.1: limite de noites do acolhimento noturno, prazo de revisão do PTS e leitos, só do municipal_admin (P33: o lead
// lê as regras pelo api, mas esta tela é do admin). A escrita das regras passa pelo step-up; o api recebe a forma inteira de cada
// modalidade. Limites iguais aos do api: janela 7–90 dias, noites 1–90, prazo do PTS 30–365 (settingsProblems). Nada aqui é dado de
// pessoa. Os leitos de cada CAPS com acolhimento noturno ficam abaixo, um painel por CAPS (BedsAdmin).
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPsySettings, listAllUnits, updatePsySettings, type PsySettings } from "../lib/api";
import {
  CAPS_III_NOTE, NO_NIGHT_CAPS, PSY_SETTINGS_KEY, SETTINGS_SAVED, PSY_UNITS_KEY, STATIC_QUERY, hasBeds, psyError, psyRefusals, settingsProblems
} from "../lib/psychosocial";
import type { Problem } from "../lib/pharmacy";
import { Panel } from "../components/Panel";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";
import { BedsAdmin } from "./psychosocial/BedsAdmin";
import { alert, fieldLabel, fieldset, legend, muted, okText, stack } from "./exams/styles";

export type CapsSettingsProps = { onGoToSecurity?: () => void };

const REVIEW_PATH = "care_plan_review_days";

// Um campo por chave do api: o `path` é o do corpo (`night_limits.<modalidade>.<chave>`), que também é o dos problemas.
const GROUPS: { title: string; fields: { path: string; label: string }[] }[] = [
  { title: "CAPS III", fields: [
    { path: "night_limits.caps_iii.consecutive", label: "CAPS III — noites corridas" },
    { path: "night_limits.caps_iii.alternate", label: "CAPS III — noites intercaladas" },
    { path: "night_limits.caps_iii.window_days", label: "CAPS III — janela (dias)" } ] },
  { title: "CAPS AD III", fields: [
    { path: "night_limits.caps_ad_iii.total", label: "CAPS AD III — noites na janela" },
    { path: "night_limits.caps_ad_iii.window_days", label: "CAPS AD III — janela (dias)" } ] },
  { title: "CAPS AD IV", fields: [
    { path: "night_limits.caps_ad_iv.total", label: "CAPS AD IV — noites na janela" },
    { path: "night_limits.caps_ad_iv.window_days", label: "CAPS AD IV — janela (dias)" } ] }
];
const FIELD_PATHS = [ ...GROUPS.flatMap((g) => g.fields.map((f) => f.path)), REVIEW_PATH ];

type Draft = Record<string, string>;

const read = (s: PsySettings, path: string): string => {
  if (path === REVIEW_PATH) return String(s.care_plan_review_days);
  const [ , modality, key ] = path.split(".");
  const value = (s.night_limits as unknown as Record<string, Record<string, number> | undefined>)[modality]?.[key];
  return value === undefined ? "" : String(value);
};
// Só dígitos viram número; o resto vira NaN e é recusado por `settingsProblems` (nada é cortado em silêncio).
const num = (raw: string): number => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
function toSettings(d: Draft): PsySettings {
  const n = (path: string) => num(d[path] ?? "");
  return {
    night_limits: {
      caps_iii: { consecutive: n("night_limits.caps_iii.consecutive"), alternate: n("night_limits.caps_iii.alternate"), window_days: n("night_limits.caps_iii.window_days") },
      caps_ad_iii: { total: n("night_limits.caps_ad_iii.total"), window_days: n("night_limits.caps_ad_iii.window_days") },
      caps_ad_iv: { total: n("night_limits.caps_ad_iv.total"), window_days: n("night_limits.caps_ad_iv.window_days") }
    },
    care_plan_review_days: n(REVIEW_PATH)
  };
}

export function CapsSettings({ onGoToSecurity }: CapsSettingsProps = {}) {
  return (
    <PsychosocialGate title="CAPS: leitos e regras" sub="Leitos, limite de noites e prazo do PTS" unit="none" allow={(r) => r.admin}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </PsychosocialGate>
  );
}

function Body({ onGoToSecurity }: CapsSettingsProps) {
  const settings = useQuery({ queryKey: [ PSY_SETTINGS_KEY ], queryFn: getPsySettings, ...STATIC_QUERY });
  const units = useQuery({ queryKey: [ PSY_UNITS_KEY, "all" ], queryFn: listAllUnits, ...STATIC_QUERY });
  // "Regras salvas." mora aqui: a releitura depois de gravar pode trocar a chave do formulário e remontá-lo.
  const [ done, setDone ] = useState(false);
  const withBeds = (units.data ?? []).filter((u) => u.kind === "caps" && u.active && hasBeds(u.caps_modality));
  return (
    <div style={stack}>
      <Panel title="Regras do CAPS" sub="valem para as próximas entradas e revisões">
        <div style={stack}>
          {settings.isPending && <p className="mono" style={muted}>carregando…</p>}
          {settings.isError && <p role="alert" style={alert}>{psyError(settings.error)}</p>}
          {settings.data && <SettingsForm key={JSON.stringify(settings.data)} saved={settings.data} done={done} setDone={setDone} onGoToSecurity={onGoToSecurity} />}
        </div>
      </Panel>
      {units.isError && <p role="alert" style={alert}>{psyError(units.error)}</p>}
      {units.data && withBeds.length === 0 && (
        <p style={muted}>{NO_NIGHT_CAPS}</p>
      )}
      {withBeds.map((u) => <BedsAdmin key={u.id} unit={u} onGoToSecurity={onGoToSecurity} />)}
    </div>
  );
}

const groupGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 };

function SettingsForm({ saved, done, setDone, onGoToSecurity }: {
  saved: PsySettings; done: boolean; setDone(v: boolean): void; onGoToSecurity?: () => void;
}) {
  const queryClient = useQueryClient();
  const [ draft, setDraft ] = useState<Draft>(() => Object.fromEntries(FIELD_PATHS.map((p) => [ p, read(saved, p) ])));
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ confirming, setConfirming ] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  useEffect(() => { formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(); }, [ problems ]);

  // Mexer num campo fecha a confirmação aberta: o que se confirma é sempre o que está na tela.
  const set = (path: string, value: string) => { setDraft((d) => ({ ...d, [path]: value })); setDone(false); setConfirming(false); setProblems((list) => list.filter((p) => p.path !== path)); };
  const errId = (path: string) => `cs-err-${path.replace(/\W/g, "-")}`;
  const err = (path: string) => {
    const texts = [ ...new Set(problems.filter((p) => p.path === path).map((p) => p.text)) ];
    return texts.length > 0 ? <span id={errId(path)} style={alert}>{texts.join("; ")}</span> : null;
  };
  const aria = (path: string) => (problems.some((p) => p.path === path) ? { "aria-invalid": true as const, "aria-describedby": errId(path) } : {});
  const field = (path: string, label: string) => (
    <div key={path} style={stack}>
      <label style={fieldLabel}>
        {label}
        <input value={draft[path] ?? ""} inputMode="numeric" onChange={(e) => set(path, e.target.value)} style={inputStyle} {...aria(path)} />
      </label>
      {err(path)}
    </div>
  );
  function review() {
    setDone(false);
    const found = settingsProblems(toSettings(draft));
    setProblems(found);
    setConfirming(found.length === 0);
  }

  return (
    <div style={stack}>
      <form ref={formRef} style={stack} onSubmit={(e) => { e.preventDefault(); review(); }}>
        {done && <p role="status" style={okText}>{SETTINGS_SAVED}</p>}
        <fieldset style={fieldset}>
          <legend style={legend}>Limite do acolhimento noturno</legend>
          <p style={muted}>{CAPS_III_NOTE}</p>
          {GROUPS.map((g) => (
            <div key={g.title} style={groupGrid}>{g.fields.map((f) => field(f.path, f.label))}</div>
          ))}
        </fieldset>
        <fieldset style={fieldset}>
          <legend style={legend}>Plano terapêutico singular</legend>
          <div style={groupGrid}>{field(REVIEW_PATH, "Prazo de revisão do PTS (dias)")}</div>
        </fieldset>
        <div><button type="submit" style={buttonStyle}>Salvar regras</button></div>
      </form>
      {confirming && (
        <SensitiveAction
          title="Salvar as regras do CAPS"
          description="Os limites valem para as próximas entradas no leito e o prazo, para as próximas revisões do PTS; o que já foi registrado não muda."
          requiresStepUp
          run={() => updatePsySettings(toSettings(draft)).then(() => undefined)}
          onDone={() => { setConfirming(false); setDone(true); void queryClient.invalidateQueries({ queryKey: [ PSY_SETTINGS_KEY ] }); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => {
            const refusals = psyRefusals(e);
            const mine = refusals.filter((r) => FIELD_PATHS.includes(r.path));
            if (mine.length > 0) setProblems(mine.map((r) => ({ path: r.path, text: r.text })));
            return [ ...new Set(refusals.map((r) => r.text)) ].join("; ");
          }}
        />
      )}
    </div>
  );
}
