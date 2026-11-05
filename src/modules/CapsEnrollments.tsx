// Módulo 31 — F-31.2/F-31.3: "Usuários do CAPS". A lista (`GET /psychosocial/enrollments`, todas as páginas, R13) nunca traz dado
// clínico: nome, CNS mascarado, início, técnico, próximo atendimento e a situação do PTS, lidos campo a campo (o objeto da resposta
// nunca é espalhado). O filtro por nome é local (P5: nada de `q=` na URL). O detalhe só é lido no clique, com `NOMINAL_QUERY` e o id do
// CAPS na chave; o api grava a trilha. "PTS a revisar" lê `GET /psychosocial/care_plans/due` (a coordenação vê o CAPS inteiro; os
// demais, só onde são referência). "PTS vencido" é calculado na tela (R4).
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPsyOptions, listPsyCarePlansDue, listPsyEnrollments, type PsyCarePlanDue, type PsyEnrollmentRow, type PsyEnrollmentStatus, type PsyUnit
} from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import {
  CARE_PLAN_OVERDUE_TAG, DUE_LEAD_NOTE, DUE_STAFF_NOTE, ENROLLMENT_OTHER_CAPS, NOMINAL_QUERY, NO_CARE_PLAN, NO_CARE_PLAN_DUE, NO_CLINICAL_IN_LIST,
  NO_CLOSED_ENROLLMENTS, NO_NAME_MATCH, NO_OPEN_ENROLLMENTS, PSY_DETAIL_KEY, PSY_ENROLLMENTS_KEY, PSY_OPTIONS_KEY, STATIC_QUERY, TRAIL_NOTE, carePlanOverdue,
  dueText, firstCarePlanLate, foldName, psyError, reviewDaysOf, type PsyEnrollmentHandoff, type PsyRoles
} from "../lib/psychosocial";
import { fmtDay } from "../lib/careLines";
import { DataTable, type Column } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { SegmentedControl } from "../shell/SegmentedControl";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";
import { EnrollmentView } from "./psychosocial/EnrollmentView";

// `initialEnrollment`: a matrícula aberta no acolhimento (Task 5), com o CAPS dela.
export type CapsEnrollmentsProps = { today?: string; now?: Date; onGoToSecurity?: () => void; initialEnrollment?: PsyEnrollmentHandoff | null };

export function CapsEnrollments({ initialEnrollment = null, ...props }: CapsEnrollmentsProps) {
  // A matrícula vinda do acolhimento abre uma vez só. O ref fica fora do portão (que abre direto no CAPS dela): o corpo o lê num
  // inicializador puro e o zera num efeito, então trocar de CAPS remonta o corpo e não reabre nada (nem sob o StrictMode).
  const initial = useRef<PsyEnrollmentHandoff | null>(initialEnrollment);
  return (
    <PsychosocialGate title="Usuários do CAPS" sub="Matrícula, PTS, ações, receitas e encerramento" allow={(r) => r.staff}
      initialUnitId={initialEnrollment?.unitId ?? null}>
      {({ unit, roles }) => (unit ? <Enrollments unit={unit} roles={roles} initial={initial} {...props} /> : null)}
    </PsychosocialGate>
  );
}

const STATUS_TABS: { key: PsyEnrollmentStatus; label: string }[] = [ { key: "open", label: "Em acompanhamento" }, { key: "closed", label: "Encerradas" } ];

