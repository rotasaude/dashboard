// src/modules/ZooSettings.tsx
// Parâmetros de zoonoses (módulo 35b, Task 13; F-35.14, F-35.15; contrato §9, Q12, Q18). Só a coordenação. Os 8 campos do
// defaults.yml (sem a prevalência esperada), agrupados; cada gravação cria a versão seguinte (a 0 é o padrão de fábrica, sem data).
// O PUT leva o corpo INTEIRO e a versão lida, com step-up (SensitiveAction, como o PUT do 35a). A tela recusa antes o que
// `parameterProblems` recusa (mesma faixa e mesmo path do api); 422 invalid_parameter com `values.<chave>` cai no campo; 409
// parameters_changed: a frase, UMA releitura, o digitado fica. Sem dado de pessoa.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getZooParameters, putZooParameters, type ZoonosesParameterVersion, type ZoonosesParameters } from "../lib/api";
import { cityDateFormat } from "../lib/format";
import {
  STATIC_QUERY, ZOO_DOMAINS_KEY, ZOO_PARAMS_KEY, isZoonosesStale, parameterProblems, sampleCensusText, sampleTableProblems, zoonosesError,
  zoonosesRefusals
} from "../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { Panel } from "../components/Panel";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, fieldset, legend, muted, okText, row, stack } from "./exams/styles";

type Key = Exclude<keyof ZoonosesParameters, "leish_sample_table">;
type Rows = ZoonosesParameters["leish_sample_table"];
type Draft = { [K in Key]: string } & { table: { population: string; sample: string }[] };
const TABLE = "leish_sample_table";

type Field = { key: Key; label: string; group: string; kind: "int" | "fraction" | "optional-int" };
const FIELDS: Field[] = [
  { key: "observation_days", label: "Dias de observação do agressor", group: "Observação do agressor", kind: "int" },
  { key: "collar_months", label: "Duração da coleira (meses)", group: "Coleira", kind: "int" },
  { key: "leish_focus_min_dogs", label: "Mínimo de cães do foco", group: "Leishmaniose", kind: "int" },
  { key: "dogs_per_block", label: "Cães por quarteirão", group: "Leishmaniose", kind: "int" },
  { key: "rabies_coverage_target", label: "Cobertura alvo da vacinação", group: "Raiva", kind: "fraction" },
  { key: "dog_population_estimate", label: "Estimativa de cães", group: "Raiva", kind: "optional-int" },
  { key: "cat_population_estimate", label: "Estimativa de gatos", group: "Raiva", kind: "optional-int" }
];
const KEYS = new Set<string>([ ...FIELDS.map((f) => f.key), TABLE ]);

// Leitura do texto: inteiro só com dígitos; fração com vírgula ou ponto; o resto vira NaN e é recusado (nada é cortado).
const toInt = (raw: string): number => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
const toNumber = (raw: string): number => (/^\d+([.,]\d+)?$/.test(raw.trim()) ? Number(raw.trim().replace(",", ".")) : NaN);
const decimal = (n: number): string => String(n).replace(".", ",");

export function draftOf(v: ZoonosesParameters): Draft {
  const out = { table: v.leish_sample_table.map((r) => ({ population: String(r.population), sample: String(r.sample) })) } as Draft;
  for (const f of FIELDS) {
    const value = v[f.key];
    out[f.key] = value === null ? "" : f.kind === "fraction" ? decimal(value) : String(value);
  }
  return out;
}

// O corpo inteiro. `min_population` e `a_conferir` voltam como foram lidos (o api recusa a tabela de fábrica sem eles).
export function toValues(d: Draft, base: ZoonosesParameters): ZoonosesParameters {
  const out = {} as Record<Key, number | null>;
  for (const f of FIELDS) {
    out[f.key] = f.kind === "fraction" ? toNumber(d[f.key]) : f.kind === "optional-int" && d[f.key].trim() === "" ? null : toInt(d[f.key]);
  }
  const table: Rows = d.table.map((r, i) => ({ ...base.leish_sample_table[i], population: toInt(r.population), sample: toInt(r.sample) }));
  return { ...out, leish_sample_table: table } as ZoonosesParameters;
}

const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };
export function parametersVersionLabel(v: ZoonosesParameterVersion): string {
  if (v.version === 0) return "padrão de fábrica (versão 0)";
  return v.created_at ? `versão ${v.version}, de ${cityDateFormat(DAY).format(new Date(v.created_at))}` : `versão ${v.version}`;
}
export const PARAMS_SAVED = (n: number): string => `parâmetros salvos — versão ${n}`;
const currentValueHint = (text: string): string => `vigente agora: ${text}`;

