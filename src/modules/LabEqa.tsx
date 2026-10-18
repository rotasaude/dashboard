// src/modules/LabEqa.tsx
// Controle externo da qualidade (spec §5.10; contrato §4): rodadas do ano com
// a adequação por item; taxa de adequação por analito; relatório anual por
// programa (C-E24: registro próprio, não campo da rodada). Do liberador
// (RT incluso) e do admin (spec §8). Sem dado de paciente.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchEqaAnnualReport, getEqaSummary, listEqaRounds, listLabExams, type EqaProgramSummary, type EqaRound, type EqaSummaryRow } from "../lib/api";
import { EQA_ROUNDS_KEY, EQA_SUMMARY_KEY, QC_DISABLED, QC_EXAMS_KEY, adequacyRate, analyteName, qcError, yearProblem } from "../lib/qc";
import { todayInCity } from "../lib/campaigns";
import { fmtDay } from "../lib/exams";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { openLabPdf } from "./lab/openLabPdf";
import { RoundForm } from "./eqa/RoundForm";
import { AnnualReportForm } from "./eqa/AnnualReportForm";
import { alert, fieldLabel, okText, stack } from "./exams/styles";

export function LabEqa({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <LabGate title="Controle externo (CEQ)" sub="CEQ · rodadas, adequação por analito e relatório anual"
      allow={(r) => r.admin || r.releaser} requires={[ "lab_quality_control" ]} disabledText={QC_DISABLED}>
      {() => <LabPick>{(lab) => <EqaBody providerId={lab.id} onGoToSecurity={onGoToSecurity} />}</LabPick>}
    </LabGate>
  );
}

function EqaBody({ providerId, onGoToSecurity }: { providerId: string; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const currentYear = Number(todayInCity().slice(0, 4));
  const [ year, setYear ] = useState(String(currentYear));
  // Ano malformado nunca vai para a URL (o api responde 422 invalid_year): a consulta fica desligada.
  const yearError = yearProblem(year, currentYear);
  const valid = yearError === null;
  const exams = useQuery({ queryKey: [ QC_EXAMS_KEY, providerId ], queryFn: () => listLabExams(providerId), retry: false });
  const rounds = useQuery({ queryKey: [ EQA_ROUNDS_KEY, providerId, year ], queryFn: () => listEqaRounds(providerId, year), enabled: valid, retry: false });
  const summary = useQuery({ queryKey: [ EQA_SUMMARY_KEY, providerId, year ], queryFn: () => getEqaSummary(providerId, year), enabled: valid, retry: false });
  const [ creating, setCreating ] = useState<"round" | "report" | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const examList = exams.data ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [ EQA_ROUNDS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ EQA_SUMMARY_KEY ] });
  };

  async function openReport(id: string) {
    const out = await openLabPdf(() => fetchEqaAnnualReport(id));
    setError(out.ok ? null : out.text);
  }

  return (
    <div style={stack}>
      <label style={fieldLabel}>Ano<input value={year} inputMode="numeric" style={{ ...inputStyle, maxWidth: 120 }} onChange={(e) => setYear(e.target.value.trim())} /></label>
      {yearError && <p role="alert" style={alert}>{yearError}</p>}
      {notice && <p role="status" style={okText}>{notice}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      <Panel title="Rodadas" sub="uma linha por rodada do programa de proficiência"
        right={<button type="button" style={secondaryButtonStyle} onClick={() => { setCreating("round"); setNotice(null); }}>Nova rodada</button>}>
        <div style={stack}>
          {rounds.isError ? <p role="alert" style={alert}>{qcError(rounds.error)}</p> : (
            <DataTable<EqaRound>
              cols={[
                { label: "Data", w: "0.8fr", card: "title", render: (r) => fmtDay(r.round_date) },
                { label: "Programa · rodada", w: "1.3fr", render: (r) => `${r.program} · ${r.round_code}` },
                { label: "Adequação", w: "1fr", render: (r) => {
                  const ok = r.items.filter((i) => i.adequacy === "adequate").length;
                  return <>{`${ok}/${r.items.length} adequados`}{ok < r.items.length && <> <Tag tone="down">inadequado</Tag></>}</>;
                } }
              ]}
              rows={valid ? rounds.data ?? [] : []} rowKey={(r) => r.id} empty={valid && rounds.isPending ? "carregando…" : "nenhuma rodada neste ano"}
            />
          )}
          {creating === "round" && (
            <RoundForm providerId={providerId} exams={examList} onGoToSecurity={onGoToSecurity} onCancel={() => setCreating(null)} onStale={refresh}
              onSaved={() => { setCreating(null); setNotice("Rodada registrada."); refresh(); }} />
          )}
        </div>
      </Panel>
      <Panel title="Adequação no ano" sub="por analito, somando as rodadas do ano">
        {summary.isError ? <p role="alert" style={alert}>{qcError(summary.error)}</p> : (
          <DataTable<EqaSummaryRow>
            cols={[
              { label: "Analito", w: "1.6fr", card: "title", render: (s) => analyteName(examList, s.lab_exam_id, s.analyte_key) },
              { label: "Rodadas", w: "0.6fr", align: "right", render: (s) => String(s.rounds) },
              { label: "Adequados", w: "0.7fr", align: "right", render: (s) => String(s.adequate) },
              { label: "Inadequados", w: "0.7fr", align: "right", render: (s) => String(s.inadequate) },
              { label: "Taxa", w: "0.6fr", align: "right", render: (s) => adequacyRate(s) }
            ]}
            rows={valid ? summary.data?.rows ?? [] : []} rowKey={(s) => `${s.lab_exam_id}:${s.analyte_key}`}
            empty={valid && summary.isPending ? "carregando…" : "nenhuma rodada neste ano"}
          />
        )}
      </Panel>
      <Panel title="Relatório anual" sub="um PDF por programa e ano, enviado pelo programa externo"
        right={<button type="button" style={secondaryButtonStyle} disabled={!valid} onClick={() => { setCreating("report"); setNotice(null); }}>Registrar relatório anual</button>}>
        <div style={stack}>
          {summary.isError ? null : (
            <DataTable<EqaProgramSummary>
              cols={[
                { label: "Programa", w: "1.4fr", card: "title", render: (p) => p.program },
                { label: "Relatório", w: "1.2fr", render: (p) => (p.annual_report ? <Tag tone="ok">registrado</Tag> : "sem relatório neste ano") },
                { label: "", w: "auto", card: "actions", render: (p) => (p.annual_report && p.annual_report_id
                  ? <button type="button" style={secondaryButtonStyle} onClick={() => void openReport(p.annual_report_id!)}>{`Abrir relatório de ${p.program}`}</button> : null) }
              ]}
              rows={valid ? summary.data?.programs ?? [] : []} rowKey={(p) => p.program}
              empty={valid && summary.isPending ? "carregando…" : "nenhum programa neste ano"}
            />
          )}
          {creating === "report" && valid && (
            <AnnualReportForm providerId={providerId} year={year} currentYear={currentYear} onGoToSecurity={onGoToSecurity}
              onCancel={() => setCreating(null)} onStale={refresh}
              onSaved={() => { setCreating(null); setNotice("Relatório anual registrado."); refresh(); }} />
          )}
        </div>
      </Panel>
    </div>
  );
}
