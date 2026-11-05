// Módulo 31 — F-31.4: "Grupos e oficinas". A grade semanal (`GET /psychosocial/groups`, sem paciente) num painel por dia da semana, com
// nome, horário, tipo, responsável, vagas, procedimento (o nome vem de `options.procedures`; o grupo só traz o código) e situação. "Novo
// grupo ou oficina" e "Editar" abrem o `GroupForm`; "Registrar presença de <nome>" abre a `PresenceList` no lugar da grade (no celular a
// lista ocupa a tela), na última data do dia da semana do grupo até hoje. Chaves com o id do CAPS.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPsyOptions, listPsyGroups, type PsyGroup, type PsyOptions, type PsyUnit } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import {
  GROUP_SAVED, NO_GROUPS, PRESENCE_SAVED, PSY_GROUPS_KEY, PSY_OPTIONS_KEY, PSY_TODAY_KEY, STATIC_QUERY, groupKindLabel, groupSchedule, lastWeekday,
  psyError, weekdayLabel
} from "../lib/psychosocial";
import { DataTable, type Column } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, okText, row, stack } from "./exams/styles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";
import { GroupForm } from "./psychosocial/GroupForm";
import { PresenceList } from "./psychosocial/PresenceList";

export type CapsGroupsProps = { today?: string; now?: Date };

export function CapsGroups(props: CapsGroupsProps) {
  return (
    <PsychosocialGate title="Grupos e oficinas" sub="Grade semanal e lista de presença" allow={(r) => r.staff}>
      {({ unit }) => (unit ? <Groups unit={unit} {...props} /> : null)}
    </PsychosocialGate>
  );
}

type Mode = { kind: "new" } | { kind: "edit"; group: PsyGroup } | { kind: "presence"; group: PsyGroup } | null;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Groups({ unit, today, now }: CapsGroupsProps & { unit: PsyUnit }) {
  const queryClient = useQueryClient();
  const [ mode, setMode ] = useState<Mode>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);

  const groups = useQuery({ queryKey: [ PSY_GROUPS_KEY, unit.id ], queryFn: () => listPsyGroups(unit.id), ...STATIC_QUERY });
  const options = useQuery({ queryKey: [ PSY_OPTIONS_KEY, unit.id ], queryFn: () => getPsyOptions(unit.id), ...STATIC_QUERY });

  const open = (m: Mode) => { setDone(null); setMode(m); };
  const finish = (text: string) => {
    setMode(null);
    setDone(text);
    void queryClient.invalidateQueries({ queryKey: [ PSY_GROUPS_KEY, unit.id ] });
    void queryClient.invalidateQueries({ queryKey: [ PSY_TODAY_KEY, unit.id ] });
  };

  // Formulário e presença dependem de `options` (equipe e procedimentos).
  if (mode && !options.data) {
    return options.isError ? (
      <div style={stack}>
        <p role="alert" style={alert}>{psyError(options.error)}</p>
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => setMode(null)}>Voltar</button></div>
      </div>
    ) : <p className="mono" style={muted}>carregando…</p>;
  }
  if (mode?.kind === "presence" && options.data) {
    const g = mode.group;
    return (
      <PresenceList unit={unit} group={g} options={options.data} date={lastWeekday(today ?? todayInCity(now ?? new Date()), g.weekday)} now={now}
        onSaved={() => finish(PRESENCE_SAVED)} onCancel={() => setMode(null)} />
    );
  }

  const procName = (o: PsyOptions | undefined, code: string) => {
    const p = o?.procedures.find((x) => x.code === code);
    return p ? `${code} · ${p.name}` : code;
  };
  const cols: Column<PsyGroup>[] = [
    { label: "Grupo", w: "1.3fr", card: "title", render: (g) => g.name },
    { label: "Horário", w: "1fr", render: groupSchedule },
    { label: "Tipo", w: "auto", render: (g) => <Tag tone="info">{groupKindLabel(g.kind)}</Tag> },
    { label: "Responsável", w: "1fr", render: (g) => g.responsible.name },
    { label: "Vagas", w: "auto", render: (g) => String(g.capacity) },
    { label: "Procedimento", w: "1.4fr", render: (g) => procName(options.data, g.sigtap_code) },
    { label: "Situação", w: "auto", render: (g) => (g.active ? <Tag tone="ok">ativo</Tag> : <Tag tone="neutral">inativo</Tag>) },
    {
      label: "Ações", w: "auto", card: "actions", render: (g) => (
        <div style={row}>
          {g.active && (
            <button type="button" style={buttonStyle} aria-label={`Registrar presença de ${g.name}`}
              onClick={() => open({ kind: "presence", group: g })}>Registrar presença</button>
          )}
          <button type="button" style={secondaryButtonStyle} aria-label={`Editar ${g.name}`} onClick={() => open({ kind: "edit", group: g })}>Editar</button>
        </div>
      )
    }
  ];

  const list = groups.data ?? [];
  // Um painel por dia com grupo, de segunda a domingo; dia fora de 1–7 aparece cru no fim, nunca some.
  const days = [ ...new Set(list.map((g) => g.weekday)) ].sort((a, b) => a - b);

  return (
    <div style={stack}>
      {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
      {options.isError && <p role="alert" style={alert}>{psyError(options.error)}</p>}

      {mode && mode.kind !== "presence" && options.data ? (
        <Panel title={mode.kind === "new" ? "Novo grupo ou oficina" : "Editar grupo"}>
          <GroupForm key={mode.kind === "edit" ? mode.group.id : "new"} unit={unit} options={options.data} initial={mode.kind === "edit" ? mode.group : undefined}
            today={today} onSaved={() => finish(GROUP_SAVED)} onCancel={() => setMode(null)} />
        </Panel>
      ) : (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => open({ kind: "new" })}>Novo grupo ou oficina</button>
        </div>
      )}

      {groups.isPending ? <p className="mono" style={muted}>carregando…</p>
        : groups.isError ? <p role="alert" style={alert}>{psyError(groups.error)}</p>
        : list.length === 0 ? <p style={muted}>{NO_GROUPS}</p>
        : days.map((day) => (
          <Panel key={day} title={capitalize(weekdayLabel(day))}>
            <DataTable<PsyGroup> cols={cols} rows={list.filter((g) => g.weekday === day)} rowKey={(g) => g.id} />
          </Panel>
        ))}
    </div>
  );
}