// A linha recusada da tabela: o api só devolve o path da tabela, então acha-se a 1ª linha cujo prefixo já falha.
function badRow(rows: Rows): number {
  for (let i = 1; i <= rows.length; i++) if (sampleTableProblems(rows.slice(0, i)).length > 0) return i - 1;
  return -1;
}

export function ZooSettings({ onGoToSecurity }: { onGoToSecurity?: () => void } = {}) {
  return (
    <ZoonosesGate title="Parâmetros de zoonoses" sub="zoonoses · parâmetros" allow={(r) => r.coordinator}>
      {() => <ParametersPanel onGoToSecurity={onGoToSecurity} />}
    </ZoonosesGate>
  );
}

function ParametersPanel({ onGoToSecurity }: { onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const params = useQuery({ queryKey: [ ZOO_PARAMS_KEY ], queryFn: getZooParameters, ...STATIC_QUERY });
  // O aviso mora aqui: gravar remonta o formulário (formKey) com o gravado. A releitura do 409 NÃO remonta: o rascunho fica.
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ formKey, setFormKey ] = useState(0);

  async function saved(result: ZoonosesParameterVersion) {
    setNotice(PARAMS_SAVED(result.version));
    queryClient.setQueryData([ ZOO_PARAMS_KEY ], result);
    setFormKey((k) => k + 1);
    await Promise.all([ queryClient.invalidateQueries({ queryKey: [ ZOO_PARAMS_KEY ] }), queryClient.invalidateQueries({ queryKey: [ ZOO_DOMAINS_KEY ] }) ]);
  }

  return (
    <Panel title="Parâmetros" sub="cada gravação cria uma versão nova">
      <div style={stack}>
        {params.isError && (
          <div style={row}>
            <p role="alert" style={alert}>{zoonosesError(params.error)}</p>
            <button type="button" style={secondaryButtonStyle} disabled={params.isFetching} onClick={() => void params.refetch()}>Tentar de novo</button>
          </div>
        )}
        {!params.data ? (!params.isError && <p role="status" style={muted}>Carregando…</p>)
          : (
            <>
              <p style={muted}>{parametersVersionLabel(params.data)}</p>
              {notice && <p role="status" style={okText}>{notice}</p>}
              <ParamsForm key={formKey} loaded={params.data} onEdit={() => setNotice(null)} onSaved={saved}
                onStale={() => queryClient.invalidateQueries({ queryKey: [ ZOO_PARAMS_KEY ] })} onGoToSecurity={onGoToSecurity} />
            </>
          )}
      </div>
    </Panel>
  );
}

const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 };
const GROUPS = [ "Observação do agressor", "Coleira", "Leishmaniose", "Raiva" ];

