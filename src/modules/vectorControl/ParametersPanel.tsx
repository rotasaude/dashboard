// src/modules/vectorControl/ParametersPanel.tsx
// Parâmetros técnicos do controle vetorial (módulo 35a, F-35.3; contrato §11; A-4, A-5, Q10, Q13(8), Q17). As 20 chaves do
// defaults.yml, agrupadas; cada gravação cria a versão seguinte (a 0 é o padrão de fábrica, sem gravação, created_at null). O PUT leva o
// corpo INTEIRO, com step-up (SensitiveAction). A tela recusa o que o VectorControl::Parameters.validate recusaria, na mesma ordem
// (faixas de RANGES primeiro, depois NOT_ABOVE (≤) e BELOW (<), no campo de baixo) e nunca mais que ele: a lista de doenças é o api
// que confere (só o código novo em relação à versão vigente). 422 invalid_parameter com `path` values.<chave> cai no campo da chave.
// O PUT não leva versão (o api serializa por trava, sem 409): se outra edição gravou no meio, a resposta pula um número; a tela avisa
// e relê UMA vez. Sem dado de pessoa.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getVectorParameters, putVectorParameters, type VectorParameterVersion, type VectorParameters } from "../../lib/api";
import { cityDateFormat } from "../../lib/format";
import { STATIC_QUERY, VC_DOMAINS_KEY, VC_PARAMS_KEY, vectorError, vectorRefusals } from "../../lib/vectorControl";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, muted, okText, stack } from "../exams/styles";

type ParamKey = keyof VectorParameters;
export type ParamDraft = { [K in ParamKey]: K extends "iip_bands" ? [ string, string ] : string };
type Kind = { kind: "int"; min: number; max: number } | { kind: "fraction" } | { kind: "diseases" } | { kind: "bands" };
export type ParamField = { key: ParamKey; label: string; group: string } & Kind;

const int = (min: number, max: number) => ({ kind: "int" as const, min, max });
// Na ordem de VectorControl::Parameters::RANGES (a do defaults.yml): o primeiro problema é o mesmo do api.
export const PARAM_FIELDS: ParamField[] = [
  { key: "default_days", label: "Cadência padrão (dias)", group: "Cadência", ...int(7, 365) },
  { key: "strategic_point_days", label: "Cadência do ponto estratégico (dias)", group: "Cadência", ...int(7, 365) },
  { key: "block_radius_rings", label: "Raio do bloqueio (anéis de quarteirões)", group: "Bloqueio de transmissão", ...int(0, 5) },
  { key: "block_grouping_days", label: "Agrupamento dos casos no bloqueio (dias)", group: "Bloqueio de transmissão", ...int(1, 30) },
  { key: "block_diseases", label: "Doenças que abrem bloqueio (códigos separados por vírgula)", group: "Bloqueio de transmissão", kind: "diseases" },
  { key: "ubv_cycles_max", label: "Ciclos de UBV (máximo)", group: "UBV", ...int(1, 5) },
  { key: "ubv_cycle_days_min", label: "Duração do ciclo de UBV — mínimo (dias)", group: "UBV", ...int(1, 15) },
  { key: "ubv_cycle_days_max", label: "Duração do ciclo de UBV — máximo (dias)", group: "UBV", ...int(1, 15) },
  { key: "ubv_cycle_interval_days", label: "Intervalo entre ciclos de UBV (dias)", group: "UBV", ...int(0, 30) },
  { key: "ovitrap_collection_days_min", label: "Coleta da palheta — mínimo (dias)", group: "Ovitrampa", ...int(1, 30) },
  { key: "ovitrap_collection_days_max", label: "Coleta da palheta — máximo (dias)", group: "Ovitrampa", ...int(1, 30) },
  { key: "ovitrap_alert_eggs", label: "Alerta de ovos", group: "Ovitrampa", ...int(1, 9999) },
  { key: "ovitrap_radius_rings", label: "Raio da ovitrampa (anéis de quarteirões)", group: "Ovitrampa", ...int(0, 5) },
  { key: "liraa_standard_min", label: "LIRAa padrão — mínimo de imóveis", group: "LIRAa", ...int(1, 100_000) },
  { key: "liraa_standard_max", label: "LIRAa padrão — máximo de imóveis", group: "LIRAa", ...int(1, 100_000) },
  { key: "liraa_half_min", label: "LIRAa metade — mínimo de imóveis", group: "LIRAa", ...int(1, 100_000) },
  { key: "liraa_base_sample", label: "Amostra base do LIRAa (imóveis)", group: "LIRAa", ...int(1, 10_000) },
  { key: "liraa_household_fraction", label: "Fração de imóveis do quarteirão — padrão", group: "LIRAa", kind: "fraction" },
  { key: "liraa_half_household_fraction", label: "Fração de imóveis do quarteirão — metade", group: "LIRAa", kind: "fraction" },
  { key: "iip_bands", label: "IIP — faixas", group: "IIP", kind: "bands" }
];
const BAND_LABELS = [ "IIP — início da faixa média", "IIP — início da faixa alta" ] as const;
const GROUPS = [ ...new Set(PARAM_FIELDS.map((f) => f.group)) ];
// [de baixo, de cima]: NOT_ABOVE pede ≤; BELOW pede <. O problema vai na de baixo, como o path do api.
const NOT_ABOVE: [ ParamKey, ParamKey ][] = [ [ "ubv_cycle_days_min", "ubv_cycle_days_max" ], [ "ovitrap_collection_days_min", "ovitrap_collection_days_max" ] ];
const BELOW: [ ParamKey, ParamKey, string ][] = [
  [ "liraa_half_min", "liraa_standard_min", "o mínimo do LIRAa metade tem de ser menor que o mínimo do padrão" ],
  [ "liraa_standard_min", "liraa_standard_max", "o mínimo do LIRAa padrão tem de ser menor que o máximo" ]
];

