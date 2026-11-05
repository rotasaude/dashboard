// Módulo 31 — F-31.4: "Hoje no CAPS". `GET /psychosocial/today` no dia da cidade: os grupos do dia (presença registrada quando
// `action_id != null` — `!= null`, para um api sem a chave contar como não registrada; senão "Registrar presença de <nome>" abre a
// `PresenceList` ali mesmo) e os atendimentos marcados ("HH:MM · <nome> · <técnico>"). Só `<patient-ref>` e o técnico, campo a campo:
// nada clínico, nada de trilha (é lista). "Abrir <nome>" passa o handoff { enrollmentId, unitId } a "Usuários do CAPS", que lê o detalhe
// (com trilha) no CAPS da matrícula. Nada daqui avisa o usuário (decisão 4). Chaves com o id do CAPS.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPsyOptions, getPsyToday, type PsyTodayGroup, type PsyTodayVisit, type PsyUnit } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtHourMinute } from "../lib/format";
import {
  NOMINAL_QUERY, NO_CLINICAL_IN_LIST, NO_GROUPS_TODAY, NO_VISITS_TODAY, PRESENCE_DONE_TAG, PRESENCE_SAVED, PSY_OPTIONS_KEY, PSY_TODAY_KEY, STATIC_QUERY,
  TODAY_NO_NOTICE, groupKindLabel, psyError, type PsyEnrollmentHandoff
} from "../lib/psychosocial";
import { DataTable, type Column } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, okText, row, stack } from "./exams/styles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";
import { PresenceList } from "./psychosocial/PresenceList";

export type CapsTodayProps = { today?: string; now?: Date; onOpenEnrollment?(h: PsyEnrollmentHandoff): void };

export function CapsToday(props: CapsTodayProps) {
  return (
    <PsychosocialGate title="Hoje no CAPS" sub="Grupos e atendimentos do dia" allow={(r) => r.staff}>
      {({ unit }) => (unit ? <Today unit={unit} {...props} /> : null)}
    </PsychosocialGate>
  );
}

function Today({ unit, today, now, onOpenEnrollment }: CapsTodayProps & { unit: PsyUnit }) {
  const queryClient = useQueryClient();
  const date = today ?? todayInCity(now ?? new Date());
  const [ presence, setPresence ] = useState<PsyTodayGroup | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);
  // Cancelar a presença devolve o foco ao botão do grupo (o painel remonta: ele é achado pelo `data-opener`).
  const rootRef = useRef<HTMLDivElement | null>(null);
  const opener = useRef<string | null>(null);
  const [ refocus, setRefocus ] = useState(0);
  useEffect(() => {
    if (refocus === 0 || !opener.current) return;
    rootRef.current?.querySelector<HTMLElement>(`[data-opener="${opener.current}"]`)?.focus();
  }, [ refocus ]);
  const cancel = () => { setPresence(null); setRefocus((n) => n + 1); };

  // Os atendimentos trazem o nome do usuário: sem cache.
  const day = useQuery({ queryKey: [ PSY_TODAY_KEY, unit.id, date ], queryFn: () => getPsyToday(unit.id, date), ...NOMINAL_QUERY });
  const options = useQuery({ queryKey: [ PSY_OPTIONS_KEY, unit.id ], queryFn: () => getPsyOptions(unit.id), ...STATIC_QUERY });

  if (presence && !options.data) {
    return options.isError ? (
      <div style={stack}>
        <p role="alert" style={alert}>{psyError(options.error)}</p>
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={cancel}>Voltar</button></div>
      </div>
    ) : <p className="mono" style={muted}>carregando…</p>;
  }
  if (presence && options.data) {
    return (
      <PresenceList unit={unit} group={presence} options={options.data} date={day.data?.date ?? date} now={now}
        onSaved={() => {
          setPresence(null);
          setDone(PRESENCE_SAVED);
          void queryClient.invalidateQueries({ queryKey: [ PSY_TODAY_KEY, unit.id ] });
        }}
        onCancel={cancel} />
    );
  }

  const groupCols: Column<PsyTodayGroup>[] = [
    { label: "Grupo", w: "1.3fr", card: "title", render: (g) => g.name },
    { label: "Horário", w: "auto", render: (g) => `${g.starts_at}–${g.ends_at}` },
    { label: "Tipo", w: "auto", render: (g) => <Tag tone="info">{groupKindLabel(g.kind)}</Tag> },
    { label: "Responsável", w: "1fr", render: (g) => g.responsible.name },
    {
      label: "Presença", w: "auto", card: "actions", render: (g) => (g.action_id != null ? <Tag tone="ok">{PRESENCE_DONE_TAG}</Tag> : (
        <button type="button" style={buttonStyle} aria-label={`Registrar presença de ${g.name}`} data-opener={`presence-${g.id}`}
          onClick={() => { setDone(null); opener.current = `presence-${g.id}`; setPresence(g); }}>Registrar presença</button>
      ))
    }
  ];
  // Só os campos da linha, um a um (nada clínico mesmo que o api mande por engano).
  const visitCols: Column<PsyTodayVisit>[] = [
    { label: "Atendimento", w: "1fr", card: "title", render: (v) => `${fmtHourMinute(v.next_visit_at)} · ${v.patient.name} · ${v.reference.name}` },
    ...(onOpenEnrollment ? [ {
      label: "Ações", w: "auto", card: "actions" as const, render: (v: PsyTodayVisit) => (
        <button type="button" style={secondaryButtonStyle} aria-label={`Abrir ${v.patient.name}`}
          onClick={() => onOpenEnrollment({ enrollmentId: v.enrollment_id, unitId: unit.id })}>Abrir</button>
      )
    } ] : [])
  ];

  return (
    <div ref={rootRef} style={stack}>
      {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
      <p style={muted}>{TODAY_NO_NOTICE}</p>
      {options.isError && <p role="alert" style={alert}>{psyError(options.error)}</p>}
      {day.isPending ? <p className="mono" style={muted}>carregando…</p>
        : day.isError ? <p role="alert" style={alert}>{psyError(day.error)}</p>
        : (
          <>
            <Panel title="Grupos de hoje">
              <DataTable<PsyTodayGroup> cols={groupCols} rows={day.data.groups} rowKey={(g) => g.id} empty={NO_GROUPS_TODAY} />
            </Panel>
            <Panel title="Atendimentos de hoje">
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={muted}>{NO_CLINICAL_IN_LIST}</p>
                <DataTable<PsyTodayVisit> cols={visitCols} rows={day.data.visits} rowKey={(v) => v.enrollment_id} empty={NO_VISITS_TODAY} />
              </div>
            </Panel>
          </>
        )}
    </div>
  );
}
