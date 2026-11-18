// src/modules/VectorReports.tsx
// "Relatórios de endemias" (módulo 35a, F-35.9; contrato §10; D-13, Q22, Q28, Q31). Os sete de VectorControl::Reports, cada um
// só para quem o lê (ReportsController#readable?: coordenação e municipal_admin os sete; laboratório ovitraps e liraa), com os
// filtros de Reports::FILTERS:
//   - situations: ciclo e bairros; strategic_points: ciclo — o seletor lê GET /vector_control/cycles?year= (Q31: aberto a quem
//     lê esses relatórios), pelo ano do ciclo que o api guarda (Q22: civil ou epidemiológico de starts_on; a tela não deduz);
//   - production, consumption e blocks: o período (os dois dias inclusive, até 366, Reports::MAX_DAYS). O api também aceita
//     professional_ids no production, mas nenhuma lista de profissionais é legível pela coordenação: sem a chave, todos;
//   - ovitraps: semanas (intervalo AAAA-SS, até 53, nenhuma no futuro) e bairros;
//   - liraa: o levantamento — o seletor lê GET /vector_control/liraa_surveys (Q31: também o municipal_admin e o laboratório).
// Bairros: nenhum marcado = os ativos (o api). Os seletores leem só quando o relatório é escolhido; o relatório só no "Ver"
// (STATIC_QUERY; só contagens, sem trilha). "Baixar CSV" (todos) e "Baixar PDF" (só liraa) pelo saveFile, com o nome do api
// (`<relatório>-<data>.<formato>`, sem pessoa) ou o mesmo formato montado aqui. O filtro recusado (aqui ou no 422
// invalid_request com path) aparece no campo dele. Cada relatório aberto fica montado e escondido: voltar a ele não relê os
// seletores nem o resultado. Filtros só em memória (ids, datas e semanas); nada em URL, storage ou log; nenhum polling.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchVectorReportFile, getVectorReport, listCycles, listLiraaSurveys, listPanelNeighborhoods, type VectorReportFiltersByName,
  type VectorReportName
} from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { fmtDay } from "../lib/homeVisits";
import { PANEL_NEIGHBORHOODS_KEY } from "../lib/neighborhoodFilter";
import { previousEpiWeek, shiftEpiWeek, weekProblem } from "../lib/surveillance";
import { sortByName } from "../lib/territory";
import {
  STATIC_QUERY, VC_CYCLES_KEY, VC_REPORT_KEY, VC_REPORT_NAMES, VC_SURVEYS_KEY, canReadAnyVectorReport, canReadVectorReport,
  surveyStatusLabel, vectorError, vectorRefusals, type VectorRoles
} from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
import { ReportTable } from "./vectorControl/ReportTable";
import { saveFile } from "./lab/saveFile";
import { Panel } from "../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

export const REPORT_TITLES: Record<VectorReportName, string> = {
  situations: "Situação dos imóveis por ciclo", strategic_points: "Pontos estratégicos", production: "Produção dos agentes",
  consumption: "Consumo de produtos", ovitraps: "Ovitrampas (IPO, IDO, IDV)", liraa: "LIRAa", blocks: "Bloqueios"
};
// Os relatórios que o papel lê, na ordem de Catalog::REPORTS.
export const REPORTS_FOR = (roles: VectorRoles): VectorReportName[] => VC_REPORT_NAMES.filter((n) => canReadVectorReport(roles, n));

export const PICK_CYCLE = "escolha o ciclo";
export const PICK_SURVEY = "escolha o levantamento";
export const FROM_MISSING = "informe a data inicial";
export const TO_MISSING = "informe a data final";
export const TO_BEFORE_FROM = "a data final vem antes da inicial";
export const PERIOD_TOO_LONG = "o período vai até 366 dias";
export const WEEK_TO_BEFORE_FROM = "a semana final vem antes da inicial";
export const TOO_MANY_WEEKS = "no máximo 53 semanas";
// O 422 invalid_request do api no campo do `path` (Reports::Invalid).
const API_FIELD: Record<Slot, string> = {
  cycle_id: "ciclo não encontrado — escolha outro", survey_id: "levantamento não encontrado — escolha outro",
  neighborhood_ids: "bairro não encontrado — escolha de novo", epi_weeks: "semanas recusadas pelo servidor — confira o intervalo",
  from: "data inicial recusada pelo servidor", to: "período recusado pelo servidor — de 1 a 366 dias"
};

