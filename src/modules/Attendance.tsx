import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyProfessional, listActiveUnits, lookupCitizen, revokeVerification, verifyCitizen, listVerifications,
  type AttendanceCitizen, type Sex, type AttendanceTriage, type HealthUnit, type VerificationRow
} from "../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError, currentUnitKey, isValidCpf, maskCpf, nivelLabel, onlyDigits } from "../lib/attendance";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import { useAuth } from "../lib/auth";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { KeyValue } from "../components/KeyValue";
import { EmptyState } from "../components/EmptyState";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import type { ModuleId } from "../shell/modules";
import { ProfileCheck, initialProfileCheck, profileCheckProblem, type ProfileCheckValue } from "./attendance/ProfileCheck";
import { UnitPicker } from "./attendance/UnitPicker";
import { CheckIn } from "./attendance/CheckIn";
import { UnitQueue } from "./attendance/UnitQueue";
import { Requests } from "./attendance/Requests";
import { Agenda } from "./attendance/Agenda";
import { UnassignedRequests } from "./attendance/UnassignedRequests";
import { Units } from "./attendance/Units";
import { ErasureRequest } from "./attendance/ErasureRequest";
import { ErasureRequests } from "./attendance/ErasureRequests";
import { CadsusCheck } from "./attendance/CadsusCheck";
import { hasFeature } from "../lib/features";

// Atendimento (spec 2026-09-24-citizen-presencial-verification, Task 6, e
// 2026-09-25-citizen-appointments, Task 7): balcão de verificação presencial
// e check-in (citizen_verifier), fila de atendimento e desfecho clínico
// (health_professional) + histórico de validações (municipal_admin). Os
// erros usam attendanceError, nunca describeActionError — 422 invalid_code
// aqui é o código do CIDADÃO, não o TOTP do servidor.
type CounterState = "form" | "found" | "done";

interface Found { citizen: AttendanceCitizen; triages: AttendanceTriage[] }

export function Attendance({ onNavigate }: { onNavigate(id: ModuleId): void }) {
  const goToSecurity = () => onNavigate("security");
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [ unit, setUnit ] = useState<HealthUnit | null>(null);
  // Remonta o UnitPicker (limpando a escolha guardada) quando o check-in
  // devolve invalid_unit — a unidade foi desativada entre a escolha e o
  // check-in (ou como destino de encaminhamento).
  const [ pickerKey, setPickerKey ] = useState(0);
  const unitsQuery = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits, enabled: !!unit });
  const canCareRole = (user?.memberships.map((m) => m.role) ?? []).includes("health_professional");
  // Chave por usuário (F-10.5): o QueryClient é criado uma vez em main.tsx e
  // sobrevive a troca de sessão (login/logout não chama queryClient.clear());
  // sem o user.id, o vínculo de um profissional vazaria no cache para o
  // próximo usuário que logar na mesma aba.
  const myProfessional = useQuery({
    queryKey: [ "myProfessional", user?.id ?? null ], queryFn: getMyProfessional, enabled: canCareRole,
    // Sem isto, um profissional recém-vinculado por outra sessão (dashboard
    // do admin) continua vendo "sem vínculo" até recarregar a página inteira
    // — os botões clínicos ficam escondidos sem 403 nenhum acontecer.
    refetchInterval: ATTENDANCE_REFETCH_MS
  });

  if (!user) return null;
  const roles = user.memberships.map((m) => m.role);
  const canVerify = roles.includes("citizen_verifier");
  const isAdmin = roles.includes("municipal_admin");

  // F-10.5: chamar e registrar desfecho exigem vínculo ativo com a unidade
  // escolhida. A API é quem garante; aqui só não se oferece o que ela recusaria.
  const linkedUnitIds = new Set((myProfessional.data?.links ?? []).filter((l) => !l.ended_at).map((l) => l.health_unit_id));
  const canCare = canCareRole && !!unit && linkedUnitIds.has(unit.id);
  const careBlocked = canCareRole && unit
    ? (myProfessional.isError ? attendanceError(myProfessional.error)
      : (myProfessional.isSuccess && myProfessional.data === null
        ? "Seu cadastro profissional ainda não foi feito. Fale com a administração da cidade."
        : (myProfessional.isSuccess && !canCare ? "Você não tem vínculo com esta unidade" : null)))
    : null;

  if (!canVerify && !canCareRole && !isAdmin) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <PageHeader title="Atendimento" sub="balcão · verificação presencial" />
        <EmptyState title="seu papel não permite acessar o atendimento" />
      </div>
    );
  }

  function onUnitInvalid() {
    try { localStorage.removeItem(currentUnitKey(user!.id)); } catch { /* sem storage disponível */ }
    setUnit(null);
    setPickerKey((k) => k + 1);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Atendimento" sub="balcão · verificação presencial" />
      {(canVerify || canCareRole) && <UnitPicker key={pickerKey} userId={user.id} onChange={setUnit} />}
      {canVerify && unit && <CheckIn unit={unit} onUnitInvalid={onUnitInvalid} />}
      {(canVerify || canCareRole) && unit && (
        <UnitQueue
          unit={unit}
          units={unitsQuery.data ?? []}
          canCare={canCare}
          careBlocked={careBlocked}
          onClinicalRefused={() => void queryClient.invalidateQueries({ queryKey: [ "myProfessional", user.id ] })}
        />
      )}
      {canVerify && unit && <Requests unit={unit} />}
      {canVerify && unit && <Agenda unit={unit} />}
      {canVerify && <UnassignedRequests />}
      {canVerify && <Counter cadsusOn={hasFeature(user, "cadsus_lookup")} />}
      {canVerify && <ErasureRequest />}
      {isAdmin && <History />}
      {isAdmin && <ErasureRequests onGoToSecurity={goToSecurity} />}
      {isAdmin && <Units />}
    </div>
  );
}

