// Bloco odontológico da consulta (F-28.2, F-28.3): odontograma com o painel do dente, plano de tratamento, procedimentos
// e achados do rascunho e, fora do registro inicial, os campos da FAO. Leituras nominais (com trilha), sem polling.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDentalChart, listDentalPlans, type ClinicalRecord, type Consultation, type ConsultationOptions, type DentalFields,
  type DentalPlan, type DentalRole, type Dentition, type HealthUnit } from "../../lib/api";
import { DENTAL_CHART_KEY, DENTAL_PLANS_KEY, dentalError, locationLabel, NOMINAL_QUERY, quantityProblems, situationLabel, withoutFinding, withoutProcedure }
  from "../../lib/dental";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, panel, row } from "../exams/styles";
import { Odontogram, type ToothSelection } from "./Odontogram";
import { ProsthesisPanel } from "./ProsthesisPanel";
import { TreatmentPlanPanel } from "./TreatmentPlanPanel";
import { ToothActions } from "./ToothActions";
import { FaoFields } from "./FaoFields";
import { PeriodontalScreeningFields } from "./PeriodontalScreeningFields";
import { PeriodontalChartFields } from "./PeriodontalChartFields";
import { EndodonticsFields } from "./EndodonticsFields";
import { findingLocation } from "./DentalSummary";

interface Props {
  consultation: Consultation;
  record: ClinicalRecord;
  unit: Pick<HealthUnit, "id" | "name" | "kind">;
  options: ConsultationOptions;
  value: DentalFields;
  role: DentalRole;
  baseline: boolean;
  planRefreshKey?: number;
  searchDelayMs?: number;
  onChange(f: DentalFields): void;
  onPlanRead?(plan: DentalPlan | null): void;
}