function Enrollments({ unit, roles, initial, today = todayInCity(), now, onGoToSecurity }: Omit<CapsEnrollmentsProps, "initialEnrollment"> & {
  unit: PsyUnit; roles: PsyRoles; initial: MutableRefObject<PsyEnrollmentHandoff | null>;
}) {
  const queryClient = useQueryClient();
  const [ status, setStatus ] = useState<PsyEnrollmentStatus>("open");
  const [ filter, setFilter ] = useState("");
  // Matrícula de um CAPS que não é do usuário: a frase, e nada é lido (sem trilha).
  const [ openId, setOpenId ] = useState<string | null>(() => (initial.current?.unitId === unit.id ? initial.current.enrollmentId : null));
  const [ notice, setNotice ] = useState<string | null>(() => (initial.current && initial.current.unitId !== unit.id ? ENROLLMENT_OTHER_CAPS : null));
  useEffect(() => { initial.current = null; }, [ initial ]);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  // "Fechar" devolve o foco ao "Abrir" de origem; sem ele (o handoff, ou a linha sumiu), à lista.
  const opener = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [ refocus, setRefocus ] = useState(0);
  useEffect(() => {
    if (refocus === 0) return;
    const el = opener.current;
    (el && el.isConnected ? el : listRef.current)?.focus();
  }, [ refocus ]);

  const list = useQuery({
    queryKey: [ PSY_ENROLLMENTS_KEY, unit.id, status ], queryFn: () => listPsyEnrollments({ unitId: unit.id, status }), ...NOMINAL_QUERY
  });
  const due = useQuery({ queryKey: [ PSY_ENROLLMENTS_KEY, unit.id, "due" ], queryFn: () => listPsyCarePlansDue(unit.id), ...NOMINAL_QUERY });
  const options = useQuery({ queryKey: [ PSY_OPTIONS_KEY, unit.id ], queryFn: () => getPsyOptions(unit.id), ...STATIC_QUERY });
  const reload = () => { void queryClient.resetQueries({ queryKey: [ PSY_ENROLLMENTS_KEY, unit.id ] }); };

  const closeDetail = () => {
    setOpenId(null);
    queryClient.removeQueries({ queryKey: [ PSY_DETAIL_KEY, unit.id ] });
  };
  const open = (id: string, from: HTMLElement | null) => { setNotice(null); closeDetail(); opener.current = from; setOpenId(id); };
  const close = () => { closeDetail(); setRefocus((n) => n + 1); };
  const stale = (text: string) => { closeDetail(); setNotice(text); reload(); };

  const reviewDays = reviewDaysOf(options.data);
  const nameOf = (r: { patient: { name: string } }) => r.patient.name;
  const openButton = (id: string, name: string) => (
    <button type="button" style={secondaryButtonStyle} aria-label={`Abrir ${name}`} onClick={(e) => open(id, e.currentTarget)}>Abrir</button>
  );
  // Só campos da linha, um a um; nada clínico (CID, substância, evolução, PTS) mesmo que o api mande por engano.
  const cols: Column<PsyEnrollmentRow>[] = [
    { label: "Usuário", w: "1.4fr", card: "title", render: nameOf },
    { label: "CNS", w: "1fr", render: (r) => r.patient.cns_masked ?? "—" },
    { label: "Início", w: "auto", render: (r) => fmtDay(r.started_on) },
    { label: "Técnico de referência", w: "1fr", render: (r) => r.reference.name },
    { label: "Próximo atendimento", w: "1fr", render: (r) => fmtDateTime(r.next_visit_at) },
    {
      label: "PTS", w: "auto", render: (r) => r.status !== "open" ? "—"
        : carePlanOverdue(r.care_plan_review_on, today) ? <Tag tone="warn">{CARE_PLAN_OVERDUE_TAG}</Tag>
        : r.care_plan_review_on ? `revisão em ${fmtDay(r.care_plan_review_on)}`
        : firstCarePlanLate(r.started_on, today, reviewDays) ? <Tag tone="warn">{NO_CARE_PLAN_DUE}</Tag> : <Tag tone="neutral">{NO_CARE_PLAN}</Tag>
    },
    { label: "Ações", w: "auto", card: "actions", render: (r) => openButton(r.id, nameOf(r)) }
  ];
  const dueCols: Column<PsyCarePlanDue>[] = [
    { label: "Usuário", w: "1.4fr", card: "title", render: nameOf },
    { label: "Situação", w: "1fr", render: (r) => dueText(r.review_on) },
    { label: "Ações", w: "auto", card: "actions", render: (r) => openButton(r.enrollment_id, nameOf(r)) }
  ];

  const term = foldName(filter);
  const rows = (list.data ?? [])
    .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i)
    .filter((r) => term === "" || foldName(r.patient.name).includes(term));
  const emptyText = list.isPending ? "carregando…" : term !== "" ? NO_NAME_MATCH : status === "open" ? NO_OPEN_ENROLLMENTS : NO_CLOSED_ENROLLMENTS;
  const dueRows = due.data ?? [];

  return (
    <div style={stack}>
      {notice && <p ref={noticeRef} tabIndex={-1} role="alert" style={alert}>{notice}</p>}
      {options.isError && <p role="alert" style={alert}>{psyError(options.error)}</p>}

      {openId && options.data && (
        <EnrollmentView key={openId} enrollmentId={openId} unit={unit} options={options.data} roles={roles} today={today} now={now}
          onClose={close} onChanged={reload} onStale={stale} onGoToSecurity={onGoToSecurity} />
      )}
      {openId && options.isPending && <p className="mono" style={muted}>carregando…</p>}

      {(dueRows.length > 0 || due.isError) && (
        <Panel title="PTS a revisar">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={muted}>{roles.lead ? DUE_LEAD_NOTE : DUE_STAFF_NOTE}</p>
            {due.isError ? <p role="alert" style={alert}>{psyError(due.error)}</p>
              : <DataTable<PsyCarePlanDue> cols={dueCols} rows={dueRows} rowKey={(r) => r.enrollment_id} />}
          </div>
        </Panel>
      )}

      <Panel title="Usuários">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={row}>
            <SegmentedControl<PsyEnrollmentStatus> options={STATUS_TABS} value={status} onChange={setStatus} />
            <label style={fieldLabel}>
              Filtrar por nome
              <input type="search" value={filter} style={inputStyle} autoComplete="off" onChange={(e) => setFilter(e.target.value)} />
            </label>
          </div>
          <p style={muted}>{NO_CLINICAL_IN_LIST}</p>
          <p style={muted}>{TRAIL_NOTE}</p>
          {list.isError ? <p role="alert" style={alert}>{psyError(list.error)}</p> : (
            <div ref={listRef} tabIndex={-1} role="region" aria-label="Lista de usuários do CAPS">
              <DataTable<PsyEnrollmentRow> cols={cols} rows={rows} rowKey={(r) => r.id} empty={emptyText} />
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
