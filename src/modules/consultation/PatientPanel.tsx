// src/modules/consultation/PatientPanel.tsx
// Painel do paciente no atendimento e na abertura justificada (módulo 19;
// spec §7; contratos §3). Mostra só o nome de exibição (social, senão o
// completo): o nome de registro não aparece aqui.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { Addendum, ClinicalRecord, ConsultationSummary, VitalSigns } from "../../lib/api";
import { ageLabel, onsetLabel } from "../../lib/consultation";
import { COLOR_LABEL, COLOR_TONE, GLUCOSE_MOMENT_LABEL, VITALS, alertLabel } from "../../lib/screening";
import { sexLabel } from "../../lib/profile";
import { fmtDateTime, fmtNumber } from "../../lib/format";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { DataTable } from "../../components/DataTable";
import { secondaryButtonStyle } from "../../components/formStyles";
import type { TimelineSubject } from "../../lib/api";
import { SegmentedControl } from "../../shell/SegmentedControl";
import { PatientTimeline } from "../timeline/PatientTimeline";
import { PatientExams, type PatientExamsProps } from "../exams/PatientExams";

// Módulo 20: a aba "Linha do tempo" (quem passa a prop decide a pessoa).
// `onAddendumAdded`: o mesmo do Resumo, para a consulta aberta pela aba; os
// problemas do paciente vêm do próprio prontuário (record.problems).
export interface PatientTimelineProps {
  subject: TimelineSubject; endOnOutOfContext?: boolean; onOpeningRequired?(): void; searchDelayMs?: number;
  onAddendumAdded?(addendum: Addendum): void;
}

export function VitalsList({ vitals, label }: { vitals: VitalSigns; label: string }) {
  const measured = VITALS.filter((v) => typeof vitals[v.key] === "number");
  if (measured.length === 0 && !vitals.glucose_moment && typeof vitals.bmi !== "number") return null;
  return (
    <ul aria-label={label} style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
      {measured.map((v) => (
        <li key={v.key}>{`${v.label}: ${fmtNumber(vitals[v.key] as number)}${v.unit ? ` ${v.unit}` : ""}`}</li>
      ))}
      {vitals.glucose_moment && <li>{`Momento da glicemia: ${GLUCOSE_MOMENT_LABEL[vitals.glucose_moment]}`}</li>}
      {typeof vitals.bmi === "number" && <li>{`IMC: ${fmtNumber(vitals.bmi)}`}</li>}
    </ul>
  );
}

