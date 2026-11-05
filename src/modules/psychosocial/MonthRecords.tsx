// RAAS do mês de um CAPS (módulo 31, F-31.6; P14, P24, P42, P57, P58): situação, contadores e a lista dos registros, só com
// `<patient-ref>`, contagem de ações e os códigos de pendência (bloqueiam o fechamento) e de aviso (não bloqueiam; `no_actions`,
// `phone_missing` de quem está em situação de rua, ou outro código que o api rebaixe — todos por `monthWarningLabel`). Nada clínico:
// a linha é montada campo a campo e o que o api mandar além disso fica fora. Situação de rua por registro, só com o mês e o registro
// abertos (409 `record_not_open` relê). A coordenação fecha e reabre com step-up (`SensitiveAction`): `month_has_problems` relê o mês
// e põe cada pendência da recusa na linha do registro (`records.<uuid>`); reabrir pede o motivo (10–500) antes do código. A ficha de
// cada registro (PRÉVIA com o mês aberto) é da coordenação.
import { useEffect, useRef, useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { closePsyMonth, errorCode, reopenPsyMonth, setPsyHomeless, type PsyMonth, type PsyMonthRecord, type PsyUnit } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { fmtDay } from "../../lib/careLines";
import { monthLabel } from "../../lib/regulation";
import {
  CLOSE_MONTH_NOTE, HOMELESS_LABEL, MONTH_CLOSED_DONE, MONTH_REOPENED, NO_CLINICAL_IN_LIST, NO_MONTH_PROBLEMS, NO_MONTH_RECORDS, PSY_ERRORS,
  REOPEN_MONTH_NOTE, closeBlockedHint, homelessValue, isStale, monthCountsText, monthProblemLabel, monthRefusalsByRecord, monthStatusLabel,
  monthWarningLabel, psyError, reasonProblem, type PsyRoles
} from "../../lib/psychosocial";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, form, muted, okText, row, stack } from "../exams/styles";
import { openSheets } from "./openSheets";
import { useFormProblems } from "./useFormProblems";

type Notice = { text: string; ok: boolean };
const without = <T,>(o: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in o)) return o;
  const out = { ...o };
  delete out[key];
  return out;
};
// Recusas que dizem que a tela estava velha: relê o mês.
const STALE_CODES = [ "already_closed", "month_open", "already_exported", "record_not_open" ];

