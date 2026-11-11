// Módulo 32a — F-32.6: painel da urgência (contrato §11 e §14 Q15, Q25, Q28; preflight A11, C-T13, E5). Portão: interruptor e papel
// (gestão ou analista). A forma é a do api (Urgency::Dashboard): só contagens, de 1 a 4 chega "lt5" e aparece "menos de 5", nunca
// calculado nem somado; tempos com contagem 0 chegam nulos ("—"). Não há total (o api não tem, e somar o suprimido inventaria
// número); "Fora do tempo máximo" é "over de count", com o % só com os dois em número. `registered_in_error` fica fora de tudo (Q25),
// a evasão é só `left_without_care` (Q28). A cor vai sempre pelo tom e pelo texto (o tema não tem laranja). As UPAs do seletor vêm
// de `units` da leitura de todas: o analista não lê /attendance/units. Sem polling; nenhum dado de paciente sai do api.
import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getUrgencyDashboard, type UrgencyColor, type UrgencyCount, type UrgencyDashboard, type UrgencyOverMaxWait, type UrgencyTime,
  type UrgencyTimeRow
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { todayInCity } from "../lib/campaigns";
import { STATIC_QUERY } from "../lib/careLines";
import { monthLabel } from "../lib/regulation";
import {
  OUTCOME_KINDS, SMALL_COUNT, URGENCY_COLORS, URGENCY_COLOR_TONE, URGENCY_DASHBOARD_KEY, URGENCY_DISABLED, canUseUrgency, colorLabel,
  countLabel, outcomeLabel, timesLabel, urgencyError
} from "../lib/urgency";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { StatTile } from "../components/StatTile";
import { Tag } from "../components/Tag";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

export const URGENCY_NO_ROLE = "você não tem acesso ao painel da urgência";
export const PANEL_SMALL_NOTE = "Contagens de 1 a 4 aparecem como “menos de 5”.";
export const PANEL_SCOPE_NOTE =
  "“Saíram sem atendimento” conta só quem saiu sem ser atendido; quem saiu contra orientação médica está em “Por desfecho”. " +
  "“Fora do tempo máximo” inclui quem saiu sem atendimento depois de classificado. O registro por engano não entra em nenhuma contagem.";
export const MONTH_PROBLEM = "escolha um mês até o atual";
const ALL_UPAS = "Todas as UPAs";
const MONTH_FORMAT = /^\d{4}-(0[1-9]|1[0-2])$/;

// Minutos de uma mediana ou p90 sozinha (as telhas da permanência).
export function minutesText(t: UrgencyTime): string {
  if (t === "lt5") return SMALL_COUNT;
  return t === null ? "—" : `${t} min`;
}

// Horas da observação (1 casa, vírgula): "lt5" vira "menos de 5" e nulo "—".
export function hoursText(t: UrgencyTime): string {
  if (t === "lt5") return SMALL_COUNT;
  return t === null ? "—" : `${String(t).replace(".", ",")} h`;
}

// "over de count"; o % só com os dois em número e count > 0 (com "lt5", a conta revelaria o número escondido).
export function overText(o: UrgencyOverMaxWait | undefined): string {
  if (!o || o.count === 0) return "—";
  const base = `${countLabel(o.over)} de ${countLabel(o.count)}`;
  return typeof o.over === "number" && typeof o.count === "number" ? `${base} (${Math.round((o.over / o.count) * 100)}%)` : base;
}

export function UrgencyPanel({ today }: { today?: string } = {}) {
  const { user } = useAuth();
  if (!user) return null;
  const roles = user.memberships.map((m) => m.role);
  let body;
  if (!canUseUrgency(user)) body = <EmptyState title={URGENCY_DISABLED} />;
  else if (!roles.includes("municipal_admin") && !roles.includes("analyst")) body = <EmptyState title={URGENCY_NO_ROLE} />;
  else body = <PanelBody today={today ?? todayInCity()} />;
  return (
    <div style={stack}>
      <PageHeader title="Painel da urgência" sub="UPA · tempos e desfechos" />
      {body}
    </div>
  );
}

type Upa = { id: string; name: string };

function PanelBody({ today }: { today: string }) {
  const uid = useId();
  const current = today.slice(0, 7);
  const [ month, setMonth ] = useState(current);
  const [ unitId, setUnitId ] = useState("");
  const [ upas, setUpas ] = useState<Upa[]>([]);
  const monthOk = MONTH_FORMAT.test(month) && month <= current;
  const dash = useQuery({
    queryKey: [ URGENCY_DASHBOARD_KEY, month, unitId || null ],
    queryFn: () => getUrgencyDashboard({ month, unitId: unitId || null }),
    enabled: monthOk, ...STATIC_QUERY
  });
  // A lista de UPAs é a da leitura de todas (a leitura de uma traz só ela); fica enquanto uma UPA está escolhida.
  useEffect(() => {
    if (!unitId && dash.data) setUpas(dash.data.units);
  }, [ unitId, dash.data ]);

  return (
    <div style={stack}>
      <div style={row}>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-month`}>Mês</label>
          <input id={`${uid}-month`} type="month" value={month} max={current} style={inputStyle}
            aria-invalid={!monthOk || undefined} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-upa`}>UPA do painel</label>
          <select id={`${uid}-upa`} value={unitId} style={inputStyle} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">{ALL_UPAS}</option>
            {upas.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      </div>
      {!monthOk && <p role="alert" style={alert}>{MONTH_PROBLEM}</p>}
      {monthOk && dash.isPending && <p className="mono" style={muted}>carregando…</p>}
      {monthOk && dash.isError && <p role="alert" style={alert}>{urgencyError(dash.error)}</p>}
      {monthOk && dash.data && !dash.isError && (
        <DashboardView data={dash.data} scope={unitId ? upas.find((u) => u.id === unitId)?.name ?? "" : ALL_UPAS} />
      )}
    </div>
  );
}