// `cadsusOn` (módulo 16): a cidade tem `cadsus_lookup` ligado na sessão.
function Counter({ cadsusOn }: { cadsusOn: boolean }) {
  const [ state, setState ] = useState<CounterState>("form");
  const [ cadsusConfirmed, setCadsusConfirmed ] = useState(false);
  const [ cpf, setCpf ] = useState("");
  const [ code, setCode ] = useState("");
  const [ checked, setChecked ] = useState(false);
  const [ profile, setProfile ] = useState<ProfileCheckValue>(() => initialProfileCheck(null));
  const [ found, setFound ] = useState<Found | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  function reset() {
    setState("form"); setCpf(""); setCode(""); setChecked(false); setFound(null); setError(null);
    setProfile(initialProfileCheck(null));
    setCadsusConfirmed(false);
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
      setCadsusConfirmed(false);
      setProfile(initialProfileCheck(result.citizen.profile ?? null));
      setState("found");
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  // "Hoje" no fuso da cidade: às 23h30 de São Paulo, amanhã ainda é futuro.
  const profileProblem = profileCheckProblem(profile, todayInCity());

  async function validate() {
    if (busy || !checked || profileProblem) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError("informe o código de 6 dígitos"); return; }
    setBusy(true);
    try {
      const profileBody = {
        birth_date: profile.birthDate, sex: profile.sex as Sex, gender_identity: profile.genderIdentity || null
      };
      if (cadsusOn) await verifyCitizen(cpf, code, profileBody, { cadsus_confirmed: cadsusConfirmed });
      else await verifyCitizen(cpf, code, profileBody);
      setState("done");
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Balcão" sub="código gerado em 'Validar no posto'">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

        {state === "form" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
            <label style={labelStyle}>
              CPF do cidadão (validação)
              <input
                value={cpf}
                onChange={(e) => setCpf(maskCpf(e.target.value))}
                style={inputStyle}
                inputMode="numeric"
              />
            </label>
            <label style={labelStyle}>
              Código de validação
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
                Buscar validação
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

            <ProfileCheck declared={found.citizen.profile ?? null} value={profile} today={todayInCity()} onChange={setProfile} />
            {cadsusOn && (
              <CadsusCheck cpf={cpf} code={code} confirmed={cadsusConfirmed} onConfirmedChange={setCadsusConfirmed} />
            )}
            <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              Conferi o documento com foto e o CPF confere
            </label>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={!checked || busy || profileProblem !== null}
                onClick={() => void validate()}
                style={(!checked || busy || profileProblem !== null) ? disabledButtonStyle : buttonStyle}
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
