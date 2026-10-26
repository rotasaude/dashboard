import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, getMyProfessional, listActiveUnits, lookupCitizen, revokeVerification, verifyCitizen, listVerifications,
  type AttendanceCitizen, type VerifyExtra, type Sex, type AttendanceTriage, type HealthUnit, type VerificationRow
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
import { CheckIn, suggestOther } from "./attendance/CheckIn";
import { ReasonHint } from "../components/ReasonHint";
import { UnitQueue } from "./attendance/UnitQueue";
import { ScreeningQueue } from "./attendance/ScreeningQueue";
import { Requests } from "./attendance/Requests";
import { Agenda } from "./attendance/Agenda";
import { UnassignedRequests } from "./attendance/UnassignedRequests";
import { Units } from "./attendance/Units";
import { ErasureRequest } from "./attendance/ErasureRequest";
import { ErasureRequests } from "./attendance/ErasureRequests";
import { CadsusCheck } from "./attendance/CadsusCheck";
import { NamesFields } from "./attendance/NamesFields";
import { DemographicsFields } from "./attendance/DemographicsForm";
import {
  EMPTY_DEMOGRAPHICS, demographicsBody, demographicsError, demographicsFilled, demographicsProblem, isDemographicsError, type DemographicsDraft
} from "../lib/demographics";
import { EMPTY_NAMES, namesBody, namesProblem, type NamesDraft } from "../lib/citizenNames";
import { hasFeature } from "../lib/features";
import { canUseBilling, showUnitProcedures } from "../lib/billing";
import { UnitProcedures } from "./billing/UnitProcedures";

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
  // Enquanto escolhe outra unidade, as seções da unidade atual somem (AT-16).
  const [ choosingUnit, setChoosingUnit ] = useState(false);
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
  const switchingUnit = choosingUnit && !!unit;
  const careBlocked = canCareRole && unit
    ? (myProfessional.isError ? attendanceError(myProfessional.error)
      : (myProfessional.isSuccess && myProfessional.data === null
        ? "Seu cadastro profissional ainda não foi feito. Fale com a administração da cidade."
        : (myProfessional.isSuccess && !canCare ? "Você não tem vínculo com esta unidade" : null)))
    : null;

  // Subtítulo pela tarefa de quem usa (AT-18).
  const pageSub = canVerify && canCareRole ? "balcão e fila clínica"
    : canCareRole ? "fila clínica · acolhimento e consulta" : "balcão · verificação presencial";

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
      <PageHeader title="Atendimento" sub={pageSub} />
      {canVerify && unit && !switchingUnit && <PageIndex />}
      {(canVerify || canCareRole) && <UnitPicker key={pickerKey} userId={user.id} onChange={setUnit}
        linkedUnitIds={linkedUnitIds} onChoosing={setChoosingUnit} />}
      {/* Trocando de unidade, as seções da atual ficam escondidas, mas montadas:
          cancelar a troca devolve a escuta, a consulta e o que foi digitado (AT-16, I1). */}
      <div hidden={switchingUnit} style={switchingUnit ? undefined : { display: "contents" }}>
      {canVerify && unit && <div id="sec-checkin"><CheckIn unit={unit} onUnitInvalid={onUnitInvalid} demographicsOn={hasFeature(user, "procedure_billing")} /></div>}
      {/* A validação presencial sobe para perto do check-in: é a tarefa mais comum do balcão (FC-10). */}
      {canVerify && <div id="sec-balcao"><Counter cadsusOn={hasFeature(user, "cadsus_lookup")} demographicsOn={hasFeature(user, "procedure_billing")} /></div>}
      {canCare && unit && <ScreeningQueue unit={unit} units={unitsQuery.data ?? []} />}
      {(canVerify || canCareRole) && unit && (
        <div id="sec-fila">
        <UnitQueue
          unit={unit}
          units={unitsQuery.data ?? []}
          canCare={canCare}
          careBlocked={careBlocked}
          onGoToSecurity={goToSecurity}
          clinicalRecord={hasFeature(user, "clinical_record")}
          patientTimeline={hasFeature(user, "patient_timeline")}
          procedureBilling={canUseBilling(user)}
          clinicalDocuments={hasFeature(user, "clinical_documents") && (canVerify || canCareRole)}
          professional={canCare}
          onClinicalRefused={() => void queryClient.invalidateQueries({ queryKey: [ "myProfessional", user.id ] })}
        />
        </div>
      )}
      {/* Módulo 22: procedimento avulso, só do profissional com vínculo e nunca na UBS. */}
      {unit && showUnitProcedures({ user, canCare, unit }) && <UnitProcedures key={unit.id} unit={unit} />}
      {canVerify && unit && <div id="sec-pedidos"><Requests unit={unit} /></div>}
      {canVerify && unit && <div id="sec-agenda"><Agenda unit={unit} /></div>}
      </div>
      {canVerify && <UnassignedRequests />}
      {canVerify && <ErasureRequest />}
      {isAdmin && <History />}
      {isAdmin && <ErasureRequests onGoToSecurity={goToSecurity} />}
      {isAdmin && <Units labOn={hasFeature(user, "municipal_lab")} />}
    </div>
  );
}