export function DentalEditor({ consultation, record, unit, options, value, role, baseline, planRefreshKey = 0, searchDelayMs, onChange, onPlanRead }: Props) {
  const patientId = record.patient.id;
  const situations = options.dental?.situations;
  const [ selection, setSelection ] = useState<ToothSelection | null>(null);
  const [ dentition, setDentition ] = useState<Dentition | null>(null);
  // `open` só no estado inicial: tirar o último item não pode fechar a seção debaixo do dentista.
  const openAtMount = useRef({ screening: value.periodontal_screening !== null, chart: value.periodontal_chart !== null, endo: value.endodontics.length > 0 });
  const [ prefilledPregnant ] = useState(value.pregnant === true);

  const chart = useQuery({ queryKey: [ DENTAL_CHART_KEY, patientId ], queryFn: () => getDentalChart(patientId), ...NOMINAL_QUERY });
  const plans = useQuery({
    queryKey: [ DENTAL_PLANS_KEY, patientId, unit.id, planRefreshKey ], enabled: !baseline,
    queryFn: () => listDentalPlans(patientId, { healthUnitId: unit.id, status: "open" }), ...NOMINAL_QUERY
  });
  const plan = plans.data?.[0] ?? null;

  const onPlanReadRef = useRef(onPlanRead);
  onPlanReadRef.current = onPlanRead;
  useEffect(() => { if (plans.isSuccess) onPlanReadRef.current?.(plans.data[0] ?? null); }, [ plans.isSuccess, plans.data ]);

  const pending = useMemo(() => {
    const counts: Record<string, number> = {};
    const bump = (tooth: string | null) => { if (tooth) counts[tooth] = (counts[tooth] ?? 0) + 1; };
    value.findings.forEach((f) => bump(f.tooth));
    value.procedures.forEach((p) => bump(p.location.tooth));
    return counts;
  }, [ value.findings, value.procedures ]);

  const problems = quantityProblems(value.procedures);
  // Dentes oferecidos às especialidades: os do odontograma que não estão ausentes.
  const presentTeeth = (chart.data?.teeth ?? []).filter((t) => t.situation !== "missing").map((t) => t.tooth);
  const dentist = role === "dentist";
  const loadError = chart.error ?? plans.error;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {baseline && <p style={muted}>Registro inicial: marque a situação de cada dente. Não gera ficha do e-SUS.</p>}
      {loadError && <p role="alert" style={alert}>{dentalError(loadError)}</p>}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {chart.isPending && <p style={muted}>Carregando odontograma…</p>}
          {chart.data && (
            <Odontogram teeth={chart.data.teeth} dentition={dentition ?? chart.data.dentition} situations={situations} pending={pending}
              selected={selection} onSelect={setSelection} onDentitionChange={setDentition} />
          )}
          <ToothActions selection={selection} value={value} plan={plan} unit={unit} role={role} baseline={baseline} situations={situations}
            searchDelayMs={searchDelayMs} patientId={patientId} onSelectFace={(face) => setSelection((s) => (s ? { tooth: s.tooth, face } : s))} onChange={onChange} />
        </div>
        {!baseline && (
          <TreatmentPlanPanel plan={plan} value={value} unit={unit} role={role} onChange={onChange}
            onMarkCompleted={() => onChange({ ...value, dental_outcomes: value.dental_outcomes.includes("15") ? value.dental_outcomes : [ ...value.dental_outcomes, "15" ] })} />
        )}
      </div>
      {!baseline && (
        <section aria-label="Procedimentos desta consulta" style={panel}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Procedimentos desta consulta</h3>
          {value.procedures.length === 0 && <p style={muted}>Nenhum procedimento registrado.</p>}
          {value.procedures.map((p, i) => {
            const item = plan?.items.find((x) => x.id === p.plan_item_id);
            return (
              <div key={`${p.sigtap}-${i}`} style={row}>
                <span style={{ fontSize: 12.5 }}>
                  <span className="mono">{p.sigtap}</span> {p.name ?? ""} · {locationLabel(p.location)} · quantidade {p.quantity}
                  {p.plan_item_id ? ` · item do plano${item ? `: ${locationLabel(item.location)}` : ""}` : ""}
                </span>
                <button type="button" style={secondaryButtonStyle} aria-label={`Remover procedimento — ${p.name ?? p.sigtap}`}
                  onClick={() => onChange(withoutProcedure(value, i))}>Remover</button>
              </div>
            );
          })}
          {problems.map((text) => <p key={text} role="alert" style={alert}>{text}</p>)}
        </section>
      )}
      <section aria-label="Achados desta consulta" style={panel}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Achados desta consulta</h3>
        {value.findings.length === 0 && <p style={muted}>Nenhum achado marcado.</p>}
        {value.findings.map((f, i) => {
          const group = f.tooth === null ? "arch" : f.face ? "face" : f.part;
          const text = `${findingLocation(f)}: ${situationLabel(f.situation, situations, group)}`;
          return (
            <div key={`${findingLocation(f)}-${i}`} style={row}>
              <span style={{ fontSize: 12.5 }}>{text}</span>
              <button type="button" style={secondaryButtonStyle} aria-label={`Remover achado — ${text}`} onClick={() => onChange(withoutFinding(value, i))}>Remover</button>
            </div>
          );
        })}
      </section>
      {!baseline && dentist && (
        <ProsthesisPanel consultation={consultation} patientId={patientId} value={value} onChange={onChange} searchDelayMs={searchDelayMs} />
      )}
      {!baseline && (
        <section aria-label="Especialidades" style={panel}>
          <h3 style={{ margin: 0, fontSize: 14 }}>Especialidades</h3>
          <details open={openAtMount.current.screening}>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>Registro periodontal simplificado</summary>
            <PeriodontalScreeningFields value={value.periodontal_screening} onChange={(v) => onChange({ ...value, periodontal_screening: v })} />
          </details>
          {dentist && (
            <>
              <details open={openAtMount.current.chart}>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>Periograma</summary>
                <PeriodontalChartFields value={value.periodontal_chart} teeth={presentTeeth} onChange={(v) => onChange({ ...value, periodontal_chart: v })} />
              </details>
              <details open={openAtMount.current.endo}>
                <summary style={{ cursor: "pointer", fontSize: 13 }}>Endodontia</summary>
                <EndodonticsFields value={value.endodontics} teeth={presentTeeth} patientId={patientId} onChange={(v) => onChange({ ...value, endodontics: v })} />
              </details>
            </>
          )}
        </section>
      )}
      {!baseline && (
        <FaoFields value={value} sex={record.patient.sex} role={role} prefilledPregnant={prefilledPregnant} vocabulary={options.dental} onChange={onChange} />
      )}
    </div>
  );
}
