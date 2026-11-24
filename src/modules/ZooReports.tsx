// src/modules/ZooReports.tsx
// "Relatórios de zoonoses" (módulo 35b, F-35.17; Q25): os seis de Zoonoses::Reports para a equipe, a coordenação e o municipal_admin
// (reader). Todo relatório exige o período no api (até 366 dias): o semanal usa a campanha (do início dela até hoje, no máximo 365 dias
// atrás) e os outros `from`/`to` (padrão: os últimos 30 dias); o `leish` aceita o inquérito. O relatório só no "Ver"
// (STATIC_QUERY; só contagens, sem trilha); "Baixar CSV" pelo saveFile com o nome do api. A supressão (1 a 4) é do api: "< 5" pelo
// ReportTable e nenhuma soma aqui. Filtros só em memória (ids e datas); nada em URL, storage ou log; nenhum polling.
import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchZoonosesReportFile, getZoonosesReport, listLeishSurveys, listRabiesCampaigns, type ZoonosesReport, type ZoonosesReportFilters, type ZoonosesReportName
} from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { fmtDay } from "../lib/homeVisits";
import { STATIC_QUERY, ZOO_CAMPAIGNS_KEY, ZOO_REPORT_KEY, ZOO_SURVEYS_KEY, zoonosesRefusals } from "../lib/zoonoses";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { ReportTable, type TableReport } from "./vectorControl/ReportTable";
import { periodProblems } from "./VectorReports";
import { saveFile } from "./lab/saveFile";
import { Panel } from "../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

export const ZOO_REPORT_TITLES: Record<ZoonosesReportName, string> = {
  rabies_weekly: "Vacinação antirrábica por semana", rabies_modalities: "Doses por modalidade e espécie", demands: "Demandas por subtipo",
  observations: "Observações por desfecho", leish: "Leishmaniose por inquérito", shelter: "Canil e gatil"
};
const NAMES = Object.keys(ZOO_REPORT_TITLES) as ZoonosesReportName[];

export const PICK_CAMPAIGN = "escolha a campanha";
type Slot = "from" | "to" | "campaign_id" | "survey_id";
type Errors = Partial<Record<Slot, string>>;
// O 422 invalid_request do api no campo do `path` (Reports::Invalid).
const API_FIELD: Record<Slot, string> = {
  from: "data inicial recusada pelo servidor", to: "período recusado pelo servidor — de 1 a 366 dias",
  campaign_id: "campanha não encontrada — escolha outra", survey_id: "inquérito não encontrado — escolha outro"
};
const DAY = 86_400_000;
const shift = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export function ZooReports({ today }: { today?: string } = {}) {
  return (
    <ZoonosesGate title="Relatórios de zoonoses" sub="zoonoses · relatórios em tela e CSV" allow={(r) => r.reader}>
      {() => <ReportsScreen today={today ?? cityIsoDate()} />}
    </ZoonosesGate>
  );
}

function ReportsScreen({ today }: { today: string }) {
  const [ chosen, setChosen ] = useState<ZoonosesReportName | "">("");
  return (
    <div style={stack}>
      <label style={{ ...fieldLabel, maxWidth: 360 }}>
        Relatório
        <select value={chosen} style={inputStyle} onChange={(e) => setChosen(NAMES.find((n) => n === e.target.value) ?? "")}>
          <option value="">Escolha o relatório</option>
          {NAMES.map((n) => <option key={n} value={n}>{ZOO_REPORT_TITLES[n]}</option>)}
        </select>
      </label>
      {chosen && <ReportPanel key={chosen} name={chosen} today={today} />}
    </div>
  );
}

// As linhas trazem `after_planned_end` (booleano, não é coluna): fica de fora; a coluna `remark` já vem escrita pelo api.
function tableOf(r: ZoonosesReport): TableReport {
  return { ...r, rows: r.rows.map((line) => Object.fromEntries(Object.entries(line).filter(([ , v ]) => typeof v !== "boolean")) as TableReport["rows"][number]) };
}

function refusalOf(err: unknown, name: ZoonosesReportName): { slot: Slot | null; text: string } {
  const r = zoonosesRefusals(err)[0];
  const slot = r.path as Slot;
  const offered = name === "rabies_weekly" ? slot === "from" || slot === "to" || slot === "campaign_id"
    : slot === "from" || slot === "to" || (name === "leish" && slot === "survey_id");
  return r.code === "invalid_request" && offered ? { slot, text: API_FIELD[slot] } : { slot: null, text: r.text };
}