// Módulo 19c: `besideProblems` = os medicamentos em uso, logo depois dos problemas.
// Módulo 20: `timeline` liga as abas "Resumo" e "Linha do tempo"; módulo 21a: `exams`, a aba "Exames".
export function PatientPanel({ record, onOpenConsultation, besideProblems, timeline, exams }: {
  record: ClinicalRecord; onOpenConsultation(id: string): void; besideProblems?: ReactNode; timeline?: PatientTimelineProps;
  exams?: PatientExamsProps;
}) {
  const { patient, problems, consultations } = record;
  const active = problems.filter((p) => p.status === "active");
  const rev = record.today_screening?.current_revision ?? null;
  // A linha do tempo só lê na primeira abertura da aba e depois fica montada
  // (escondida), para a volta ao Resumo não perder filtros nem páginas.
  type PanelTab = "summary" | "timeline" | "exams";
  const [ tab, setTab ] = useState<PanelTab>("summary");
  const [ timelineOpened, setTimelineOpened ] = useState(false);
  const [ examsOpened, setExamsOpened ] = useState(false);
  const onTimeline = !!timeline && tab === "timeline";
  const onExams = !!exams && tab === "exams";
  const onSummary = !onTimeline && !onExams;
  const tabs: { key: PanelTab; label: string }[] = [
    { key: "summary", label: "Resumo" },
    ...(timeline ? [ { key: "timeline" as const, label: "Linha do tempo" } ] : []),
    ...(exams ? [ { key: "exams" as const, label: "Exames" } ] : [])
  ];

  return (
    <section aria-label="Paciente" style={panel}>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <KeyValue k="Nome" v={patient.display_name} mono={false} />
        <KeyValue k="Idade" v={ageLabel(patient.age)} />
        <KeyValue k="Sexo" v={sexLabel(patient.sex)} />
        <KeyValue k="CPF" v={patient.cpf_masked} />
      </div>

      {tabs.length > 1 && (
        <SegmentedControl<PanelTab> options={tabs} value={tab} onChange={(key) => {
          setTab(key);
          if (key === "timeline") setTimelineOpened(true);
          if (key === "exams") setExamsOpened(true);
        }} />
      )}

      {/* display: contents não mexe no gap do painel; só vale com o Resumo aberto. */}
      <div hidden={!onSummary} style={onSummary ? { display: "contents" } : undefined}>
      <div style={block}>
        <strong style={sub}>Problemas ativos</strong>
        {active.length === 0 ? <p style={muted}>nenhum problema ativo</p> : (
          <ul aria-label="problemas ativos" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
            {active.map((p) => (
              <li key={p.id}><span className="mono">{p.code}</span>{` — ${p.label} · ${onsetLabel(p.onset_on, p.onset_precision)}`}</li>
            ))}
          </ul>
        )}
      </div>
      {besideProblems}

      <div style={block}>
        <strong style={sub}>Escuta de hoje</strong>
        {rev ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Tag tone={COLOR_TONE[rev.final_color]}>{COLOR_LABEL[rev.final_color]}</Tag>
              <span><span className="mono">{rev.ciap2.code}</span>{` — ${rev.ciap2.label}`}</span>
            </span>
            {rev.complaint_note && <span>{`Queixa: ${rev.complaint_note}`}</span>}
            <VitalsList vitals={rev.vitals ?? {}} label="sinais da escuta de hoje" />
            {(rev.alerts ?? []).length > 0 && (
              <span style={{ color: "var(--down)", fontWeight: 600 }}>{(rev.alerts ?? []).map(alertLabel).join(" · ")}</span>
            )}
          </div>
        ) : <p style={muted}>sem escuta concluída hoje</p>}
      </div>

      <div style={block}>
        <strong style={sub}>Últimas consultas</strong>
        <DataTable<ConsultationSummary>
          cols={[
            { label: "Data", w: "1fr", render: (c) => fmtDateTime(c.finalized_at) },
            { label: "Profissional", w: "1.6fr", render: (c) => `${c.author_name} · ${c.cbo_label}` },
            { label: "Tipo", w: "1fr", render: (c) => c.care_type_label },
            { label: "Problemas", w: "1fr", render: (c) => c.problems.map((p) => p.code).join(", ") || "—" },
            { label: "Adendos", w: "0.6fr", align: "right", render: (c) => String(c.addenda_count) },
            {
              label: "", w: "auto", align: "right", render: (c) => (
                <button type="button" aria-label={`Abrir consulta de ${fmtDateTime(c.finalized_at)}`} style={secondaryButtonStyle}
                  onClick={() => onOpenConsultation(c.id)}>
                  Abrir
                </button>
              )
            }
          ]}
          rows={consultations}
          rowKey={(c) => c.id}
          empty="nenhuma consulta anterior"
        />
      </div>
      </div>

      {timeline && timelineOpened && (
        <div hidden={!onTimeline} style={onTimeline ? { display: "contents" } : undefined}>
          <PatientTimeline {...timeline} patientProblems={problems} />
        </div>
      )}
      {exams && examsOpened && (
        <div hidden={!onExams} style={onExams ? { display: "contents" } : undefined}>
          <PatientExams {...exams} />
        </div>
      )}
    </section>
  );
}

const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 };
const block: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const sub: CSSProperties = { fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
