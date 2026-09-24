import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError, checkIn, checkInByException, lookupCheckIn, searchCheckInTriages,
  type CheckInCitizen, type CheckInTriage, type HealthUnit
} from "../../lib/api";
import { attendanceError, isValidCpf, maskCpf, onlyDigits } from "../../lib/attendance";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { KeyValue } from "../../components/KeyValue";
import { EmptyState } from "../../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

// CheckIn (Task 7) — check-in por código (spec §5 "Check-in") e exceção por
// CPF ("Cidadão sem o código"), dentro da unidade escolhida (UnitPicker,
// Task 6). `invalid_unit` (unidade desativada entre a escolha e o check-in)
// chama onUnitInvalid para o Attendance.tsx voltar à escolha de unidade.
// Depois de um check-in bem-sucedido, invalida a query de atendimentos
// abertos (OpenAttendances) para a lista recarregar.
interface Props {
  unit: HealthUnit;
  onUnitInvalid(): void;
}

type Mode = "code" | "exception";

function isInvalidUnit(err: unknown): boolean {
  return err instanceof ApiError && (err.body as { error?: string } | undefined)?.error === "invalid_unit";
}

export function CheckIn({ unit, onUnitInvalid }: Props) {
  const [ mode, setMode ] = useState<Mode>("code");

  return (
    <Panel
      title="Check-in"
      right={
        <button type="button" style={secondaryButtonStyle} onClick={() => setMode(mode === "code" ? "exception" : "code")}>
          {mode === "code" ? "Cidadão sem o código" : "Cidadão com código"}
        </button>
      }
    >
      {mode === "code"
        ? <CodeFlow unit={unit} onUnitInvalid={onUnitInvalid} />
        : <ExceptionFlow unit={unit} onUnitInvalid={onUnitInvalid} />}
    </Panel>
  );
}

function CodeFlow({ unit, onUnitInvalid }: Props) {
  const queryClient = useQueryClient();
  const [ state, setState ] = useState<"form" | "found" | "done">("form");
  const [ cpf, setCpf ] = useState("");
  const [ code, setCode ] = useState("");
  const [ checked, setChecked ] = useState(false);
  const [ found, setFound ] = useState<{ citizen: CheckInCitizen; triage: CheckInTriage } | null>(null);
  const [ verified, setVerified ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  function reset() {
    setState("form"); setCpf(""); setCode(""); setChecked(false); setFound(null); setVerified(false); setError(null);
  }

  async function search() {
    if (busy) return;
    setError(null);
    if (!isValidCpf(cpf)) { setError("CPF inválido"); return; }
    if (!/^\d{6}$/.test(code)) { setError("informe o código de 6 dígitos"); return; }
    setBusy(true);
    try {
      const result = await lookupCheckIn(cpf, code);
      setFound(result);
      setState("found");
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (busy || !found) return;
    setError(null);
    setBusy(true);
    try {
      const result = await checkIn(cpf, code, unit.id, checked);
      setVerified(result.verified);
      setState("done");
      void queryClient.invalidateQueries({ queryKey: [ "openAttendances", unit.id ] });
    } catch (err) {
      if (isInvalidUnit(err)) { onUnitInvalid(); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

      {state === "form" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
          <label style={labelStyle}>
            CPF
            <input value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} style={inputStyle} inputMode="numeric" />
          </label>
          <label style={labelStyle}>
            Código do cidadão
            <input
              value={code}
              onChange={(e) => setCode(onlyDigits(e.target.value).slice(0, 6))}
              style={inputStyle}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </label>
          <div>
            <button type="button" disabled={busy} onClick={() => void search()} style={busy ? disabledButtonStyle : buttonStyle}>
              Buscar
            </button>
          </div>
        </div>
      )}

      {state === "found" && found && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <KeyValue k="CPF" v={found.citizen.cpf_masked} />
            <KeyValue k="Celular" v={found.citizen.phone_masked} />
            <KeyValue k="Data" v={fmtDateTime(found.triage.date)} />
            <KeyValue k="Protocolo" v={found.triage.protocol_name} />
            <KeyValue k="Prioridade" v={String(found.triage.priority)} />
          </div>

          {found.citizen.verification_level === "declared" && (
            <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              Conferi o documento com foto e o CPF confere
            </label>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => void start()} style={busy ? disabledButtonStyle : buttonStyle}>
              Iniciar atendimento
            </button>
            <button type="button" disabled={busy} onClick={reset} style={secondaryButtonStyle}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {state === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Atendimento iniciado</p>
          {verified && <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>cadastro validado</p>}
          <div>
            <button type="button" onClick={reset} style={buttonStyle}>Próximo atendimento</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExceptionFlow({ unit, onUnitInvalid }: Props) {
  const queryClient = useQueryClient();
  const [ cpf, setCpf ] = useState("");
  const [ triages, setTriages ] = useState<CheckInTriage[] | null>(null);
  const [ selected, setSelected ] = useState<CheckInTriage | null>(null);
  const [ reason, setReason ] = useState("");
  const [ done, setDone ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  function reset() {
    setCpf(""); setTriages(null); setSelected(null); setReason(""); setDone(false); setError(null);
  }

  async function search() {
    if (busy) return;
    setError(null);
    if (!isValidCpf(cpf)) { setError("CPF inválido"); return; }
    setBusy(true);
    try {
      setTriages(await searchCheckInTriages(cpf));
      setSelected(null);
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  const reasonValid = reason.trim().length >= 10;

  async function start() {
    if (busy || !selected || !reasonValid) return;
    setError(null);
    setBusy(true);
    try {
      await checkInByException(cpf, selected.id, unit.id, reason);
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: [ "openAttendances", unit.id ] });
    } catch (err) {
      if (isInvalidUnit(err)) { onUnitInvalid(); return; }
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Atendimento iniciado</p>
        <div>
          <button type="button" onClick={reset} style={buttonStyle}>Próximo atendimento</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", maxWidth: 400 }}>
        <label style={{ ...labelStyle, flex: 1 }}>
          CPF
          <input value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} style={inputStyle} inputMode="numeric" />
        </label>
        <button type="button" disabled={busy} onClick={() => void search()} style={busy ? disabledButtonStyle : buttonStyle}>
          Buscar triagens
        </button>
      </div>

      {triages && (
        triages.length === 0 ? <EmptyState title="nenhuma triagem elegível para este CPF" /> : (
          <DataTable<CheckInTriage>
            cols={[
              { label: "Data", w: "1fr", render: (t) => fmtDateTime(t.date) },
              { label: "Protocolo", w: "2fr", render: (t) => t.protocol_name },
              { label: "Prioridade", w: "1fr", render: (t) => String(t.priority) }
            ]}
            rows={triages}
            rowKey={(t) => t.id}
            onRowClick={(t) => setSelected(t)}
          />
        )
      )}

      {selected && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
          <label style={labelStyle}>
            Motivo
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
          </label>
          <div>
            <button
              type="button"
              disabled={busy || !reasonValid}
              onClick={() => void start()}
              style={(busy || !reasonValid) ? disabledButtonStyle : buttonStyle}
            >
              Iniciar atendimento
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