type Slot = "cycle_id" | "survey_id" | "neighborhood_ids" | "epi_weeks" | "from" | "to";
type Errors = Partial<Record<Slot, string>>;
type Request = { [N in VectorReportName]: { name: N; f: VectorReportFiltersByName[N] } }[VectorReportName];
type Uses = { cycle?: true; survey?: true; neighborhoods?: true; period?: true; weeks?: true };
const USES: Record<VectorReportName, Uses> = {
  situations: { cycle: true, neighborhoods: true }, strategic_points: { cycle: true }, production: { period: true },
  consumption: { period: true }, ovitraps: { weeks: true, neighborhoods: true }, liraa: { survey: true }, blocks: { period: true }
};
const SLOTS: readonly Slot[] = [ "cycle_id", "survey_id", "neighborhood_ids", "epi_weeks", "from", "to" ];
const MAX_DAYS = 366;
const MAX_WEEKS = 53;
const DAY = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR = /^\d{4}$/;

const isDate = (s: string): boolean => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

// Reports#period!: os dois dias inclusive; `to - from` até 365 (MAX_DAYS dias); o erro vai no `to`, como o api.
export function periodProblems(from: string, to: string): Errors {
  if (!isDate(from)) return { from: FROM_MISSING };
  if (!isDate(to)) return { to: TO_MISSING };
  if (to < from) return { to: TO_BEFORE_FROM };
  return (Date.parse(to) - Date.parse(from)) / DAY >= MAX_DAYS ? { to: PERIOD_TOO_LONG } : {};
}

// O intervalo de semanas como a lista que o api lê (Reports#epi_weeks!: 1 a 53).
export function weekRange(first: string, last: string, today: string): { weeks: string[] } | { problem: string } {
  const a = weekProblem(first, today);
  if (a) return { problem: `semana inicial: ${a}` };
  const b = weekProblem(last, today);
  if (b) return { problem: `semana final: ${b}` };
  if (last < first) return { problem: WEEK_TO_BEFORE_FROM };
  const weeks = [ first ];
  while (weeks[weeks.length - 1] < last) {
    if (weeks.length === MAX_WEEKS) return { problem: TOO_MANY_WEEKS };
    weeks.push(shiftEpiWeek(weeks[weeks.length - 1], 1));
  }
  return { weeks };
}

function refusalOf(err: unknown, uses: Uses): { slot: Slot | null; text: string } {
  const r = vectorRefusals(err)[0];
  const base = r.path.replace(/\[\d+\]$/, "") as Slot;
  const offered = (base === "cycle_id" && uses.cycle) || (base === "survey_id" && uses.survey)
    || (base === "neighborhood_ids" && uses.neighborhoods) || (base === "epi_weeks" && uses.weeks)
    || ((base === "from" || base === "to") && uses.period);
  return r.code === "invalid_request" && SLOTS.includes(base) && offered ? { slot: base, text: API_FIELD[base] } : { slot: null, text: r.text };
}

export function VectorReports({ today }: { today?: string } = {}) {
  return (
    <VectorGate title="Relatórios de endemias" sub="endemias · relatórios em CSV e PDF" allow={canReadAnyVectorReport}>
      {(roles) => <ReportsScreen roles={roles} today={today ?? cityIsoDate()} />}
    </VectorGate>
  );
}

function ReportsScreen({ roles, today }: { roles: VectorRoles; today: string }) {
  const names = REPORTS_FOR(roles);
  const [ chosen, setChosen ] = useState<VectorReportName | "">("");
  const [ visited, setVisited ] = useState<VectorReportName[]>([]);
  const choose = (v: string) => {
    const name = names.find((n) => n === v) ?? "";
    setChosen(name);
    if (name && !visited.includes(name)) setVisited([ ...visited, name ]);
  };
  return (
    <div style={stack}>
      <label style={{ ...fieldLabel, maxWidth: 360 }}>
        Relatório
        <select value={chosen} style={inputStyle} onChange={(e) => choose(e.target.value)}>
          <option value="">Escolha o relatório</option>
          {names.map((n) => <option key={n} value={n}>{REPORT_TITLES[n]}</option>)}
        </select>
      </label>
      {visited.map((n) => (
        <div key={n} style={n === chosen ? undefined : { display: "none" }}>
          <ReportPanel name={n} today={today} />
        </div>
      ))}
    </div>
  );
}

