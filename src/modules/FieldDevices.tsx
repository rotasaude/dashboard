// src/modules/FieldDevices.tsx
// Tela "Aparelhos de campo" (módulo 24b, F-24.17; Q62, Q75): lista, cadastra e revoga os aparelhos de quem olha. Listar e revogar nunca
// dependem de `home_visits` (um aparelho perdido sempre pode ser revogado). O contexto só é lido com `home_visits` ligado, e só para
// saber se há `can_register_device`; desligado, ou um 403 feature_disabled do contexto/do POST, esconde só o cadastro.
// O token do aparelho novo vive num ref local e no diálogo do QR; nunca no cache (a resposta do POST não passa pelo react-query).
// Módulo 24c (Q16, Q17): "Substituir" troca um aparelho ATIVO por outro (o antigo para de sincronizar e guarda a fila; não conta no
// limite de 3); "Cadastrar novo" refaz o cadastro de um aparelho revogado automaticamente; revogar avisa do que se perde. Os dois
// são cadastros: só aparecem para quem pode cadastrar.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getHomeVisitContext, listFieldDevices, registerFieldDevice, revokeFieldDevice, type FieldDevice, type FieldDeviceCreated } from "../lib/api";
import { useAuth } from "../lib/auth";
import { FD_KEY, HV_CONTEXT_KEY, STATIC_QUERY, canUseHomeVisits, homeVisitError, homeVisitRefusals, isFeatureOff } from "../lib/homeVisits";
import { REPLACE_NOTICE, REREGISTER_NOTICE, canReplace, deviceStatusLabel, isAutoRevoked, revokeLossWarning } from "../lib/fieldDevices";
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

// O que o painel de cadastro está fazendo: aparelho novo, substituição de um ativo ou novo cadastro de um revogado automaticamente.
type Flow = { kind: "new" } | { kind: "replace"; device: FieldDevice } | { kind: "again"; device: FieldDevice };
const REGISTER_NOTICE = "Gera um QR de uso único para ligar o app de campo. Cada pessoa pode ter até 3 aparelhos ativos.";

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
  const [ flow, setFlow ] = useState<Flow | null>(null);
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
  else if (!flow) register = <div ref={registerBox}><ActionButton onClick={() => { setMessage(null); setFlow({ kind: "new" }); }}>Cadastrar aparelho</ActionButton></div>;
  // Substituir e cadastrar de novo são cadastros: valem as mesmas condições do "Cadastrar aparelho".
  const canRegister = !off && !ctx.isError && !!ctx.data?.teams.some((t) => t.can_register_device);

  async function runRegister(values: Record<string, string>) {
    const name = values.name.trim();
    if (name === "" || name.length > NAME_MAX) throw new NameRefused();
    try {
      created.current = flow?.kind === "replace" ? await registerFieldDevice(name, flow.device.id) : await registerFieldDevice(name);
    } catch (err) {
      if (isFeatureOff(err)) { setPostOff(true); setFlow(null); }
      // O aparelho a substituir deixou de estar ativo: a lista estava velha; relê uma vez.
      if (homeVisitRefusals(err)[0].path === "replaces_device_id") void reread();
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
    { label: "Situação", w: "1.2fr", render: (d) => deviceStatusLabel(d) },
    {
      label: "Ações", w: "14rem", card: "actions",
      render: (d) => {
        const open = (next: Flow) => { setMessage(null); setFlow(next); };
        const actions = [
          d.status === "revoked" ? null : (
            <ConfirmButton key="revoke" label={`Revogar ${d.name}`}
              question={`Revogar ${d.name}? O app de campo deste aparelho deixa de entrar. ${revokeLossWarning(d.last_used_at)}`}
              variant="danger" onConfirm={() => revoke(d.id)} />
          ),
          canRegister && canReplace(d) ? <ActionButton key="replace" onClick={() => open({ kind: "replace", device: d })}>{`Substituir ${d.name}`}</ActionButton> : null,
          canRegister && isAutoRevoked(d) ? <ActionButton key="again" onClick={() => open({ kind: "again", device: d })}>{`Cadastrar novo ${d.name}`}</ActionButton> : null
        ].filter(Boolean);
        return actions.length === 0 ? null : <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>;
      }
    }
  ];
  const panel = flow?.kind === "replace" ? { title: `Substituir ${flow.device.name}`, description: REPLACE_NOTICE, initial: "" }
    : flow?.kind === "again" ? { title: `Cadastrar novo ${flow.device.name}`, description: REREGISTER_NOTICE, initial: flow.device.name }
    : { title: "Cadastrar aparelho", description: REGISTER_NOTICE, initial: "" };

  return (
    <div style={stack}>
      {register}
      {flow && !off && (
        <SensitiveAction
          key={`${flow.kind}:${flow.kind === "new" ? "" : flow.device.id}`}
          title={panel.title}
          description={panel.description}
          requiresStepUp
          fields={[ { name: "name", label: "Nome do aparelho", required: true, initial: panel.initial } ]}
          run={runRegister}
          onDone={() => { setFlow(null); setShowQr(true); void reread(); }}
          onCancel={() => setFlow(null)}
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