// Índice da página (FC-10): botões que rolam até a seção e põem o foco no
// título. Nada de href="#…" — o hash é do roteador do painel.
const PAGE_SECTIONS: [ string, string ][] = [
  [ "Check-in", "sec-checkin" ], [ "Validar cadastro", "sec-balcao" ], [ "Fila", "sec-fila" ],
  [ "Pedidos", "sec-pedidos" ], [ "Agenda", "sec-agenda" ]
];

function PageIndex() {
  function goTo(id: string) {
    const el = document.getElementById(id);
    el?.scrollIntoView({ block: "start" });
    const title = el?.querySelector<HTMLElement>("h2");
    if (title) { title.tabIndex = -1; title.focus(); }
  }
  return (
    <nav aria-label="Nesta página" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {PAGE_SECTIONS.map(([ label, id ]) => (
        <button key={id} type="button" style={secondaryButtonStyle} onClick={() => goTo(id)}>{label}</button>
      ))}
    </nav>
  );
}

// `cadsusOn` (módulo 16): a cidade tem `cadsus_lookup` ligado na sessão.
// `demographicsOn` (módulo 22): raça/cor, etnia e endereço opcionais para o BPA-I, no mesmo POST da validação.
function Counter({ cadsusOn, demographicsOn = false }: { cadsusOn: boolean; demographicsOn?: boolean }) {
  const [ demographics, setDemographics ] = useState<DemographicsDraft>(EMPTY_DEMOGRAPHICS);
  // Módulo 24a (L26): o 422 address_from_household trava o endereço mesmo sem a flag do lookup.
  const [ addressRefused, setAddressRefused ] = useState(false);
  const [ state, setState ] = useState<CounterState>("form");
  const [ cadsusConfirmed, setCadsusConfirmed ] = useState(false);
  const [ cpf, setCpf ] = useState("");
  const [ code, setCode ] = useState("");
  const [ checked, setChecked ] = useState(false);
  const [ profile, setProfile ] = useState<ProfileCheckValue>(() => initialProfileCheck(null));
  const [ names, setNames ] = useState<NamesDraft>(EMPTY_NAMES);
  const [ found, setFound ] = useState<Found | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  function reset() {
    setState("form"); setCpf(""); setCode(""); setChecked(false); setFound(null); setError(null);
    setProfile(initialProfileCheck(null));
    setNames(EMPTY_NAMES);
    setCadsusConfirmed(false);
    setDemographics(EMPTY_DEMOGRAPHICS);
    setAddressRefused(false);
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
      setAddressRefused(false);
      setCadsusConfirmed(false);
      setProfile(initialProfileCheck(result.citizen.profile ?? null));
      setState("found");
    } catch (err) {
      setError(suggestOther(attendanceError(err), "Cheguei na unidade"));
    } finally {
      setBusy(false);
    }
  }

  // "Hoje" no fuso da cidade: às 23h30 de São Paulo, amanhã ainda é futuro.
  const profileProblem = profileCheckProblem(profile, todayInCity());
  // Módulo 19: nome completo obrigatório; social e mãe opcionais.
  const namesIssue = namesProblem(names);
  // Opcionais: vazios não bloqueiam; começados, precisam estar certos.
  // Endereço do cadastro domiciliar (L26): sai dos campos e do corpo.
  const demographicsOpts = { addressLocked: found?.citizen.address_from_household === true || addressRefused };
  const demographicsIssue = demographicsOn && demographicsFilled(demographics, demographicsOpts) ? demographicsProblem(demographics, demographicsOpts) : null;
  const blocked = !checked || busy || profileProblem !== null || namesIssue !== null || demographicsIssue !== null;

  async function validate() {
    if (blocked) return;
    setError(null);
    if (!/^\d{6}$/.test(code)) { setError("informe o código de 6 dígitos"); return; }
    setBusy(true);
    try {
      const profileBody = {
        birth_date: profile.birthDate, sex: profile.sex as Sex, gender_identity: profile.genderIdentity || null,
        ...namesBody(names)
      };
      const extra: VerifyExtra = demographicsOn && demographicsFilled(demographics, demographicsOpts) ? demographicsBody(demographics, demographicsOpts) : {};
      if (cadsusOn) extra.cadsus_confirmed = cadsusConfirmed;
      if (Object.keys(extra).length > 0) await verifyCitizen(cpf, code, profileBody, extra);
      else await verifyCitizen(cpf, code, profileBody);
      setState("done");
    } catch (err) {
      // Recusa dos dados do paciente (módulo 22) tem frase do campo; o resto, a do balcão.
      if (errorCode(err) === "address_from_household") setAddressRefused(true);
      setError(isDemographicsError(err) ? demographicsError(err) : attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Validar cadastro com documento" sub="código de 'Validar no posto', no celular do cidadão">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

        {state === "form" && (
          <form onSubmit={(e) => { e.preventDefault(); void search(); }}
            style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
            <label style={labelStyle}>
              CPF do cidadão (validação)
              <input
                value={cpf}
                onChange={(e) => { setError(null); setCpf(maskCpf(e.target.value)); }}
                style={inputStyle}
                inputMode="numeric"
              />
            </label>
            <label style={labelStyle}>
              Código de validação
              <input
                value={code}
                onChange={(e) => { setError(null); setCode(onlyDigits(e.target.value).slice(0, 6)); }}
                style={inputStyle}
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </label>
            <div>
              <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>
                Buscar validação
              </button>
            </div>
          </form>
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
            <NamesFields value={names} onChange={setNames} problem={namesIssue} />
            {demographicsOn && (
              <DemographicsFields value={demographics} onChange={setDemographics} problem={demographicsIssue} addressLocked={demographicsOpts.addressLocked} />
            )}
            {cadsusOn && (
              <CadsusCheck cpf={cpf} code={code} confirmed={cadsusConfirmed} onConfirmedChange={setCadsusConfirmed} />
            )}
            <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              Conferi o documento com foto e o CPF confere
            </label>

            {!checked && (
              <p id="counter-block" style={{ margin: 0, fontSize: 12, color: "var(--ink2)" }}>marque 'Conferi o documento' para validar</p>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                aria-describedby={checked ? undefined : "counter-block"}
                disabled={blocked}
                onClick={() => void validate()}
                style={blocked ? disabledButtonStyle : buttonStyle}
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
      <ReasonHint id="revoke-reason-hint" text={reason} />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          aria-describedby={valid ? undefined : "revoke-reason-hint"}
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
