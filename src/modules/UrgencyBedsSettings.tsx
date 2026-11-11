// Módulo 32b (D1): leitos da observação da UPA, só do municipal_admin com `urgency_care` (+ `clinical_record`). Portão, escolha da
// UPA (só kind "upa", mesma chave `activeUnits` do Atendimento) e o cadastro de leitos (BedsAdmin, com step-up).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listActiveUnits } from "../lib/api";
import { useAuth } from "../lib/auth";
import { canUseUrgency, isUpa, urgencyError, URGENCY_DISABLED } from "../lib/urgency";
import { STATIC_QUERY } from "../lib/psychosocial";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { inputStyle } from "../components/formStyles";
import { BedsAdmin } from "./urgency/BedsAdmin";
import { alert, fieldLabel, muted, stack } from "./exams/styles";

export const URGENCY_BEDS_NO_ROLE = "você não tem acesso aos leitos de observação";

export function UrgencyBedsSettings({ onGoToSecurity }: { onGoToSecurity: () => void }) {
  const { user } = useAuth();
  if (!user) return null;
  const isAdmin = user.memberships.some((m) => m.role === "municipal_admin");
  let body;
  if (!canUseUrgency(user)) body = <EmptyState title={URGENCY_DISABLED} />;
  else if (!isAdmin) body = <EmptyState title={URGENCY_BEDS_NO_ROLE} />;
  else body = <UpaBeds onGoToSecurity={onGoToSecurity} />;
  return (
    <div style={stack}>
      <PageHeader title="Leitos de observação" sub="UPA" />
      {body}
    </div>
  );
}

function UpaBeds({ onGoToSecurity }: { onGoToSecurity: () => void }) {
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits, ...STATIC_QUERY });
  const [ unitId, setUnitId ] = useState("");
  const upas = (units.data ?? []).filter(isUpa);
  const unit = upas.find((u) => u.id === unitId);
  return (
    <div style={stack}>
      <Panel title="Unidade" sub="os leitos são de cada UPA">
        {units.isPending && <p className="mono" style={muted}>carregando…</p>}
        {units.isError && <p role="alert" style={alert}>{urgencyError(units.error)}</p>}
        {units.data && upas.length === 0 && <p style={muted}>nenhuma UPA ativa</p>}
        {upas.length > 0 && (
          <label style={{ ...fieldLabel, maxWidth: 320 }}>
            UPA
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} style={inputStyle}>
              <option value="">escolha a UPA</option>
              {upas.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
      </Panel>
      {unit && <BedsAdmin key={unit.id} unit={unit} onGoToSecurity={onGoToSecurity} />}
    </div>
  );
}
