// src/modules/zoonoses/WeeklyResult.tsx
// Resultado semanal da campanha (módulo 35b, F-35.12): lido só no clique (STATIC_QUERY, sem polling). O api exige o período:
// do início da campanha até hoje, no máximo 365 dias para trás (366 recusa). As duas coberturas (sobre a meta e, quando há
// estimativa, sobre a população; Q19) vêm do api, sem conta aqui. A semana depois do fim previsto leva a frase fixa.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchZoonosesReportFile, getZoonosesReport, type RabiesCampaign } from "../../lib/api";
import { AFTER_PLANNED_END, STATIC_QUERY, ZOO_REPORT_KEY, zoonosesError } from "../../lib/zoonoses";
import { ActionButton } from "../../components/ActionButton";
import { alert, muted, row, stack } from "../exams/styles";
import { saveFile } from "../lab/saveFile";
import { ReportTable, type TableReport } from "../vectorControl/ReportTable";

const DAY = 86_400_000;
const shift = (iso: string, days: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

export function WeeklyResult({ campaign, today }: { campaign: RabiesCampaign; today: string }) {
  const [ shown, setShown ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ problem, setProblem ] = useState<string | null>(null);
  const earliest = shift(today, -365);
  const from = campaign.starts_on > today ? today : campaign.starts_on < earliest ? earliest : campaign.starts_on;
  const filters = { from, to: today, campaign_id: campaign.id };
  const q = useQuery({
    queryKey: [ ZOO_REPORT_KEY, "rabies_weekly", campaign.id, from, today ], queryFn: () => getZoonosesReport("rabies_weekly", filters),
    ...STATIC_QUERY, enabled: shown
  });

  async function csv() {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const file = await fetchZoonosesReportFile("rabies_weekly", filters);
      saveFile(file, file.filename ?? `rabies_weekly-${today}.csv`);
    } catch (err) {
      setProblem(zoonosesError(err));
    } finally {
      setBusy(false);
    }
  }

  let table: TableReport | null = null;
  if (q.data) {
    table = {
      ...q.data,
      rows: q.data.rows.map(({ after_planned_end, ...rest }) => ({
        ...rest, remark: after_planned_end === true && !rest.remark ? AFTER_PLANNED_END : (rest.remark as string | null | undefined) ?? null
      }))
    };
  }
  return (
    <section aria-label="Resultado semanal" style={stack}>
      <div style={row}>
        {!shown && <ActionButton variant="secondary" onClick={() => setShown(true)}>Ver resultado semanal</ActionButton>}
        {shown && <ActionButton variant="secondary" busy={busy} onClick={csv}>Baixar CSV</ActionButton>}
      </div>
      {shown && q.isLoading && <p style={muted}>carregando…</p>}
      {shown && q.isError && <p role="alert" style={alert}>{zoonosesError(q.error)}</p>}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      {table && <ReportTable report={table} label="Resultado semanal" />}
    </section>
  );
}