function ReportPanel({ name, today }: { name: ZoonosesReportName; today: string }) {
  const weekly = name === "rabies_weekly";
  const [ from, setFrom ] = useState(shift(today, -29));
  const [ to, setTo ] = useState(today);
  const [ campaignId, setCampaignId ] = useState("");
  const [ surveyId, setSurveyId ] = useState("");
  const [ errors, setErrors ] = useState<Errors>({});
  const [ general, setGeneral ] = useState<string | null>(null);
  const [ shown, setShown ] = useState<ZoonosesReportFilters | null>(null);
  const [ busy, setBusy ] = useState(false);
  const running = useRef(false);

  const campaigns = useQuery({ queryKey: [ ZOO_CAMPAIGNS_KEY ], queryFn: listRabiesCampaigns, enabled: weekly, ...STATIC_QUERY });
  const surveys = useQuery({ queryKey: [ ZOO_SURVEYS_KEY ], queryFn: listLeishSurveys, enabled: name === "leish", ...STATIC_QUERY });
  const report = useQuery({
    queryKey: [ ZOO_REPORT_KEY, "screen", name, shown ], queryFn: () => getZoonosesReport(name, shown!), enabled: shown !== null, ...STATIC_QUERY
  });

  // Qualquer mudança de filtro esconde o resultado (que seria de outro filtro) e as recusas.
  const changed = () => { setShown(null); setErrors({}); setGeneral(null); };
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); changed(); };

  function build(): { f: ZoonosesReportFilters } | { errors: Errors } {
    if (weekly) {
      const c = (campaigns.data ?? []).find((x) => x.id === campaignId);
      if (!c) return { errors: { campaign_id: PICK_CAMPAIGN } };
      // O mesmo recorte do resultado semanal da campanha: do início até hoje, e 365 dias para trás no máximo (366 recusa).
      const earliest = shift(today, -365);
      const start = c.starts_on > today ? today : c.starts_on < earliest ? earliest : c.starts_on;
      return { f: { from: start, to: today, campaign_id: c.id } };
    }
    const problems = periodProblems(from, to);
    if (Object.keys(problems).length > 0) return { errors: problems };
    return { f: surveyId && name === "leish" ? { from, to, survey_id: surveyId } : { from, to } };
  }

  function view() {
    const b = build();
    if ("errors" in b) { setErrors(b.errors); return; }
    setErrors({});
    setGeneral(null);
    if (shown && JSON.stringify(shown) === JSON.stringify(b.f)) {
      if (!report.isFetching) void report.refetch();
      return;
    }
    setShown(b.f);
  }

  async function download() {
    if (running.current) return;
    const b = build();
    if ("errors" in b) { setErrors(b.errors); return; }
    running.current = true;
    setBusy(true);
    setErrors({});
    setGeneral(null);
    try {
      const file = await fetchZoonosesReportFile(name, b.f);
      saveFile(file, file.filename ?? `${name}-${today}.csv`);
    } catch (err) {
      const r = refusalOf(err, name);
      if (r.slot) setErrors({ [r.slot]: r.text });
      else setGeneral(r.text);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const readRefusal = report.isError ? refusalOf(report.error, name) : null;
  const slotText = (slot: Slot): string | undefined => errors[slot] ?? (readRefusal?.slot === slot ? readRefusal.text : undefined);
  const errorId = (slot: Slot) => `zoo-report-${name}-${slot}-error`;
  const describedBy = (slot: Slot) => (slotText(slot) ? errorId(slot) : undefined);
  const fieldError = (slot: Slot) => {
    const text = slotText(slot);
    return text ? <span id={errorId(slot)} role="alert" style={alert}>{text}</span> : null;
  };
  const generalText = general ?? (readRefusal && !readRefusal.slot ? readRefusal.text : null)
    ?? (campaigns.isError ? zoonosesRefusals(campaigns.error)[0].text : null) ?? (surveys.isError ? zoonosesRefusals(surveys.error)[0].text : null);

  return (
    <Panel title={ZOO_REPORT_TITLES[name]}>
      <div style={stack}>
        <div style={{ ...row, alignItems: "flex-start" }}>
          {weekly && (
            <div style={{ ...fieldLabel, minWidth: 280 }}>
              <label style={fieldLabel}>
                Campanha
                <select value={campaignId} style={inputStyle} aria-describedby={describedBy("campaign_id")}
                  onChange={(e) => edit(setCampaignId)(e.target.value)}>
                  <option value="">{campaigns.isSuccess && campaigns.data.length === 0 ? "nenhuma campanha" : "Escolha a campanha"}</option>
                  {(campaigns.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{`${c.name} · ${fmtDay(c.starts_on)} a ${fmtDay(c.ends_on)}`}</option>
                  ))}
                </select>
              </label>
              {fieldError("campaign_id")}
            </div>
          )}
          {!weekly && (
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
          {name === "leish" && (
            <div style={{ ...fieldLabel, minWidth: 280 }}>
              <label style={fieldLabel}>
                Inquérito
                <select value={surveyId} style={inputStyle} aria-describedby={describedBy("survey_id")}
                  onChange={(e) => edit(setSurveyId)(e.target.value)}>
                  <option value="">Todos os inquéritos</option>
                  {(surveys.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{`${s.name} · ${fmtDay(s.starts_on)} a ${fmtDay(s.ends_on)}`}</option>
                  ))}
                </select>
              </label>
              {fieldError("survey_id")}
            </div>
          )}
        </div>
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={view}>Ver</button>
          <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={() => void download()}>
            Baixar CSV
          </button>
        </div>
        {generalText && <p role="alert" style={alert}>{generalText}</p>}
        {shown && !report.isError && (report.data && !report.isFetching
          ? <ReportTable report={tableOf(report.data)} label={ZOO_REPORT_TITLES[name]} />
          : <p role="status" style={muted}>Carregando…</p>)}
      </div>
    </Panel>
  );
}
