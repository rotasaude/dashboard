// src/modules/lab/LabScope.tsx
// Onde a pessoa trabalha: `lab_staff` e `lab_releaser` no laboratório (escolhe entre os do
// contexto, se houver mais de um; lista vazia = LAB_NO_LAB, B32); a UBS que coleta, na unidade escolhida no
// UnitPicker. Unidade sem a marca `collects_samples` não abre nada.
import { useState, type ReactNode } from "react";
import type { HealthUnit } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { UNIT_DOES_NOT_COLLECT, labError, type LabRoles } from "../../lib/lab";
import { EmptyState } from "../../components/EmptyState";
import { inputStyle } from "../../components/formStyles";
import { UnitPicker } from "../attendance/UnitPicker";
import { useLabContext } from "./useLabContext";
import { alert, fieldLabel, muted, stack } from "../exams/styles";

export type LabScopeValue =
  | { kind: "lab"; providerId: string; providerName: string }
  | { kind: "ubs"; unit: HealthUnit; providerId: string; providerName: string };

export function LabScope({ roles, children }: { roles: LabRoles; children(scope: LabScopeValue): ReactNode }) {
  const { user } = useAuth();
  const context = useLabContext(true);
  const [ providerId, setProviderId ] = useState("");
  const [ unit, setUnit ] = useState<HealthUnit | null>(null);
  if (!user) return null;
  if (context.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (context.isError) return <p role="alert" style={alert}>{labError(context.error)}</p>;
  const labs = context.data.labs;
  // Lista vazia (B32) já é barrada pelo LabGate; aqui há ao menos um laboratório.
  const lab = labs.find((l) => l.id === providerId) ?? labs[0];
  const labPicker = labs.length > 1 && (
    <label style={fieldLabel}>
      Laboratório
      <select value={lab.id} style={inputStyle} onChange={(e) => setProviderId(e.target.value)}>
        {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
  if (roles.staff || roles.releaser) {
    return <div style={stack}>{labPicker}{children({ kind: "lab", providerId: lab.id, providerName: lab.name })}</div>;
  }
  return (
    <div style={stack}>
      <UnitPicker userId={user.id} onChange={setUnit} />
      {labPicker}
      {unit && unit.collects_samples !== true && <EmptyState title={UNIT_DOES_NOT_COLLECT} />}
      {unit && unit.collects_samples === true && children({ kind: "ubs", unit, providerId: lab.id, providerName: lab.name })}
    </div>
  );
}
