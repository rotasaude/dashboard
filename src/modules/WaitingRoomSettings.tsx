// Módulo 32a (F-32.5, F-32.1): senhas, locais e TVs, só do municipal_admin com `waiting_room_display` ligado. Escolhe-se a unidade
// (o CAPS fica de fora: caps_unit_not_allowed) e, nela, os locais de chamada e as TVs; toda escrita passa pelo step-up
// (SensitiveAction). O prefixo da senha e os tempos de espera da unidade ficam no cadastro da unidade (Atendimento → Unidades).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listActiveUnits } from "../lib/api";
import { withoutCaps } from "../lib/attendance";
import { useAuth } from "../lib/auth";
import { canUseWaitingRoom, urgencyError, WAITING_ROOM_DISABLED } from "../lib/urgency";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { inputStyle } from "../components/formStyles";
import { CallLocationsPanel } from "./waitingRoom/CallLocationsPanel";
import { DisplaysPanel } from "./waitingRoom/DisplaysPanel";
import { alert, fieldLabel, muted, stack } from "./exams/styles";

export const WAITING_ROOM_NO_ROLE = "você não tem acesso às TVs e locais da sala de espera";

export function WaitingRoomSettings({ onGoToSecurity }: { onGoToSecurity: () => void }) {
  const { user } = useAuth();
  if (!user) return null;
  const isAdmin = user.memberships.some((m) => m.role === "municipal_admin");
  let body;
  if (!canUseWaitingRoom(user)) body = <EmptyState title={WAITING_ROOM_DISABLED} />;
  else if (!isAdmin) body = <EmptyState title={WAITING_ROOM_NO_ROLE} />;
  else body = <Settings onGoToSecurity={onGoToSecurity} />;
  return (
    <div style={stack}>
      <PageHeader title="Senhas, locais e TVs" sub="Sala de espera" />
      {body}
    </div>
  );
}

function Settings({ onGoToSecurity }: { onGoToSecurity: () => void }) {
  // Mesma chave do Atendimento: a lista de unidades ativas é uma só.
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits, refetchOnWindowFocus: false });
  const choices = withoutCaps(units.data ?? []);
  const [ unitId, setUnitId ] = useState("");
  const unit = choices.find((u) => u.id === unitId) ?? null;
  return (
    <div style={stack}>
      <label style={{ ...fieldLabel, maxWidth: 360 }}>
        Unidade
        <select value={unitId} onChange={(e) => setUnitId(e.target.value)} style={inputStyle}>
          <option value="">Escolha a unidade</option>
          {choices.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      {units.isPending && <p className="mono" style={muted}>carregando…</p>}
      {units.isError && <p role="alert" style={alert}>{urgencyError(units.error)}</p>}
      {unit && <p style={muted}>O prefixo da senha fica no cadastro da unidade (Atendimento → Unidades).</p>}
      {unit && <CallLocationsPanel key={`loc-${unit.id}`} unit={unit} onGoToSecurity={onGoToSecurity} />}
      {unit && <DisplaysPanel key={`tv-${unit.id}`} unit={unit} onGoToSecurity={onGoToSecurity} />}
    </div>
  );
}