export function MonthRecords({ unit, month, query, roles, onGoToSecurity, reloadMonth, reloadAll }: {
  unit: PsyUnit; month: string; query: UseQueryResult<PsyMonth>; roles: PsyRoles; onGoToSecurity?: () => void;
  reloadMonth(): Promise<void>; reloadAll(): Promise<void>;
}) {
  const [ open, setOpen ] = useState<"close" | "reopen" | null>(null);
  const [ notice, setNotice ] = useState<Notice | null>(null);
  const [ onlyProblems, setOnlyProblems ] = useState(false);
  // A lista da recusa do fechamento, por registro (some da linha quando a situação de rua dela muda).
  const [ refused, setRefused ] = useState<Record<string, string[]>>({});
  // A escolha de situação de rua enquanto o api não devolve o mês relido.
  const [ chosen, setChosen ] = useState<Record<string, "yes" | "no">>({});
  const [ savingId, setSavingId ] = useState<string | null>(null);
  const [ rowError, setRowError ] = useState<{ id: string; text: string } | null>(null);
  const sending = useRef(false);
  const alive = useRef(true);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);

  const m = query.data;
  const status = m?.status ?? null;
  // A situação mudou (fechado, reaberto, exportado): a confirmação aberta não vale mais.
  useEffect(() => { setOpen(null); setRefused({}); }, [ status ]);

  if (query.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (query.isError && !m) return <p role="alert" style={alert}>{psyError(query.error)}</p>;
  if (!m) return null;

  const label = monthLabel(month);
  const isOpen = m.status === "open";
  const problemsOf = (r: PsyMonthRecord): string[] => [ ...new Set([ ...r.problems, ...(refused[r.id] ?? []) ]) ];
  const pending = m.records.reduce((n, r) => n + problemsOf(r).length, 0);
  const known = new Set(m.records.map((r) => r.id));
  // Pendência da recusa de um registro que a releitura ainda não trouxe: fica no topo.
  const orphan = [ ...new Set(Object.entries(refused).filter(([ id ]) => !known.has(id)).flatMap(([ , codes ]) => codes)) ];
  const rows = onlyProblems ? m.records.filter((r) => problemsOf(r).length > 0) : m.records;

  const start = (o: "close" | "reopen") => { setNotice(null); setOpen(o); };
  const finish = (text: string) => { setOpen(null); setNotice({ text, ok: true }); void reloadAll(); };

  async function changeHomeless(r: PsyMonthRecord, value: string) {
    if (value !== "yes" && value !== "no") return;
    if (sending.current) return;
    sending.current = true;
    setSavingId(r.id);
    setRowError(null);
    setChosen((c) => ({ ...c, [r.id]: value }));
    try {
      await setPsyHomeless(r.id, value === "yes");
      if (!alive.current) return;
      setRefused((x) => without(x, r.id));
      await reloadMonth();
    } catch (err) {
      if (!alive.current) return;
      setRowError({ id: r.id, text: psyError(err) });
      if (isStale(err) || STALE_CODES.includes(errorCode(err) ?? "")) void reloadMonth();
    } finally {
      sending.current = false;
      if (alive.current) {
        setSavingId(null);
        setChosen((c) => without(c, r.id));
      }
    }
  }

  async function sheet(r: PsyMonthRecord) {
    setNotice(null);
    const res = await openSheets(month, { unitId: unit.id, enrollmentId: r.enrollment_id });
    if (!res.ok && alive.current) setNotice({ text: res.text, ok: false });
  }

  const homelessCell = (r: PsyMonthRecord) => {
    const value: "" | "yes" | "no" = r.id in chosen ? chosen[r.id] : homelessValue(r.homeless);
    const editable = roles.staff && isOpen && r.status === "open";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {editable ? (
          <select value={value} style={inputStyle} disabled={savingId !== null} aria-label={`Situação de rua em ${label} — ${r.patient.name}`}
            aria-invalid={rowError?.id === r.id ? true : undefined} onChange={(ev) => { void changeHomeless(r, ev.target.value); }}>
            <option value="" disabled={value !== ""}>{HOMELESS_LABEL[""]}</option>
            <option value="yes">{HOMELESS_LABEL.yes}</option>
            <option value="no">{HOMELESS_LABEL.no}</option>
          </select>
        ) : <span>{HOMELESS_LABEL[homelessValue(r.homeless)]}</span>}
        {rowError?.id === r.id && <p role="alert" style={alert}>{rowError.text}</p>}
      </div>
    );
  };

  const cols: Column<PsyMonthRecord>[] = [
    { label: "Usuário", w: "2fr", card: "title", render: (r) => r.patient.name },
    { label: "CNS", w: "1.4fr", render: (r) => <span className="mono">{r.patient.cns_masked ?? "—"}</span> },
    { label: "Situação de rua", w: "1.2fr", card: "pair", render: homelessCell },
    { label: "Ações", w: "0.6fr", render: (r) => String(r.actions_count) },
    { label: "Pendências", w: "2fr", render: (r) => {
      const codes = problemsOf(r);
      return codes.length === 0 ? "—" : <div style={row}>{codes.map((c) => <Tag key={c} tone="down">{monthProblemLabel(c)}</Tag>)}</div>;
    } },
    { label: "Avisos", w: "2fr", render: (r) => (r.warnings.length === 0 ? "—"
      : <div style={row}>{r.warnings.map((c) => <Tag key={c} tone="warn">{monthWarningLabel(c)}</Tag>)}</div>) }
  ];
  if (roles.lead) {
    cols.push({ label: "", w: "auto", align: "right", card: "actions", render: (r) => (r.warnings.includes("no_actions") ? null : (
      <button type="button" style={secondaryButtonStyle} aria-label={`Ficha de ${r.patient.name}`} onClick={() => { void sheet(r); }}>Ficha (PDF)</button>
    )) });
  }

  return (
    <Panel title={`RAAS de ${label}`} sub={monthCountsText(m.counts)}>
      <div style={stack}>
        {notice && <p ref={noticeRef} tabIndex={-1} role={notice.ok ? "status" : "alert"} style={notice.ok ? okText : alert}>{notice.text}</p>}
        <div style={row}>
          <Tag tone={m.status === "open" ? "info" : m.status === "exported" ? "ok" : "neutral"}>{monthStatusLabel(m.status)}</Tag>
          {m.closure && <span style={muted}>{`fechado em ${fmtDay(todayInCity(new Date(m.closure.closed_at)))} por ${m.closure.closed_by.name}`}</span>}
        </div>
        {roles.lead && isOpen && (
          <div style={row}>
            <button type="button" disabled={pending > 0 || open !== null} style={pending > 0 || open !== null ? disabledButtonStyle : buttonStyle}
              onClick={() => start("close")}>Fechar o mês</button>
            {pending > 0 && <span style={muted}>{closeBlockedHint(pending)}</span>}
          </div>
        )}
        {roles.lead && m.status === "closed" && (
          <div style={row}>
            <button type="button" disabled={open !== null} style={open !== null ? disabledButtonStyle : secondaryButtonStyle}
              onClick={() => start("reopen")}>Reabrir o mês</button>
          </div>
        )}
        {open === "close" && isOpen && (
          <SensitiveAction
            key="close"
            title={`Fechar ${label}`}
            description={CLOSE_MONTH_NOTE}
            requiresStepUp
            run={async () => {
              try {
                await closePsyMonth(month, unit.id);
              } catch (err) {
                const code = errorCode(err) ?? "";
                if (code === "month_has_problems") { setRefused(monthRefusalsByRecord(err)); void reloadMonth(); }
                else if (isStale(err) || STALE_CODES.includes(code)) void reloadAll();
                throw err;
              }
            }}
            onDone={() => { setRefused({}); finish(MONTH_CLOSED_DONE); }}
            onCancel={() => setOpen(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) === "month_has_problems" ? PSY_ERRORS.month_has_problems : psyError(err))}
          />
        )}
        {open === "reopen" && m.status === "closed" && (
          <ReopenMonth unit={unit} month={month} onGoToSecurity={onGoToSecurity} onDone={() => finish(MONTH_REOPENED)}
            onStale={() => { void reloadAll(); }} onCancel={() => setOpen(null)} />
        )}
        {orphan.length > 0 && <div style={row}>{orphan.map((c) => <Tag key={c} tone="down">{monthProblemLabel(c)}</Tag>)}</div>}
        <p style={muted}>{NO_CLINICAL_IN_LIST}</p>
        <label style={checkLabel}>
          <input type="checkbox" checked={onlyProblems} onChange={(ev) => setOnlyProblems(ev.target.checked)} />
          Só com pendência
        </label>
        <DataTable<PsyMonthRecord> cols={cols} rows={rows} rowKey={(r) => r.id} empty={onlyProblems ? NO_MONTH_PROBLEMS : NO_MONTH_RECORDS} />
      </div>
    </Panel>
  );
}

