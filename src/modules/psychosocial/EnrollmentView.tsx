// Detalhe da matrícula no CAPS (F-31.2, F-31.3): lido só depois do clique (`GET /psychosocial/enrollments/:id`, o api grava a trilha),
// com `NOMINAL_QUERY` e o id do CAPS na chave; ao desmontar, a chave sai do cache. Abas "Matrícula" (dados, edição e encerramento),
// "PTS" (versões; o GET grava a trilha `care_plans` e só corre ao abrir a aba), "Ações" (Task 7) e "Linha do tempo" (Task 14).
// O CID vem sem ponto e aparece com ponto (R5); destino, origem e substância pelos rótulos de `options` (código novo aparece cru).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPsyEnrollment, type PsyEnrollment, type PsyOptions, type PsyUnit } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtDateTime } from "../../lib/format";
import {
  CARE_PLAN_OVERDUE_TAG, ENROLLMENT_CLOSED, ENROLLMENT_OTHER_CAPS, ENROLLMENT_UPDATED, NOMINAL_QUERY, NO_CARE_PLAN, NO_CARE_PLAN_DUE, PSY_DETAIL_KEY,
  carePlanOverdue, cidLabel, codeLabel, destinationLabel, firstCarePlanLate, isStale, psyError, reviewDaysOf, type PsyRoles
} from "../../lib/psychosocial";
import { KeyValue } from "../../components/KeyValue";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { SegmentedControl } from "../../shell/SegmentedControl";
import { alert, grid, muted, okText, row } from "../exams/styles";
import { CarePlans } from "./CarePlans";
import { CloseEnrollment } from "./CloseEnrollment";
import { EnrollmentEdit } from "./EnrollmentEdit";

type Tab = "record" | "plan" | "actions" | "timeline";
const TABS: { key: Tab; label: string }[] = [
  { key: "record", label: "Matrícula" }, { key: "plan", label: "PTS" }, { key: "actions", label: "Ações" }, { key: "timeline", label: "Linha do tempo" }
];

// `roles`, `now` e `onGoToSecurity` servem às abas de ações e documentos (Tasks 7 e 8).
export type EnrollmentViewProps = {
  enrollmentId: string; unit: PsyUnit; options: PsyOptions; roles: PsyRoles; today: string; now: Date; onClose(): void;
  onChanged?(): void; onStale?(text: string): void; onGoToSecurity?(): void;
};

