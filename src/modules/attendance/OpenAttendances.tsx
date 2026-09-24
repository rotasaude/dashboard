import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError, closeAttendance, listOpenAttendances,
  type AttendanceOutcome, type HealthUnit, type OpenAttendanceRow
} from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

// OpenAttendances (Task 7) — atendimentos abertos da unidade atual (spec §5
// "Atendimentos abertos"), já ordenados pela API (prioridade, depois
// chegada) — esta tela não reordena. "Encerrar" abre o desfecho; para
// "Encaminhado" a lista de destino são as unidades ativas (`units`, vindo do
// Attendance.tsx) e o botão fica desabilitado sem destino nem descrição.
// `already_closed` (outro atendente encerrou primeiro) recarrega a lista em
// vez de mostrar erro parado.
interface Props {
  unit: HealthUnit;
  units: HealthUnit[];
}

const OUTCOME_LABEL: Record<AttendanceOutcome, string> = {
  discharged: "Atendido e liberado",
  referred: "Encaminhado",
  left: "Saiu sem atendimento"
};

function isAlreadyClosed(err: unknown): boolean {
  return err instanceof ApiError && (err.body as { error?: string } | undefined)?.error === "already_closed";
}

export function OpenAttendances({ unit, units }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ "openAttendances", unit.id ], queryFn: () => listOpenAttendances(unit.id) });
  const [ closing, setClosing ] = useState<OpenAttendanceRow | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: [ "openAttendances", unit.id ] });
  }

  const rows = query.data ?? [];

  return (
    <Panel title="Atendimentos abertos">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {rows.length === 0 ? (
          <EmptyState title="nenhum atendimento aberto" />
        ) : (
          <DataTable<OpenAttendanceRow>
            cols={[
              { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
              { label: "Chegada", w: "1fr", render: (r) => fmtDateTime(r.checked_in_at) },
              { label: "Protocolo", w: "2fr", render: (r) => r.protocol_name },
              { label: "Prioridade", w: "1fr", render: (r) => String(r.priority) },
              {
                label: "", w: "auto", align: "right", render: (r) => (
                  <button type="button" style={secondaryButtonStyle} onClick={() => setClosing(r)}>Encerrar</button>
                )
              }
            ]}
            rows={rows}
            rowKey={(r) => r.id}
          />
        )}

        {closing && (
          <ClosePanel
            row={closing}
            units={units}
            onCancel={() => setClosing(null)}
            onDone={() => { setClosing(null); invalidate(); }}
          />
        )}
      </div>
    </Panel>
  );
}

function ClosePanel(
  { row, units, onCancel, onDone }: { row: OpenAttendanceRow; units: HealthUnit[]; onCancel(): void; onDone(): void }
) {
  const [ outcome, setOutcome ] = useState<AttendanceOutcome>("discharged");
  const [ referralUnitId, setReferralUnitId ] = useState("");
  const [ referralNote, setReferralNote ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const referralIncomplete = outcome === "referred" && !referralUnitId && !referralNote.trim();
  const disabled = busy || referralIncomplete;

  async function confirm() {
    if (disabled) return;
    setBusy(true); setError(null);
    try {
      await closeAttendance(row.id, outcome, referralUnitId || undefined, referralNote || undefined);
      onDone();
    } catch (err) {
      if (isAlreadyClosed(err)) { onDone(); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Encerrar atendimento</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

      <label style={labelStyle}>
        Desfecho
        <select value={outcome} onChange={(e) => setOutcome(e.target.value as AttendanceOutcome)} style={inputStyle}>
          {(Object.keys(OUTCOME_LABEL) as AttendanceOutcome[]).map((o) => (
            <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
          ))}
        </select>
      </label>

      {outcome === "referred" && (
        <>
          <label style={labelStyle}>
            Unidade de destino
            <select value={referralUnitId} onChange={(e) => setReferralUnitId(e.target.value)} style={inputStyle}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Descrição
            <input value={referralNote} onChange={(e) => setReferralNote(e.target.value)} style={inputStyle} />
          </label>
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={disabled} onClick={() => void confirm()} style={disabled ? disabledButtonStyle : buttonStyle}>
          Confirmar encerramento
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