// Reabrir: o motivo (10–500) é conferido antes do código; depois, a confirmação com step-up. `already_exported` e `month_open` (409)
// vêm com a frase e releem o mês.
function ReopenMonth({ unit, month, onGoToSecurity, onDone, onStale, onCancel }: {
  unit: PsyUnit; month: string; onGoToSecurity?: () => void; onDone(): void; onStale(): void; onCancel(): void;
}) {
  const f = useFormProblems();
  const [ reason, setReason ] = useState("");
  const [ confirming, setConfirming ] = useState<string | null>(null);
  const label = monthLabel(month);

  if (confirming !== null) {
    return (
      <SensitiveAction
        title={`Reabrir ${label}`}
        description={`${REOPEN_MONTH_NOTE} Motivo: ${confirming}`}
        requiresStepUp
        run={async () => {
          try {
            await reopenPsyMonth(month, unit.id, confirming);
          } catch (err) {
            if (isStale(err) || STALE_CODES.includes(errorCode(err) ?? "")) onStale();
            throw err;
          }
        }}
        onDone={onDone}
        onCancel={() => setConfirming(null)}
        onGoToSecurity={onGoToSecurity}
        translateError={psyError}
      />
    );
  }

  return (
    <form ref={f.formRef} aria-label={`Reabrir ${label}`} style={{ ...form, ...box }} noValidate onSubmit={(ev) => {
      ev.preventDefault();
      const problem = reasonProblem(reason);
      if (problem) { f.show([ { path: "reason", text: problem } ]); return; }
      setConfirming(reason.trim());
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{`Reabrir ${label}`}</p>
      <p style={muted}>{REOPEN_MONTH_NOTE}</p>
      <label style={fieldLabel}>
        Motivo da reabertura
        <textarea rows={3} value={reason} style={inputStyle} {...f.aria("reason")}
          onChange={(ev) => { f.clear("reason"); setReason(ev.target.value); }} />
      </label>
      {f.errNode("reason")}
      <div style={row}>
        <button type="submit" style={buttonStyle}>Revisar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