const NUM = new Intl.NumberFormat("pt-BR");
const decimal = (n: number) => String(n).replace(".", ",");
export function draftOf(v: VectorParameters): ParamDraft {
  const out = {} as Record<ParamKey, unknown>;
  for (const f of PARAM_FIELDS) {
    const value = v[f.key];
    out[f.key] = f.kind === "diseases" ? (value as string[]).join(", ")
      : f.kind === "bands" ? (value as number[]).map(decimal)
      : f.kind === "fraction" ? decimal(value as number) : String(value);
  }
  return out as ParamDraft;
}

// Leitura do texto: inteiro só com dígitos; número com vírgula ou ponto; o resto vira NaN e é recusado (nada é cortado em silêncio).
const INTEGER = /^\d+$/;
const NUMBER = /^\d+([.,]\d+)?$/;
const toInt = (raw: string) => (INTEGER.test(raw.trim()) ? Number(raw.trim()) : NaN);
const toNumber = (raw: string) => (NUMBER.test(raw.trim()) ? Number(raw.trim().replace(",", ".")) : NaN);
// Até duas casas, como o `decimal.round(2) == decimal` do api (zero à direita não conta).
const twoPlaces = (raw: string) => ((raw.trim().split(/[.,]/)[1] ?? "").replace(/0+$/, "").length <= 2);
const diseases = (raw: string) => raw.split(",").map((s) => s.trim()).filter((s) => s !== "");

export function toValues(d: ParamDraft): VectorParameters {
  const out = {} as Record<ParamKey, unknown>;
  for (const f of PARAM_FIELDS) {
    const raw = d[f.key];
    out[f.key] = f.kind === "diseases" ? diseases(raw as string)
      : f.kind === "bands" ? (raw as string[]).map(toNumber)
      : f.kind === "fraction" ? toNumber(raw as string) : toInt(raw as string);
  }
  return out as unknown as VectorParameters;
}

