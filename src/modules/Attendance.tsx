import { useState } from "react";
import {
  lookupCitizen, revokeVerification, verifyCitizen, listVerifications,
  type AttendanceCitizen, type AttendanceTriage, type VerificationRow
} from "../lib/api";
import { attendanceError, isValidCpf, maskCpf, onlyDigits } from "../lib/attendance";
import { fmtDateTime } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { KeyValue } from "../components/KeyValue";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";

// Atendimento (spec 2026-09-24-citizen-presencial-verification, Task 6):
// balcão de verificação presencial (citizen_verifier) + histórico de
// validações (municipal_admin). Os erros usam attendanceError, nunca
// describeActionError — 422 invalid_code aqui é o código do CIDADÃO, não o
// TOTP do servidor.
type CounterState = "form" | "found" | "done";

interface Found { citizen: AttendanceCitizen; triages: AttendanceTriage[] }

function nivelLabel(level: AttendanceCitizen["verification_level"]): string {
  return level === "verified" ? "verificado" : "declarado";
}

export function Attendance() {
  const { user } = useAuth();
  if (!user) return null;
  const roles = user.memberships.map((m) => m.role);
  const canVerify = roles.includes("citizen_verifier");
  const isAdmin = roles.includes("municipal_admin");

  if (!canVerify && !isAdmin) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <PageHeader title="Atendimento" sub="balcão · verificação presencial" />
        <EmptyState title="seu papel não permite acessar o atendimento" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Atendimento" sub="balcão · verificação presencial" />
      {canVerify && <Counter />}
      {isAdmin && <History />}
    </div>
  );
}

function Counter() {
  const [ state, setState ] = useState<CounterState>("form");
  const [ cpf, setCpf ] = useState("");
  const [ code, setCode ] = useState("");
  const [ checked, setChecked ] = useState(false);
  const [ found, setFound ] = useState<Found | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  function reset() {
    setState("form"); setCpf(""); setCode(""); setChecked(false); setFound(null); setError(null);
  }

  async function search() {
    if (busy) return;
    setError(null);
    if (!isValidCpf(cpf)) { setError("CPF inválido"); return; }
    if (!/^\d{6}$/.test(code)) { setError("informe o código de 6 dígitos"); return; }
    setBusy(true);
    try {
      const result = await lookupCitizen(cpf, code);
      setFound(result);
      setState("found");
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  async function validate() {
    if (busy || !checked) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError("informe o código de 6 dígitos"); return; }
    setBusy(true);
    try {
      await verifyCitizen(cpf, code);
      setState("done");
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Balcão">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

        {state === "form" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
            <label style={labelStyle}>
              CPF
              <input
                value={cpf}
                onChange={(e) => setCpf(maskCpf(e.target.value))}
                style={inputStyle}
                inputMode="numeric"
              />
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
              <KeyValue k="Cadastrado em" v={fmtDateTime(found.citizen.created_at)} />
              <KeyValue k="Nível" v={<Tag>{nivelLabel(found.citizen.verification_level)}</Tag>} />
            </div>

            <DataTable<AttendanceTriage>
              cols={[
                { label: "Data", w: "1fr", render: (t) => fmtDateTime(t.date) },
                { label: "Protocolo", w: "2fr", render: (t) => t.protocol_name }
              ]}
              rows={found.triages}
              rowKey={(_t, i) => String(i)}
              empty="nenhuma triagem"
            />

            <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              Conferi o documento com foto e o CPF confere
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={!checked || busy}
                onClick={() => void validate()}
                style={(!checked || busy) ? disabledButtonStyle : buttonStyle}
              >
                Validar cadastro
              </button>
              <button type="button" disabled={busy} onClick={reset} style={secondaryButtonStyle}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {state === "done" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Cadastro validado</p>
            <div>
              <button type="button" onClick={reset} style={buttonStyle}>Próximo atendimento</button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function History() {
  const [ cpf, setCpf ] = useState("");
  const [ queriedCpf, setQueriedCpf ] = useState<string | null>(null);
  const [ rows, setRows ] = useState<VerificationRow[] | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ revoking, setRevoking ] = useState<VerificationRow | null>(null);

  async function load(forCpf: string = cpf) {
    if (busy) return;
    setBusy(true); setError(null); setRows(null);
    try {
      setRows(await listVerifications(forCpf));
      setQueriedCpf(forCpf);
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  function situacao(row: VerificationRow): string {
    if (row.active) return "ativa";
    return `desfeita em ${fmtDateTime(row.revoked_at)} por ${row.revoked_by} — ${row.revoke_reason}`;
  }

  return (
    <Panel title="Histórico de validações">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", maxWidth: 400 }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            CPF do histórico
            <input value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} style={inputStyle} inputMode="numeric" />
          </label>
          <button type="button" disabled={busy} onClick={() => void load()} style={busy ? disabledButtonStyle : buttonStyle}>
            Ver histórico
          </button>
        </div>

        {rows && (
          rows.length === 0 ? <EmptyState title="nenhuma validação para este CPF" /> : (
            <DataTable<VerificationRow>
              cols={[
                { label: "Data", w: "1fr", render: (r) => fmtDateTime(r.verified_at) },
                { label: "Servidor", w: "1.5fr", render: (r) => <span className="mono">{r.verified_by}</span> },
                { label: "Celular", w: "1fr", render: (r) => r.phone_masked },
                { label: "Situação", w: "2fr", render: (r) => situacao(r) },
                {
                  label: "", w: "auto", align: "right", render: (r) =>
                    r.active && (
                      <button type="button" style={buttonStyle} onClick={() => setRevoking(r)}>Desfazer</button>
                    )
                }
              ]}
              rows={rows}
              rowKey={(r) => r.id}
            />
          )
        )}

        {revoking && (
          <RevokePanel
            row={revoking}
            onCancel={() => setRevoking(null)}
            onDone={() => { setRevoking(null); void load(queriedCpf ?? cpf); }}
          />
        )}
      </div>
    </Panel>
  );
}

function RevokePanel({ row, onCancel, onDone }: { row: VerificationRow; onCancel(): void; onDone(): void }) {
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const valid = reason.trim().length >= 10;

  async function confirm() {
    if (busy || !valid) return;
    setBusy(true); setError(null);
    try {
      await revokeVerification(row.id, reason);
      onDone();
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16, border: "1px solid var(--rule)", borderRadius: 8 }}>
      <strong>Desfazer validação</strong>
      {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
      <label style={labelStyle}>
        Motivo
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...inputStyle, minHeight: 60 }} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          disabled={!valid || busy}
          onClick={() => void confirm()}
          style={(!valid || busy) ? disabledButtonStyle : buttonStyle}
        >
          Confirmar desfazer
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
