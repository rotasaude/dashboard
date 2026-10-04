import { useState } from "react";
import { drainUnit, type HealthUnitRow, type UnitDrainResult } from "../../lib/api";
import { attendanceError } from "../../lib/attendance";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

// Esvaziar unidade (api#29; F-09.3): o municipal_admin move todos os pedidos
// abertos e horários marcados para outra unidade ativa, com um motivo que não
// muda depois (aviso da api#32). Depois disso a unidade pode ser desativada.
const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
const MIN_REASON = 10;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function DrainUnitPanel({ unit, units, onCancel, onDone }: {
  unit: HealthUnitRow; units: HealthUnitRow[]; onCancel(): void; onDone(result: UnitDrainResult, target: HealthUnitRow): void
}) {
  const [ targetId, setTargetId ] = useState("");
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const targets = units.filter((u) => u.active && u.id !== unit.id);
  const valid = targetId !== "" && reason.trim().length >= MIN_REASON;

  async function confirm() {
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try {
      const result = await drainUnit(unit.id, targetId, reason.trim());
      onDone(result, targets.find((u) => u.id === targetId)!);
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  const requests = plural(unit.live_requests_count ?? 0, "pedido", "pedidos");
  const appointments = plural(unit.live_appointments_count ?? 0, "horário marcado", "horários marcados");

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Esvaziar {unit.name}</strong>
      <p style={{ margin: 0, fontSize: 12.5 }}>
        {`${requests} e ${appointments} vão para a unidade escolhida. Os horários mantêm data e hora; se faltarem 48h ou mais, o cidadão confirma de novo.`}
      </p>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={{ ...labelStyle, maxWidth: 320 }}>
        Unidade de destino
        <select value={targetId} onChange={(e) => setTargetId(e.target.value)} style={inputStyle}>
          <option value="">—</option>
          {targets.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        Motivo
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }}
          aria-describedby="drain-reason-notice" />
      </label>
      <FrozenTextNotice id="drain-reason-notice" />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!valid || busy} onClick={() => void confirm()}
          style={(!valid || busy) ? disabledButtonStyle : buttonStyle}>
          Esvaziar unidade
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}