function rangeText(f: ParamField): string | null {
  switch (f.kind) {
    case "int": return `${f.label}: de ${NUM.format(f.min)} a ${NUM.format(f.max)}, só números inteiros`;
    case "fraction": return `${f.label}: de 0,01 a 1, com até 2 casas`;
    case "diseases": return "informe ao menos um código de doença, sem repetir";
    case "bands": return "IIP: dois números de 0 a 100, o início da faixa alta maior que o da média";
  }
}
function fits(f: ParamField, raw: string | [ string, string ]): boolean {
  switch (f.kind) {
    case "int": { const n = toInt(raw as string); return Number.isInteger(n) && n >= f.min && n <= f.max; }
    case "fraction": { const n = toNumber(raw as string); return Number.isFinite(n) && n >= 0.01 && n <= 1 && twoPlaces(raw as string); }
    case "diseases": { const list = diseases(raw as string); return list.length > 0 && new Set(list).size === list.length; }
    case "bands": {
      const [ a, b ] = (raw as string[]).map(toNumber);
      return Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b <= 100 && a < b;
    }
  }
}

export type ParamProblem = { path: ParamKey; text: string };
// Como VectorControl::Parameters.validate: as faixas de todas as chaves; só sem nenhuma, as desigualdades entre chaves.
export function parameterProblems(d: ParamDraft): ParamProblem[] {
  const ranges = PARAM_FIELDS.filter((f) => !fits(f, d[f.key])).map((f) => ({ path: f.key, text: rangeText(f) as string }));
  if (ranges.length > 0) return ranges;
  const v = toValues(d);
  const out: ParamProblem[] = [];
  for (const [ low, high ] of NOT_ABOVE) if ((v[low] as number) > (v[high] as number)) out.push({ path: low, text: "o mínimo não pode passar do máximo" });
  for (const [ low, high, text ] of BELOW) if ((v[low] as number) >= (v[high] as number)) out.push({ path: low, text });
  return out;
}

const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
// Q13(8): a versão 0 é o padrão de fábrica, sem data.
export function parametersVersionLabel(v: VectorParameterVersion): string {
  if (v.version === 0 || !v.created_at) return v.version === 0 ? "padrão de fábrica (versão 0)" : `versão ${v.version}`;
  return `versão ${v.version}, de ${cityDateFormat(DAY).format(new Date(v.created_at))}`;
}
export const PARAMS_SAVED = (n: number) => `parâmetros salvos — versão ${n}`;
export const PARAMS_RACED = (n: number) =>
  `outra edição gravou uma versão enquanto a tela estava aberta — esta saiu como a versão ${n}, com os valores desta tela; os dados foram relidos`;

type Notice = { ok: boolean; text: string } | null;

export function ParametersPanel({ onGoToSecurity }: { onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const params = useQuery({ queryKey: [ VC_PARAMS_KEY ], queryFn: getVectorParameters, ...STATIC_QUERY });
  // O aviso mora aqui: a releitura troca a versão e remonta o formulário.
  const [ notice, setNotice ] = useState<Notice>(null);

  async function saved(loaded: number, result: VectorParameterVersion) {
    setNotice({ ok: true, text: result.version === loaded + 1 ? PARAMS_SAVED(result.version) : PARAMS_RACED(result.version) });
    // Uma releitura (a versão vigente) e os domínios, que levam parte dos parâmetros ao boletim.
    await Promise.all([ queryClient.invalidateQueries({ queryKey: [ VC_PARAMS_KEY ] }), queryClient.invalidateQueries({ queryKey: [ VC_DOMAINS_KEY ] }) ]);
  }

  return (
    <Panel title="Parâmetros técnicos" sub="cada gravação cria uma versão nova">
      <div style={stack}>
        {params.isError ? <p role="alert" style={alert}>{vectorError(params.error)}</p>
          : !params.data ? <p role="status" style={muted}>Carregando…</p>
          : (
            <>
              <p style={muted}>{parametersVersionLabel(params.data)}</p>
              {notice && <p role="status" style={notice.ok ? okText : alert}>{notice.text}</p>}
              <ParamsForm key={params.data.version} loaded={params.data} onEdit={() => setNotice(null)}
                onSaved={(r) => saved(params.data!.version, r)} onGoToSecurity={onGoToSecurity} />
            </>
          )}
      </div>
    </Panel>
  );
}

const groupGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 };