export function EnrollmentView({ enrollmentId, unit, options, today, onClose, onChanged, onStale }: EnrollmentViewProps) {
  const queryClient = useQueryClient();
  const key = [ PSY_DETAIL_KEY, unit.id, "enrollment", enrollmentId ];
  const detail = useQuery({ queryKey: key, queryFn: () => getPsyEnrollment(enrollmentId), ...NOMINAL_QUERY });
  const [ tab, setTab ] = useState<Tab>("record");
  const [ mode, setMode ] = useState<"view" | "edit" | "close">("view");
  const [ done, setDone ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const focused = useRef(false);
  const e = detail.data;

  useEffect(() => {
    if (!e || focused.current) return;
    focused.current = true;
    heading.current?.focus();
  }, [ e ]);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  useEffect(() => {
    if (detail.isError && isStale(detail.error) && onStale) onStale(psyError(detail.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ detail.isError, detail.error ]);
  // Nada nominal fica no cache: quem abre apaga `[PSY_DETAIL_KEY, <caps>]` ao fechar ou abrir outra matrícula, o portão apaga na troca
  // de CAPS, e `gcTime: 0` tira o resto ao desmontar. (Um `removeQueries` na limpeza deste efeito releria o detalhe — e gravaria a
  // trilha de novo — no remonte do StrictMode.)

  const update = (next: PsyEnrollment) => queryClient.setQueryData(key, next);
  const saved = (next: PsyEnrollment, text: string) => { update(next); setMode("view"); setNotice(null); setDone(text); onChanged?.(); };
  // A tela estava velha (encerrada por outra pessoa): a frase, e relê o detalhe e a lista.
  const refresh = (text: string) => { setMode("view"); setDone(null); setNotice(text); void detail.refetch(); onChanged?.(); };
  const begin = (m: "edit" | "close") => { setDone(null); setNotice(null); setMode(m); };

  const otherCaps = e && e.health_unit_id !== unit.id;
  const open = e?.status === "open";

  return (
    <Panel title="Matrícula no CAPS">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={row}>
          {e && <h3 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 14, fontWeight: 600, flex: 1 }}>{e.patient.name}</h3>}
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
        </div>
        {detail.isPending && <p className="mono" style={muted}>carregando…</p>}
        {detail.isError && !e && <p role="alert" style={alert}>{psyError(detail.error)}</p>}
        {notice && <p ref={noticeRef} tabIndex={-1} role="alert" style={alert}>{notice}</p>}
        {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
        {otherCaps && <p role="alert" style={alert}>{ENROLLMENT_OTHER_CAPS}</p>}

        {e && !otherCaps && (
          <>
            <SegmentedControl<Tab> options={TABS} value={tab} onChange={(t) => { setTab(t); setDone(null); }} />
            {tab === "record" && mode === "view" && (
              <>
                <Record e={e} options={options} today={today} />
                {open && (
                  <div style={row}>
                    <button type="button" style={buttonStyle} onClick={() => begin("edit")}>Editar matrícula</button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => begin("close")}>Encerrar matrícula</button>
                  </div>
                )}
              </>
            )}
            {tab === "record" && mode === "edit" && (
              <EnrollmentEdit enrollment={e} unit={unit} options={options} today={today} onSaved={(n) => saved(n, ENROLLMENT_UPDATED)}
                onCancel={() => setMode("view")} onStale={refresh} />
            )}
            {tab === "record" && mode === "close" && (
              <CloseEnrollment enrollment={e} options={options} today={today} onClosed={(n) => saved(n, ENROLLMENT_CLOSED)}
                onCancel={() => setMode("view")} onStale={refresh} />
            )}
            {tab === "plan" && (
              <CarePlans enrollment={e} unit={unit} options={options} today={today} onStale={refresh}
                onSaved={(plan) => { update({ ...e, care_plan_review_on: plan.review_on }); onChanged?.(); }} />
            )}
            {/* "Ações" (Task 7) e "Linha do tempo" (Task 14) encaixam aqui. */}
          </>
        )}
      </div>
    </Panel>
  );
}

function Record({ e, options, today }: { e: PsyEnrollment; options: PsyOptions; today: string }) {
  const destination = e.destination ? options.destinations.find((d) => d.code === e.destination)?.label ?? destinationLabel(e.destination) : "—";
  const overdue = e.status === "open" && carePlanOverdue(e.care_plan_review_on, today);
  return (
    <div style={grid}>
      <KeyValue k="Situação" v={e.status === "open" ? "em acompanhamento" : e.status === "closed" ? "encerrada" : e.status} mono={false} />
      <KeyValue k="Início" v={fmtDay(e.started_on)} />
      <KeyValue k="Origem" v={codeLabel(options.origins, e.origin)} mono={false} />
      <KeyValue k="CID principal" v={e.cid_main ? cidLabel(e.cid_main) : "—"} />
      <KeyValue k="CIDs secundários" v={e.cid_secondary.length > 0 ? e.cid_secondary.map(cidLabel).join(", ") : "nenhum"} />
      <KeyValue k="Substâncias" v={e.substances.length > 0 ? e.substances.map((c) => codeLabel(options.substances, c)).join(", ") : "—"} mono={false} />
      <KeyValue k="ESF" v={e.esf_covered ? `coberto · CNES da USF ${e.esf_cnes ?? "—"}` : "sem cobertura"} mono={false} />
      <KeyValue k="Técnico de referência" v={e.reference.name} mono={false} />
      <KeyValue k="Próximo atendimento" v={fmtDateTime(e.next_visit_at)} />
      <KeyValue k="Revisão do PTS" v={!e.care_plan_review_on
        ? (e.status === "open" && firstCarePlanLate(e.started_on, today, reviewDaysOf(options)) ? NO_CARE_PLAN_DUE : NO_CARE_PLAN)
        : overdue ? <span style={row}>{fmtDay(e.care_plan_review_on)}<Tag tone="warn">{CARE_PLAN_OVERDUE_TAG}</Tag></span> : fmtDay(e.care_plan_review_on)} />
      {e.status !== "open" && <KeyValue k="Destino" v={destination} mono={false} />}
      {e.status !== "open" && <KeyValue k="Conclusão" v={fmtDay(e.closed_on)} />}
    </div>
  );
}
