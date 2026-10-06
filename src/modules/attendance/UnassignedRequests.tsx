// Fila "sem unidade" (módulo 17; spec §5.2–§5.3, contratos §4.1): pedido de
// triagem cujo bairro não tem unidade de referência. Qualquer recepção da
// cidade atribui a unidade que vai marcar. 409 already_assigned (outra
// recepção chegou antes) e 409 request_not_open (pedido encerrado) fecham o
// painel e releem a fila; 422 invalid_unit mantém o painel para escolher outra.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { assignRequestUnit, errorCode, listActiveUnits, listUnassignedRequests, type RequestRow } from "../../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError } from "../../lib/attendance";
import { PRIORITY_LABEL, fmtDueOn, requestKindLabel, requestMarks } from "../../lib/scheduling";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

const KEY = [ "unassignedRequests" ] as const;
const CLOSING_CODES = new Set([ "already_assigned", "request_not_open" ]);

export function UnassignedRequests() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: listUnassignedRequests, refetchInterval: ATTENDANCE_REFETCH_MS });
  const [ assigning, setAssigning ] = useState<RequestRow | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const reload = () => void queryClient.invalidateQueries({ queryKey: KEY });

  return (
    <Panel title="Pedidos sem unidade" sub="bairro sem unidade de referência">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {notice && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{notice}</p>}
        {query.isError ? <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>
          : query.isPending ? <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
          : (query.data ?? []).length === 0 ? <EmptyState title="nenhum pedido sem unidade" />
          : (
            <DataTable<RequestRow>
              cols={[
                { label: "Pedido", w: "1fr", render: (r) => requestKindLabel(r) },
                { label: "Atendimento", w: "1.5fr", render: (r) => r.appointment_type_name },
                { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
                { label: "Prazo", w: "1fr", render: (r) => fmtDueOn(r.due_on) },
                { label: "Prioridade", w: "1fr", render: (r) =>
                  <Tag tone={r.priority === "priority" ? "warn" : "neutral"}>{PRIORITY_LABEL[r.priority]}</Tag> },
                { label: "Marcas", w: "1.5fr", render: (r) => requestMarks(r).map((m) => m.label).join(", ") || "—" },
                { label: "", w: "auto", align: "right", render: (r) => (
                  <button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setAssigning(r); }}>
                    Atribuir unidade
                  </button>
                ) }
              ]}
              rows={query.data ?? []}
              rowKey={(r) => r.id}
            />
          )}
        {assigning && (
          <AssignPanel
            key={assigning.id}
            row={assigning}
            onCancel={() => setAssigning(null)}
            onDone={(unitId) => {
              setAssigning(null); reload();
              void queryClient.invalidateQueries({ queryKey: [ "unitRequests", unitId ] });
            }}
            onConflict={(message) => { setAssigning(null); setNotice(message); reload(); }}
          />
        )}
      </div>
    </Panel>
  );
}

function AssignPanel({ row, onCancel, onDone, onConflict }: {
  row: RequestRow; onCancel(): void; onDone(unitId: string): void; onConflict(message: string): void;
}) {
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits });
  const [ unitId, setUnitId ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  async function confirm() {
    if (busy || !unitId) return;
    setBusy(true); setError(null);
    try {
      await assignRequestUnit(row.id, unitId);
      onDone(unitId);
    } catch (err) {
      const code = errorCode(err);
      if (code && CLOSING_CODES.has(code)) { onConflict(attendanceError(err)); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>{`Atribuir unidade — ${row.cpf_masked}`}</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)", maxWidth: 320 }}>
        Unidade que vai marcar
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)} style={inputStyle}>
          <option value="">escolha…</option>
          {(units.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!unitId || busy} onClick={() => void confirm()}
          style={!unitId || busy ? disabledButtonStyle : buttonStyle}>Confirmar unidade</button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}
