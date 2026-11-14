// src/modules/FieldDevices.tsx
// Tela "Aparelhos de campo" (módulo 24b, F-24.17; Q62, Q75): lista, cadastra e revoga os aparelhos de quem olha. Listar e revogar nunca
// dependem de `home_visits` (um aparelho perdido sempre pode ser revogado). O contexto só é lido com `home_visits` ligado, e só para
// saber se há `can_register_device`; desligado, ou um 403 feature_disabled do contexto/do POST, esconde só o cadastro.
// O token do aparelho novo vive num ref local e no diálogo do QR; nunca no cache (a resposta do POST não passa pelo react-query).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getHomeVisitContext, listFieldDevices, registerFieldDevice, revokeFieldDevice, type FieldDevice, type FieldDeviceCreated } from "../lib/api";
import { useAuth } from "../lib/auth";
import { FD_KEY, HV_CONTEXT_KEY, STATIC_QUERY, canUseHomeVisits, homeVisitError, homeVisitRefusals, isFeatureOff, revokedReasonLabel } from "../lib/homeVisits";
import { fmtDateTime } from "../lib/format";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { DeviceQrDialog } from "./homeVisits/DeviceQrDialog";
import { ActionButton } from "../components/ActionButton";
import { ConfirmButton } from "../components/ConfirmButton";
import { DataTable, type Column } from "../components/DataTable";
import { SensitiveAction } from "../components/SensitiveAction";
import { alert, muted, stack } from "./exams/styles";

export const REGISTER_OFF = "o cadastro de aparelho está desligado nesta cidade";
export const REGISTER_ROLE = "só agentes de campo da Tabela 7 cadastram aparelho";
export const NAME_MAX = 60;

class NameRefused extends Error {}

// `perspective`: "owner" é a tela de quem tem o aparelho ("por você"); "admin" é a lista da cidade, onde quem olha não é o dono.
const ADMIN_REVOKED: Record<string, string> = { user: "pela pessoa", admin: "pela administração" };
export const deviceStatusLabel = (d: FieldDevice, perspective: "owner" | "admin" = "owner"): string => {
  if (d.status === "inactive") return "inativo: vínculo encerrado";
  if (d.status === "revoked") {
    if (!d.revoked_reason) return "revogado";
    const own = perspective === "admin" && Object.prototype.hasOwnProperty.call(ADMIN_REVOKED, d.revoked_reason) ? ADMIN_REVOKED[d.revoked_reason] : null;
    return `revogado: ${own ?? revokedReasonLabel(d.revoked_reason)}`;
  }
  return d.status === "active" ? "ativo" : d.status;
};

export function FieldDevices({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <HomeVisitGate title="Aparelhos de campo" sub="app de campo · cadastrar e revogar o aparelho" feature={null} allow={(r) => r.professional}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </HomeVisitGate>
  );
}

function Body({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const switchOn = canUseHomeVisits(user);
  const list = useQuery({ queryKey: [ FD_KEY ], queryFn: listFieldDevices, ...STATIC_QUERY });
  const ctx = useQuery({ queryKey: [ HV_CONTEXT_KEY ], queryFn: getHomeVisitContext, enabled: switchOn, ...STATIC_QUERY });
  const [ postOff, setPostOff ] = useState(false);
  const [ registering, setRegistering ] = useState(false);
  const [ showQr, setShowQr ] = useState(false);
  const [ message, setMessage ] = useState<string | null>(null);
  // O token do aparelho novo: só neste ref, só enquanto o diálogo está aberto.
  const created = useRef<FieldDeviceCreated | null>(null);
  const reread = () => queryClient.invalidateQueries({ queryKey: [ FD_KEY ] });
  // O painel que abriu o diálogo já não existe quando ele fecha: o foco volta ao "Cadastrar aparelho" (que reaparece sob o diálogo).
  const registerBox = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (showQr || !restoreFocus.current) return;
    restoreFocus.current = false;
    registerBox.current?.querySelector("button")?.focus();
  }, [ showQr ]);

  const off = !switchOn || postOff || (ctx.isError && isFeatureOff(ctx.error));
  let register: ReactNode = null;
  if (off) register = <p style={muted}>{REGISTER_OFF}</p>;
  else if (ctx.isError) register = <p role="alert" style={alert}>{homeVisitError(ctx.error)}</p>;
  else if (!ctx.data) register = <p role="status" style={muted}>Carregando…</p>;
  else if (!ctx.data.teams.some((t) => t.can_register_device)) register = <p style={muted}>{REGISTER_ROLE}</p>;
  else if (!registering) register = <div ref={registerBox}><ActionButton onClick={() => { setMessage(null); setRegistering(true); }}>Cadastrar aparelho</ActionButton></div>;

  async function runRegister(values: Record<string, string>) {
    const name = values.name.trim();
    if (name === "" || name.length > NAME_MAX) throw new NameRefused();
    try {
      created.current = await registerFieldDevice(name);
    } catch (err) {
      if (isFeatureOff(err)) { setPostOff(true); setRegistering(false); }
      throw err;
    }
  }

  function closeQr() {
    created.current = null;
    restoreFocus.current = true;
    setShowQr(false);
    void reread();
  }

  async function revoke(id: string) {
    setMessage(null);
    try {
      await revokeFieldDevice(id);
    } catch (err) {
      setMessage(homeVisitError(err));
      // Aparelho já revogado: a tela estava velha; relê uma vez.
      if (homeVisitRefusals(err)[0].code === "device_already_revoked") await reread();
      return;
    }
    await reread();
  }

  const cols: Column<FieldDevice>[] = [
    { label: "Aparelho", w: "1.4fr", card: "title", render: (d) => d.name },
    { label: "Cadastrado em", w: "1fr", render: (d) => fmtDateTime(d.created_at) },
    { label: "Último uso", w: "1fr", render: (d) => (d.last_used_at ? fmtDateTime(d.last_used_at) : "nunca usado") },
    { label: "Situação", w: "1.2fr", render: deviceStatusLabel },
    {
      label: "Ações", w: "9rem", card: "actions",
      render: (d) => (d.status === "revoked" ? null : <ConfirmButton label={`Revogar ${d.name}`} question={`Revogar ${d.name}? O app de campo deste aparelho deixa de entrar.`} variant="danger" onConfirm={() => revoke(d.id)} />)
    }
  ];

  return (
    <div style={stack}>
      {register}
      {registering && !off && (
        <SensitiveAction
          title="Cadastrar aparelho"
          description="Gera um QR de uso único para ligar o app de campo. Cada pessoa pode ter até 3 aparelhos ativos."
          requiresStepUp
          fields={[ { name: "name", label: "Nome do aparelho", required: true } ]}
          run={runRegister}
          onDone={() => { setRegistering(false); setShowQr(true); void reread(); }}
          onCancel={() => setRegistering(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => (err instanceof NameRefused ? `informe o nome do aparelho, de 1 a ${NAME_MAX} caracteres` : homeVisitError(err))}
        />
      )}
      {message && <p role="alert" style={alert}>{message}</p>}
      {list.isError ? <p role="alert" style={alert}>{homeVisitError(list.error)}</p>
        : !list.data ? <p role="status" style={muted}>Carregando…</p>
        : <DataTable label="Aparelhos de campo" cols={cols} rows={list.data} rowKey={(d) => d.id} empty="nenhum aparelho cadastrado" />}
      {showQr && created.current && <DeviceQrDialog created={created.current} onClose={closeQr} />}
    </div>
  );
}