type TimesRow = { color: UrgencyColor; door?: UrgencyTimeRow; physician?: UrgencyTimeRow; over?: UrgencyOverMaxWait };
type CountRow = { key: string; label: string; color: UrgencyColor | null; count: UrgencyCount };

const colorCell = (c: UrgencyColor | null, label: string) =>
  c ? <Tag tone={URGENCY_COLOR_TONE[c]} mono={false}>{label}</Tag> : <span>{label}</span>;
const count = (c: UrgencyCount | undefined) => <span className="mono">{c === undefined ? "—" : countLabel(c)}</span>;
const times = (r: UrgencyTimeRow | undefined) => <span className="mono">{r ? timesLabel(r) : "—"}</span>;

const TIMES_COLS: Column<TimesRow>[] = [
  { label: "Cor", w: "0.9fr", card: "title", render: (r) => colorCell(r.color, colorLabel(r.color)) },
  { label: "Classificados", w: "0.8fr", align: "right", render: (r) => count(r.door?.count) },
  { label: "Porta → classificação", w: "1.6fr", render: (r) => times(r.door) },
  { label: "Chamados ao médico", w: "0.8fr", align: "right", render: (r) => count(r.physician?.count) },
  { label: "Classificação → médico", w: "1.6fr", render: (r) => times(r.physician) },
  { label: "Fora do tempo máximo", w: "1.2fr", align: "right", render: (r) => <span className="mono">{overText(r.over)}</span> }
];
const COUNT_COLS = (head: string): Column<CountRow>[] => [
  { label: head, w: "1.6fr", card: "title", render: (r) => colorCell(r.color, r.label) },
  { label: "Quantidade", w: "0.8fr", align: "right", render: (r) => count(r.count) }
];

function byColor<T extends { color: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [ r.color, r ]));
}

function DashboardView({ data, scope }: { data: UrgencyDashboard; scope: string }) {
  const door = byColor(data.door_to_classification);
  const physician = byColor(data.classification_to_physician);
  const over = byColor(data.over_max_wait);
  const timesRows: TimesRow[] = URGENCY_COLORS.map((color) =>
    ({ color, door: door.get(color), physician: physician.get(color), over: over.get(color) }));
  const colorRows: CountRow[] = [
    ...URGENCY_COLORS.map((c) => ({ key: c, label: colorLabel(c), color: c, count: data.by_color[c] })),
    { key: "unclassified", label: "sem classificação", color: null, count: data.by_color.unclassified }
  ];
  // Desfechos na ordem do api; um código que o api acrescentar aparece cru, depois. Q25: nunca o registro por engano.
  const outcomes: Readonly<Record<string, UrgencyCount>> = data.by_outcome;
  const known = OUTCOME_KINDS.filter((k) => k !== "registered_in_error" && k in outcomes) as string[];
  const extra = Object.keys(outcomes).filter((k) => k !== "registered_in_error" && !known.includes(k)).sort();
  const outcomeRows: CountRow[] = [ ...known, ...extra ].map((k) => ({ key: k, label: outcomeLabel(k), color: null, count: outcomes[k] }));

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Mês: ${monthLabel(data.month)} · ${scope}`}</p>
      <section aria-label="Indicadores" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <StatTile label="Saíram sem atendimento antes da classificação" value={countLabel(data.evasion.before_classification)} />
        <StatTile label="Saíram sem atendimento depois da classificação" value={countLabel(data.evasion.after_classification)} />
        <StatTile label="Permanência · mediana" value={minutesText(data.stay.median_minutes)}
          hint={`encerrados no mês: ${countLabel(data.stay.count)}`} />
        <StatTile label="Permanência · p90" value={minutesText(data.stay.p90_minutes)} />
      </section>
      {data.observation && (
        <section aria-label="Observação" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
          <StatTile label="Encontros com observação" value={countLabel(data.observation.stays)} />
          <StatTile label="Observação · mais de 24 h" value={countLabel(data.observation.over_24h)} />
          <StatTile label="Observação · mediana" value={hoursText(data.observation.median_hours)} />
          <StatTile label="Observação · p90" value={hoursText(data.observation.p90_hours)} />
          <StatTile label="Leito-hora no mês" value={hoursText(data.observation.bed_hours)} />
        </section>
      )}
      <p style={muted}>{PANEL_SMALL_NOTE}</p>
      <p style={muted}>{PANEL_SCOPE_NOTE}</p>
      <Panel title="Tempos por cor" sub="cor da 1ª classificação na porta; cor vigente na chamada ao médico">
        <DataTable<TimesRow> label="Tempos por cor" cols={TIMES_COLS} rows={timesRows} rowKey={(r) => r.color} />
      </Panel>
      <Panel title="Atendimentos por cor" sub="cor da última classificação">
        <DataTable<CountRow> label="Atendimentos por cor" cols={COUNT_COLS("Cor")} rows={colorRows} rowKey={(r) => r.key} />
      </Panel>
      <Panel title="Por desfecho" sub="atendimentos encerrados">
        <DataTable<CountRow> label="Por desfecho" cols={COUNT_COLS("Desfecho")} rows={outcomeRows} rowKey={(r) => r.key}
          empty="nenhum atendimento encerrado no mês" />
      </Panel>
    </div>
  );
}
