// src/modules/FieldDevicesAdmin.tsx
// Tela "Aparelhos de campo da cidade" (módulo 24b, F-24.17; Q62): o administrador municipal lista os aparelhos da cidade, filtra por
// pessoa (as do próprio resultado; `user_id` na URL do api) e revoga com step-up. Nunca depende do interruptor `home_visits`.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adminRevokeFieldDevice, listAdminFieldDevices, type AdminFieldDevice } from "../lib/api";
import { FD_KEY, STATIC_QUERY, homeVisitError, homeVisitRefusals } from "../lib/homeVisits";
import { fmtDateTime } from "../lib/format";
import { HomeVisitGate } from "./homeVisits/HomeVisitGate";
import { deviceStatusLabel } from "./FieldDevices";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { SensitiveAction } from "../components/SensitiveAction";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, stack } from "./exams/styles";

export function FieldDevicesAdmin({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <HomeVisitGate title="Aparelhos de campo da cidade" sub="app de campo · aparelhos da cidade e revogação" feature={null} allow={(r) => r.admin}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </HomeVisitGate>
  );
}

function Body({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const [ userId, setUserId ] = useState("");
  const [ revoking, setRevoking ] = useState<AdminFieldDevice | null>(null);
  const list = useQuery({ queryKey: [ FD_KEY, "admin", userId ], queryFn: () => listAdminFieldDevices(userId || undefined), ...STATIC_QUERY });
  // As pessoas do filtro vêm do próprio resultado e ficam, para o filtro não encolher depois de escolher uma.
  const people = useRef(new Map<string, string>());
  for (const d of list.data ?? []) people.current.set(d.user.id, d.user.name);
  const reread = () => queryClient.invalidateQueries({ queryKey: [ FD_KEY ] });

  async function revoke(d: AdminFieldDevice) {
    try {
      await adminRevokeFieldDevice(d.id);
    } catch (err) {
      if (homeVisitRefusals(err)[0].code === "device_already_revoked") await reread();
      throw err;
    }
  }

  const cols: Column<AdminFieldDevice>[] = [
    { label: "Aparelho", w: "1.2fr", card: "title", render: (d) => d.name },
    { label: "Pessoa", w: "1.2fr", render: (d) => d.user.name },
    { label: "Cadastrado em", w: "1fr", render: (d) => fmtDateTime(d.created_at) },
    { label: "Último uso", w: "1fr", render: (d) => (d.last_used_at ? fmtDateTime(d.last_used_at) : "nunca usado") },
    { label: "Situação", w: "1.2fr", render: deviceStatusLabel },
    {
      label: "Ações", w: "9rem", card: "actions",
      render: (d) => (d.status === "revoked" ? null : <ActionButton variant="danger" onClick={() => setRevoking(d)}>{`Revogar ${d.name} de ${d.user.name}`}</ActionButton>)
    }
  ];
  const options = [ ...people.current.entries() ].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));

  return (
    <div style={stack}>
      <label style={fieldLabel}>
        Pessoa
        <select value={userId} style={inputStyle} onChange={(e) => { setUserId(e.target.value); setRevoking(null); }}>
          <option value="">Todas</option>
          {options.map(([ id, name ]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
      {revoking && (
        <SensitiveAction
          title="Revogar aparelho"
          description={`Revoga ${revoking.name}, de ${revoking.user.name}. O app de campo deste aparelho deixa de entrar.`}
          requiresStepUp
          run={async () => { await revoke(revoking); }}
          onDone={() => { setRevoking(null); void reread(); }}
          onCancel={() => setRevoking(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={homeVisitError}
        />
      )}
      {list.isError ? <p role="alert" style={alert}>{homeVisitError(list.error)}</p>
        : !list.data ? <p role="status" style={muted}>Carregando…</p>
        : <DataTable label="Aparelhos de campo da cidade" cols={cols} rows={list.data} rowKey={(d) => d.id} empty="nenhum aparelho na cidade" />}
    </div>
  );
}
