import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, dismissRequest, listUnitRequests, scheduleRequest,
  type HealthUnit, type RequestRow
} from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

// Requests (Task 8) — pedidos de agendamento abertos da unidade (spec §6
// "Pedidos de agendamento"). "Marcar horário" avisa, calculado no navegador
// a partir do valor do <input type="datetime-local">, se o horário nasce
// confirmado (< 48h) ou o prazo de confirmação (horário - 24h, com >= 48h).
// `request_not_open` em qualquer uma das duas ações (outro atendente já
// marcou/encerrou o pedido) recarrega a lista em vez de mostrar erro parado.
interface Props {
  unit: HealthUnit;
}

// hh:mm/dd, sem hora com segundos e sem ano — "dd/mm hh:mm" (spec §6).
const shortDateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
});
function fmtShort(d: Date): string {
  const parts = shortDateTimeFmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

function kindLabel(row: RequestRow): string {
  return row.kind === "return" ? "Retorno" : `Encaminhado de ${row.origin_unit_name}`;
}

function reopenedLabel(reason: RequestRow["reopened_reason"]): string {
  if (reason === "expired") return "sem confirmação";
  if (reason === "no_show") return "faltou";
  return "novo";
}

function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
}

export function Requests({ unit }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ "unitRequests", unit.id ], queryFn: () => listUnitRequests(unit.id) });
  const [ scheduling, setScheduling ] = useState<RequestRow | null>(null);
  const [ dismissing, setDismissing ] = useState<RequestRow | null>(null);

  function invalidateRequests() {
    void queryClient.invalidateQueries({ queryKey: [ "unitRequests", unit.id ] });
  }
  function invalidateAll() {
    invalidateRequests();
    void queryClient.invalidateQueries({ queryKey: [ "unitAgenda", unit.id ] });
  }

  const rows = query.data ?? [];

  return (
    <Panel title="Pedidos de agendamento">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {query.isError && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>
        )}

        {!query.isError && (
          query.isPending ? (
            <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
          ) : rows.length === 0 ? (
            <EmptyState title="nenhum pedido aberto" />
          ) : (
            <DataTable<RequestRow>
              cols={[
                { label: "Tipo", w: "1.5fr", render: (r) => kindLabel(r) },
                { label: "Data", w: "1fr", render: (r) => fmtDateTime(r.created_at) },
                { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
                { label: "Prioridade", w: "1fr", render: (r) => String(r.priority ?? "—") },
                { label: "Nota", w: "2fr", render: (r) => r.note ?? "—" },
                { label: "Marca", w: "1fr", render: (r) => <Tag>{reopenedLabel(r.reopened_reason)}</Tag> },
                {
                  label: "", w: "auto", align: "right", render: (r) => (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" style={secondaryButtonStyle} onClick={() => setScheduling(r)}>
                        Marcar horário
                      </button>
                      <button type="button" style={secondaryButtonStyle} onClick={() => setDismissing(r)}>
                        Encerrar pedido
                      </button>
                    </div>
                  )
                }
              ]}
              rows={rows}
              rowKey={(r) => r.id}
            />
          )
        )}

        {scheduling && (
          <SchedulePanel
            key={`s-${scheduling.id}`}
            row={scheduling}
            unit={unit}
            onCancel={() => setScheduling(null)}
            onDone={() => { setScheduling(null); invalidateAll(); }}
          />
        )}

        {dismissing && (
          <DismissPanel
            key={`d-${dismissing.id}`}
            row={dismissing}
            unit={unit}
            onCancel={() => setDismissing(null)}
            onDone={() => { setDismissing(null); invalidateRequests(); }}
          />
        )}
      </div>
    </Panel>
  );
}

function SchedulePanel(
  { row, unit, onCancel, onDone }: { row: RequestRow; unit: HealthUnit; onCancel(): void; onDone(): void }
) {
  const [ value, setValue ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const parsed = value ? new Date(value) : null;
  const valid = !!parsed && !Number.isNaN(parsed.getTime());

  let warning: string | null = null;
  if (valid && parsed) {
    const hoursUntil = (parsed.getTime() - Date.now()) / 3_600_000;
    if (hoursUntil < 48) {
      warning = "O horário nasce confirmado";
    } else {
      const deadline = new Date(parsed.getTime() - 24 * 3_600_000);
      warning = `O cidadão precisa confirmar até ${fmtShort(deadline)}`;
    }
  }

  async function confirm() {
    if (busy || !valid || !parsed) return;
    setBusy(true); setError(null);
    try {
      await scheduleRequest(row.id, parsed.toISOString(), unit.id);
      onDone();
    } catch (err) {
      if (errorCode(err) === "request_not_open") { onDone(); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Marcar horário</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={{ ...labelStyle, maxWidth: 240 }}>
        Horário
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle} />
      </label>
      {warning && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{warning}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void confirm()}
          style={(!valid || busy) ? disabledButtonStyle : buttonStyle}
        >
          Confirmar horário
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

function DismissPanel(
  { row, unit, onCancel, onDone }: { row: RequestRow; unit: HealthUnit; onCancel(): void; onDone(): void }
) {
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const valid = reason.trim().length >= 10;

  async function confirm() {
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try {
      await dismissRequest(row.id, reason, unit.id);
      onDone();
    } catch (err) {
      if (errorCode(err) === "request_not_open") { onDone(); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Encerrar pedido</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={labelStyle}>
        Justificativa
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void confirm()}
          style={(!valid || busy) ? disabledButtonStyle : buttonStyle}
        >
          Confirmar encerramento
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