function ParamsForm({ loaded, onEdit, onSaved, onGoToSecurity }: {
  loaded: VectorParameterVersion; onEdit(): void; onSaved(r: VectorParameterVersion): Promise<void>; onGoToSecurity?: () => void;
}) {
  const [ draft, setDraft ] = useState<ParamDraft>(() => draftOf(loaded.values));
  const [ problems, setProblems ] = useState<ParamProblem[]>([]);
  const [ confirming, setConfirming ] = useState(false);
  const result = useRef<VectorParameterVersion | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  // O foco vai ao primeiro campo recusado só depois de um envio (ou de uma recusa do api), nunca a cada tecla.
  const [ focusTick, setFocusTick ] = useState(0);
  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [ focusTick ]);

  // Mexer num campo fecha a confirmação aberta: o que se confirma é sempre o que está na tela.
  function set<K extends ParamKey>(key: K, value: ParamDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setConfirming(false);
    onEdit();
    setProblems((list) => (list.some((p) => p.path === key) ? list.filter((p) => p.path !== key) : list));
  }
  const errId = (key: ParamKey) => `vp-err-${key}`;
  const problem = (key: ParamKey) => problems.find((p) => p.path === key)?.text ?? null;
  const aria = (key: ParamKey) => (problem(key) ? { "aria-invalid": true as const, "aria-describedby": errId(key) } : {});
  const err = (key: ParamKey) => (problem(key) ? <span id={errId(key)} style={alert}>{problem(key)}</span> : null);

  function review() {
    const found = parameterProblems(draft);
    setProblems(found);
    setFocusTick((t) => t + 1);
    setConfirming(found.length === 0);
  }

  const input = (f: ParamField) => {
    if (f.kind === "bands") {
      const bands = draft.iip_bands;
      return (
        <div key={f.key} style={stack}>
          <div style={groupGrid}>
            {BAND_LABELS.map((label, i) => (
              <label key={label} style={fieldLabel}>
                {label}
                <input value={bands[i]} inputMode="decimal" style={inputStyle} {...aria(f.key)}
                  onChange={(e) => set("iip_bands", (i === 0 ? [ e.target.value, bands[1] ] : [ bands[0], e.target.value ]) as [ string, string ])} />
              </label>
            ))}
          </div>
          <p style={muted}>abaixo da faixa média é baixo; da alta em diante, alto (uma casa decimal)</p>
          {err(f.key)}
        </div>
      );
    }
    return (
      <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: f.kind === "diseases" ? "1 / -1" : undefined }}>
        <label style={fieldLabel}>
          {f.label}
          <input value={draft[f.key] as string} inputMode={f.kind === "int" ? "numeric" : f.kind === "fraction" ? "decimal" : undefined}
            style={inputStyle} {...aria(f.key)} onChange={(e) => set(f.key, e.target.value as never)} />
        </label>
        {err(f.key)}
      </div>
    );
  };

  return (
    <div style={stack}>
      <form ref={formRef} style={stack} onSubmit={(e) => { e.preventDefault(); review(); }}>
        {GROUPS.map((g) => (
          <fieldset key={g} style={fieldset}>
            <legend style={legend}>{g}</legend>
            <div style={groupGrid}>{PARAM_FIELDS.filter((f) => f.group === g).map(input)}</div>
          </fieldset>
        ))}
        <div><button type="submit" style={buttonStyle}>Salvar parâmetros</button></div>
      </form>
      {confirming && (
        <SensitiveAction
          title="Salvar os parâmetros técnicos"
          description={`Cria a versão ${loaded.version + 1}. O levantamento já sorteado continua com a versão do sorteio.`}
          requiresStepUp
          run={async () => { result.current = await putVectorParameters(toValues(draft)); }}
          onDone={() => { setConfirming(false); if (result.current) void onSaved(result.current); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => {
            const refusals = vectorRefusals(e);
            const keys = PARAM_FIELDS.map((f) => f.key as string);
            const mine = refusals.filter((r) => r.path.startsWith("values.") && keys.includes(r.path.slice(7)));
            if (mine.length > 0) {
              setProblems(mine.map((r) => ({ path: r.path.slice(7) as ParamKey, text: VECTOR_ERRORS.invalid_parameter })));
              setFocusTick((t) => t + 1);
            }
            return refusals[0].text;
          }}
        />
      )}
    </div>
  );
}
