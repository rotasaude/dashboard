// Módulo 31 — F-31.2/F-31.3: "Usuários do CAPS". A lista (`GET /psychosocial/enrollments`, todas as páginas, R13) nunca traz dado
// clínico: nome, CNS mascarado, início, técnico, próximo atendimento e a situação do PTS, lidos campo a campo (o objeto da resposta
// nunca é espalhado). O filtro por nome é local (P5: nada de `q=` na URL). O detalhe só é lido no clique, com `NOMINAL_QUERY` e o id do
// CAPS na chave; o api grava a trilha. "PTS a revisar" lê `GET /psychosocial/care_plans/due` (a coordenação vê o CAPS inteiro; os
// demais, só onde são referência). "PTS vencido" é calculado na tela (R4).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getPsyOptions, listPsyCarePlansDue, listPsyEnrollments, type PsyCarePlanDue, type PsyEnrollmentRow, type PsyEnrollmentStatus, type PsyUnit
} from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import {
  CARE_PLAN_OVERDUE_TAG, DUE_LEAD_NOTE, DUE_STAFF_NOTE, NOMINAL_QUERY, NO_CARE_PLAN, NO_CLINICAL_IN_LIST, NO_CLOSED_ENROLLMENTS, NO_NAME_MATCH,
  NO_OPEN_ENROLLMENTS, PSY_DETAIL_KEY, PSY_ENROLLMENTS_KEY, PSY_OPTIONS_KEY, STATIC_QUERY, TRAIL_NOTE, carePlanOverdue, dueText, foldName, psyError,
  type PsyRoles
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

// `initialEnrollmentId`: a matrícula aberta no acolhimento (Task 5).
export type CapsEnrollmentsProps = { today?: string; now?: Date; onGoToSecurity?: () => void; initialEnrollmentId?: string | null };

export function CapsEnrollments({ initialEnrollmentId = null, ...props }: CapsEnrollmentsProps) {
  // A matrícula vinda do acolhimento abre uma vez só. O ref fica fora do portão: trocar de CAPS remonta o corpo e não reabre nada.
  const pending = useRef<string | null>(initialEnrollmentId);
  const takeInitial = () => {
    const id = pending.current;
    pending.current = null;
    return id;
  };
  return (
    <PsychosocialGate title="Usuários do CAPS" sub="Matrícula, PTS, ações, receitas e encerramento" allow={(r) => r.staff}>
      {({ unit, roles }) => (unit ? <Enrollments unit={unit} roles={roles} takeInitial={takeInitial} {...props} /> : null)}
    </PsychosocialGate>
  );
}

const STATUS_TABS: { key: PsyEnrollmentStatus; label: string }[] = [ { key: "open", label: "Em acompanhamento" }, { key: "closed", label: "Encerradas" } ];

function Enrollments({ unit, roles, takeInitial, today = todayInCity(), now = new Date(), onGoToSecurity }: Omit<CapsEnrollmentsProps, "initialEnrollmentId"> & {
  unit: PsyUnit; roles: PsyRoles; takeInitial(): string | null;
}) {
  const queryClient = useQueryClient();
  const [ status, setStatus ] = useState<PsyEnrollmentStatus>("open");
  const [ filter, setFilter ] = useState("");
  const [ openId, setOpenId ] = useState<string | null>(takeInitial);
  const [ notice, setNotice ] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);

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
  const open = (id: string) => { setNotice(null); closeDetail(); setOpenId(id); };
  const stale = (text: string) => { closeDetail(); setNotice(text); reload(); };

  const nameOf = (r: { patient: { name: string } }) => r.patient.name;
  const openButton = (id: string, name: string) => (
    <button type="button" style={secondaryButtonStyle} aria-label={`Abrir ${name}`} onClick={() => open(id)}>Abrir</button>
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
        : r.care_plan_review_on ? `revisão em ${fmtDay(r.care_plan_review_on)}` : <Tag tone="neutral">{NO_CARE_PLAN}</Tag>
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
          onClose={closeDetail} onChanged={reload} onStale={stale} onGoToSecurity={onGoToSecurity} />
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
            <DataTable<PsyEnrollmentRow> cols={cols} rows={rows} rowKey={(r) => r.id} empty={emptyText} />
          )}
        </div>
      </Panel>
    </div>
  );
}
