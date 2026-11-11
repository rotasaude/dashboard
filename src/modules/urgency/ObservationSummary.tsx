// A observação no atendimento da UPA (módulo 32b, F-32.7; contrato §4): o leito e as horas da estadia aberta com o alerta por texto,
// as estadias anteriores e as checagens das últimas 48 h. Só com acesso clínico (sem ele as chaves nem vêm). As horas e o alerta
// vêm prontos do api (param das horas: para na última saída quando não há estadia aberta). O motivo de uma checagem fica só aqui,
// no detalhe clínico, nunca no mapa. Nome nulo cai no fallback.
import type { CSSProperties } from "react";
import type { UrgencyDetailAdministration, UrgencyObservationBlock, UrgencyStay } from "../../lib/api";
import { cityDateFormat, fmtHourMinute } from "../../lib/format";
import { todayInCity } from "../../lib/campaigns";
import { adminStatusLabel, alertText, alertTone, endKindLabel, hoursText } from "../../lib/urgencyObservation";
import { Tag } from "../../components/Tag";

const NO_NAME = "sem nome";
// A hora de hoje é só hh:mm; a de outro dia leva a data (dd/mm hh:mm).
const DAY_MONTH: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit" };
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || todayInCity(d) === todayInCity()) return fmtHourMinute(iso);
  return `${cityDateFormat(DAY_MONTH).format(d)} ${fmtHourMinute(iso)}`;
}

const stayLine = (s: UrgencyStay): string => {
  const parts = [ s.bed_label, `${when(s.started_at)}–${s.ended_at ? when(s.ended_at) : ""}` ];
  if (s.end_kind) parts.push(endKindLabel(s.end_kind));
  return parts.join(" · ");
};
const whenOf = (a: UrgencyDetailAdministration): string => a.administered_at ?? a.scheduled_at ?? a.recorded_at;
const byRecent = (a: UrgencyDetailAdministration, b: UrgencyDetailAdministration) => whenOf(b).localeCompare(whenOf(a));

export function ObservationSummary({ block, administrations }: { block: UrgencyObservationBlock; administrations: UrgencyDetailAdministration[] }) {
  const ended = block.stays.filter((s) => s.ended_at !== null && s.stay_id !== block.current?.stay_id);
  const lastEnd = ended.map((s) => s.ended_at as string).sort().pop();
  const alert = block.current ? alertText(block.alert) : null;
  if (!block.current && block.stays.length === 0 && administrations.length === 0) return null;
  const checks = [ ...administrations ].sort(byRecent);

  return (
    <section aria-label="Observação do paciente" style={box}>
      <strong style={{ fontSize: 13 }}>Observação</strong>
      {block.current ? (
        <p style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <span>{`${block.current.bed_label} · ${hoursText(block.hours)}`}</span>
          {alert && <Tag tone={alertTone(block.alert)}>{alert}</Tag>}
        </p>
      ) : lastEnd ? (
        <p style={{ margin: 0, fontSize: 12.5 }}>{`Saiu da observação às ${when(lastEnd)} · ${hoursText(block.hours)}`}</p>
      ) : (
        <p style={muted}>Fora da observação.</p>
      )}
      {ended.length > 0 && (
        <ul aria-label="Estadias anteriores" style={list}>
          {ended.map((s) => <li key={s.stay_id} style={{ color: "var(--ink2)" }}>{stayLine(s)}</li>)}
        </ul>
      )}
      {checks.length > 0 && (
        <>
          <strong style={{ fontSize: 12 }}>Checagens das últimas 48 h</strong>
          <ul aria-label="Checagens das últimas 48 h" style={list}>
            {checks.map((a) => (
              <li key={a.id} style={{ color: "var(--ink2)" }}>
                {`${when(whenOf(a))} · ${a.catalog_item?.name ?? "medicamento"} · ${adminStatusLabel(a.status)} por ${a.by.name ?? NO_NAME}`}
                {a.reason && <span style={{ display: "block", whiteSpace: "pre-wrap" }}>{a.reason}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8 };
const list: CSSProperties = { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2, fontSize: 12 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