function ParamsForm({ loaded, onEdit, onSaved, onStale, onGoToSecurity }: {
  loaded: ZoonosesParameterVersion; onEdit(): void; onSaved(r: ZoonosesParameterVersion): Promise<void>; onStale(): Promise<void>; onGoToSecurity?: () => void;
}) {
  const [ draft, setDraft ] = useState<Draft>(() => draftOf(loaded.values));
  // Depois de um 409: a versão que estava na tela. Quando a releitura traz outra, cada campo que difere mostra o vigente.
  const [ staleFrom, setStaleFrom ] = useState<number | null>(null);
  const current = draftOf(loaded.values);
  const reread = staleFrom !== null && loaded.version !== staleFrom;
  const differs = (key: Key) => reread && draft[key] !== current[key];
  const hint = (key: Key) => (differs(key) ? <span style={muted}>{currentValueHint(current[key] === "" ? "em branco" : current[key])}</span> : null);
  const [ problems, setProblems ] = useState<{ path: string; text: string }[]>([]);
  const [ confirming, setConfirming ] = useState(false);
  const result = useRef<ZoonosesParameterVersion | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [ focusTick, setFocusTick ] = useState(0);
  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [ focusTick ]);

  const dropProblem = (path: string) => setProblems((list) => (list.some((p) => p.path === path) ? list.filter((p) => p.path !== path) : list));
  // Mexer num campo fecha a confirmação aberta: o que se confirma é sempre o que está na tela.
  function touch(path: string) { setConfirming(false); onEdit(); dropProblem(path); }
  function set(key: Key, value: string) { setDraft((d) => ({ ...d, [key]: value })); touch(`values.${key}`); }
  function setCell(i: number, col: "population" | "sample", value: string) {
    setDraft((d) => ({ ...d, table: d.table.map((r, j) => (j === i ? { ...r, [col]: value } : r)) }));
    touch(`values.${TABLE}`);
  }
  const problem = (key: string) => problems.find((p) => p.path === `values.${key}`)?.text ?? null;
  const errId = (key: string) => `zs-err-${key}`;
  const aria = (key: string) => (problem(key) ? { "aria-invalid": true as const, "aria-describedby": errId(key) } : {});
  const err = (key: string) => (problem(key) ? <span id={errId(key)} style={alert}>{problem(key)}</span> : null);

  const tableRows = toValues(draft, loaded.values).leish_sample_table;
  const tableBad = problem(TABLE) !== null ? Math.max(badRow(tableRows), 0) : -1;
  const minPopulation = loaded.values.leish_sample_table[0]?.min_population;

  function review() {
    setStaleFrom(null);
    const found = parameterProblems(toValues(draft, loaded.values)).map((p) => ({ path: p.path, text: p.text }));
    setProblems(found);
    setFocusTick((t) => t + 1);
    setConfirming(found.length === 0);
  }

  const input = (f: Field) => (
    <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={fieldLabel}>
        {f.label}
        <input value={draft[f.key]} inputMode={f.kind === "fraction" ? "decimal" : "numeric"} style={inputStyle} {...aria(f.key)}
          onChange={(e) => set(f.key, e.target.value)} />
      </label>
      {f.kind === "optional-int" && <span style={muted}>em branco = sem estimativa</span>}
      {f.kind === "fraction" && <span style={muted}>de 0,1 a 1 (0,8 = 80%)</span>}
      {err(f.key)}
      {hint(f.key)}
    </div>
  );

  return (
    <div style={stack}>
      <form ref={formRef} style={stack} onSubmit={(e) => { e.preventDefault(); review(); }}>
        {staleFrom !== null && <p role="alert" style={alert}>{ZOONOSES_ERRORS.parameters_changed}</p>}
        {GROUPS.map((g) => (
          <fieldset key={g} style={fieldset}>
            <legend style={legend}>{g}</legend>
            <div style={grid}>{FIELDS.filter((f) => f.group === g).map(input)}</div>
            {g === "Leishmaniose" && (
              <div style={stack}>
                <p style={muted}>Tabela da amostra do manual (2%): a população do inquérito e quantos cães entram na amostra.</p>
                {minPopulation !== undefined && <p style={muted}>{sampleCensusText(minPopulation)}</p>}
                {draft.table.map((r, i) => {
                  const bad = tableBad === i;
                  const flagged = bad ? { "aria-invalid": true as const, "aria-describedby": errId(TABLE) } : {};
                  return (
                    <div key={i} style={grid}>
                      <label style={fieldLabel}>
                        {`População até, linha ${i + 1}`}
                        <input value={r.population} inputMode="numeric" style={inputStyle} {...flagged} onChange={(e) => setCell(i, "population", e.target.value)} />
                      </label>
                      <label style={fieldLabel}>
                        {`Amostra, linha ${i + 1}`}
                        <input value={r.sample} inputMode="numeric" style={inputStyle} onChange={(e) => setCell(i, "sample", e.target.value)} />
                      </label>
                      {loaded.values.leish_sample_table[i]?.a_conferir && <span style={muted}>a conferir com o manual</span>}
                    </div>
                  );
                })}
                {err(TABLE)}
              </div>
            )}
          </fieldset>
        ))}
        <div><button type="submit" style={buttonStyle}>Salvar parâmetros</button></div>
      </form>
      {confirming && (
        <SensitiveAction
          title="Salvar os parâmetros de zoonoses"
          description={`Cria a versão ${loaded.version + 1}. O inquérito já aberto continua com a versão dele.`}
          requiresStepUp
          run={async () => { result.current = await putZooParameters(toValues(draft, loaded.values), loaded.version); }}
          onDone={() => { setConfirming(false); if (result.current) void onSaved(result.current); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => {
            const refusals = zoonosesRefusals(e);
            if (isZoonosesStale(e)) {
              // Outra pessoa gravou: fecha a confirmação, relê uma vez e deixa o digitado; o próximo envio leva a versão relida.
              setConfirming(false);
              setStaleFrom(loaded.version);
              void onStale();
              return refusals[0].text;
            }
            const mine = refusals.filter((r) => r.path.startsWith("values.") && KEYS.has(r.path.slice(7)));
            if (mine.length > 0) {
              setProblems(mine.map((r) => ({ path: r.path, text: ZOONOSES_ERRORS.invalid_parameter })));
              setFocusTick((t) => t + 1);
            }
            return refusals[0].text;
          }}
        />
      )}
    </div>
  );
}