function ReportPanel({ name, today }: { name: VectorReportName; today: string }) {
  const uses = USES[name];
  const [ yearText, setYearText ] = useState(today.slice(0, 4));
  const [ year, setYear ] = useState(Number(today.slice(0, 4)));
  const [ cycleId, setCycleId ] = useState("");
  const [ surveyId, setSurveyId ] = useState("");
  const [ nbIds, setNbIds ] = useState<string[]>([]);
  const [ from, setFrom ] = useState(`${today.slice(0, 8)}01`);
  const [ to, setTo ] = useState(today);
  const [ weekFrom, setWeekFrom ] = useState(() => previousEpiWeek(today));
  const [ weekTo, setWeekTo ] = useState(() => previousEpiWeek(today));
  const [ errors, setErrors ] = useState<Errors>({});
  const [ general, setGeneral ] = useState<string | null>(null);
  const [ shown, setShown ] = useState<Request | null>(null);
  const [ busy, setBusy ] = useState(false);
  const running = useRef(false);

  const cycles = useQuery({ queryKey: [ VC_CYCLES_KEY, year ], queryFn: () => listCycles(year), enabled: !!uses.cycle, ...STATIC_QUERY });
  const surveys = useQuery({ queryKey: [ VC_SURVEYS_KEY ], queryFn: listLiraaSurveys, enabled: !!uses.survey, ...STATIC_QUERY });
  const neighborhoods = useQuery({
    queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, enabled: !!uses.neighborhoods, ...STATIC_QUERY
  });
  const report = useQuery({
    queryKey: [ VC_REPORT_KEY, "screen", name, shown?.f ?? null ],
    queryFn: () => getVectorReport(shown!.name, shown!.f), enabled: shown !== null, ...STATIC_QUERY
  });
  const sortedNbs = sortByName(neighborhoods.data ?? []);

  // Qualquer mudança de filtro esconde o resultado (que seria de outro filtro) e as recusas.
  const changed = () => { setShown(null); setErrors({}); setGeneral(null); };
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); changed(); };

  function build(): { req: Request } | { errors: Errors } {
    const nbs = sortedNbs.filter((n) => nbIds.includes(n.id)).map((n) => n.id);
    const withNbs = nbs.length > 0 ? { neighborhood_ids: nbs } : {};
    switch (name) {
      case "situations":
        return cycleId ? { req: { name, f: { cycle_id: cycleId, ...withNbs } } } : { errors: { cycle_id: PICK_CYCLE } };
      case "strategic_points":
        return cycleId ? { req: { name, f: { cycle_id: cycleId } } } : { errors: { cycle_id: PICK_CYCLE } };
      case "liraa":
        return surveyId ? { req: { name, f: { survey_id: surveyId } } } : { errors: { survey_id: PICK_SURVEY } };
      case "ovitraps": {
        const range = weekRange(weekFrom.trim(), weekTo.trim(), today);
        return "problem" in range ? { errors: { epi_weeks: range.problem } } : { req: { name, f: { epi_weeks: range.weeks, ...withNbs } } };
      }
      default: {
        const problems = periodProblems(from, to);
        return Object.keys(problems).length > 0 ? { errors: problems } : { req: { name, f: { from, to } } };
      }
    }
  }

  function view() {
    const b = build();
    if ("errors" in b) { setErrors(b.errors); return; }
    setErrors({});
    setGeneral(null);
    if (shown && JSON.stringify(shown) === JSON.stringify(b.req)) {
      if (!report.isFetching) void report.refetch();
      return;
    }
    setShown(b.req);
  }

  async function download(format: "csv" | "pdf") {
    if (running.current) return;
    const b = build();
    if ("errors" in b) { setErrors(b.errors); return; }
    running.current = true;
    setBusy(true);
    setErrors({});
    setGeneral(null);
    try {
      const file = await fetchVectorReportFile(b.req.name, b.req.f, format);
      saveFile(file, file.filename ?? `${name}-${today}.${format}`);
    } catch (err) {
      const r = refusalOf(err, uses);
      if (r.slot) setErrors({ [r.slot]: r.text });
      else setGeneral(r.text);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const readRefusal = report.isError ? refusalOf(report.error, uses) : null;
  const slotText = (slot: Slot): string | undefined => errors[slot] ?? (readRefusal?.slot === slot ? readRefusal.text : undefined);
  const errorId = (slot: Slot) => `vc-report-${name}-${slot}-error`;
  const describedBy = (slot: Slot) => (slotText(slot) ? errorId(slot) : undefined);
  const fieldError = (slot: Slot) => {
    const text = slotText(slot);
    return text ? <span id={errorId(slot)} role="alert" style={alert}>{text}</span> : null;
  };
  const generalText = general ?? (readRefusal && !readRefusal.slot ? readRefusal.text : null);

  return (
    <Panel title={REPORT_TITLES[name]}>
      <div style={stack}>
        <div style={{ ...row, alignItems: "flex-start" }}>
          {uses.cycle && (
            <>
              <label style={fieldLabel}>
                Ano do ciclo
                <input value={yearText} style={inputStyle} className="mono" inputMode="numeric" maxLength={4}
                  onChange={(e) => {
                    const text = e.target.value;
                    setYearText(text);
                    if (YEAR.test(text)) { setYear(Number(text)); setCycleId(""); changed(); }
                  }} />
              </label>
              <div style={{ ...fieldLabel, minWidth: 240 }}>
                <label style={fieldLabel}>
                  Ciclo
                  <select value={cycleId} style={inputStyle} aria-describedby={describedBy("cycle_id")}
                    onChange={(e) => edit(setCycleId)(e.target.value)}>
                    <option value="">{cycles.isSuccess && cycles.data.length === 0 ? "nenhum ciclo neste ano" : "Escolha o ciclo"}</option>
                    {(cycles.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{`Ciclo ${c.number}/${c.year} · ${fmtDay(c.starts_on)} a ${fmtDay(c.ends_on)}`}</option>
                    ))}
                  </select>
                </label>
                {cycles.isError && <span style={alert}>{vectorError(cycles.error)}</span>}
                {fieldError("cycle_id")}
              </div>
            </>
          )}
          {uses.survey && (
            <div style={{ ...fieldLabel, minWidth: 280 }}>
              <label style={fieldLabel}>
                Levantamento
                <select value={surveyId} style={inputStyle} aria-describedby={describedBy("survey_id")}
                  onChange={(e) => edit(setSurveyId)(e.target.value)}>
                  <option value="">{surveys.isSuccess && surveys.data.length === 0 ? "nenhum levantamento" : "Escolha o levantamento"}</option>
                  {(surveys.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {`${s.name} · ${fmtDay(s.starts_on)} a ${fmtDay(s.ends_on)} · ${surveyStatusLabel(s.status)}`}
                    </option>
                  ))}
                </select>
              </label>
              {surveys.isError && <span style={alert}>{vectorError(surveys.error)}</span>}
              {fieldError("survey_id")}
            </div>
          )}
          {uses.period && (
            <>
              <div style={fieldLabel}>
                <label style={fieldLabel}>
                  De
                  <input type="date" value={from} style={inputStyle} aria-describedby={describedBy("from")}
                    onChange={(e) => edit(setFrom)(e.target.value)} />
                </label>
                {fieldError("from")}
              </div>
              <div style={fieldLabel}>
                <label style={fieldLabel}>
                  Até
                  <input type="date" value={to} style={inputStyle} aria-describedby={describedBy("to")}
                    onChange={(e) => edit(setTo)(e.target.value)} />
                </label>
                {fieldError("to")}
              </div>
            </>
          )}
          {uses.weeks && (
            <div style={stack}>
              <div style={row}>
                <label style={fieldLabel}>
                  Semana inicial (AAAA-SS)
                  <input value={weekFrom} style={inputStyle} className="mono" placeholder="2026-45" aria-describedby={describedBy("epi_weeks")}
                    onChange={(e) => edit(setWeekFrom)(e.target.value)} />
                </label>
                <label style={fieldLabel}>
                  Semana final (AAAA-SS)
                  <input value={weekTo} style={inputStyle} className="mono" placeholder="2026-45" aria-describedby={describedBy("epi_weeks")}
                    onChange={(e) => edit(setWeekTo)(e.target.value)} />
                </label>
              </div>
              {fieldError("epi_weeks")}
            </div>
          )}
        </div>
        {uses.neighborhoods && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={describedBy("neighborhood_ids")}>
            <legend style={fieldLabel}>Bairros (nenhum marcado: todos os ativos)</legend>
            {neighborhoods.isPending && <p role="status" style={muted}>Carregando bairros…</p>}
            {neighborhoods.isError && <p style={alert}>{vectorError(neighborhoods.error)}</p>}
            <div style={row}>
              {sortedNbs.map((n) => (
                <label key={n.id} style={{ ...row, fontSize: 13 }}>
                  <input type="checkbox" checked={nbIds.includes(n.id)}
                    onChange={(e) => edit(setNbIds)(e.target.checked ? [ ...nbIds, n.id ] : nbIds.filter((id) => id !== n.id))} />
                  {n.active ? n.name : `${n.name} (inativo)`}
                </label>
              ))}
            </div>
            {fieldError("neighborhood_ids")}
          </fieldset>
        )}
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={view}>Ver</button>
          <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={() => void download("csv")}>
            Baixar CSV
          </button>
          {name === "liraa" && (
            <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={() => void download("pdf")}>
              Baixar PDF
            </button>
          )}
        </div>
        {generalText && <p role="alert" style={alert}>{generalText}</p>}
        {shown && !report.isError && (report.data && !report.isFetching
          ? <ReportTable report={report.data} label={REPORT_TITLES[name]} />
          : <p role="status" style={muted}>Carregando…</p>)}
      </div>
    </Panel>
  );
}
