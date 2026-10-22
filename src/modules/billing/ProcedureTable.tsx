// src/modules/billing/ProcedureTable.tsx
// Procedimentos com a crítica (contrato §2): "faturável · BPA-I" ou "não
// faturável — motivo"; o cancelado fica na lista com a situação. Cancelar pede
// motivo (correção = cancelar e registrar de novo; spec §4). `billing` mostra
// o que o faturista precisa: paciente, estabelecimento, profissional e origem.
import { useState } from "react";
import { cancelProcedure, type PerformedProcedure } from "../../lib/api";
import { billingError, characterLabel, patientName, establishmentLabel, isStale, reasonProblem, sourceLabel } from "../../lib/billing";
import { fmtDay } from "../../lib/exams";
import { DataTable, type Column } from "../../components/DataTable";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, row } from "../exams/styles";
import { ProcedureVerdict } from "./ProcedureVerdict";

interface Props {
  rows: PerformedProcedure[];
  billing?: boolean;
  canCancel(p: PerformedProcedure): boolean;
  onChanged(message: string): void;
  // 404/409 ao cancelar: a lista mudou por outra pessoa; quem chama relê.
  onStale?(): void;
}

export function ProcedureTable({ rows, billing = false, canCancel, onChanged, onStale }: Props) {
  const [ cancelling, setCancelling ] = useState<PerformedProcedure | null>(null);
  const billingCols: Column<PerformedProcedure>[] = billing ? [
    { label: "Paciente", w: "1.2fr", render: (p) => patientName(p.patient) },
    { label: "Estabelecimento", w: "1.3fr", render: (p) => establishmentLabel(p.establishment) },
    { label: "Profissional", w: "1.3fr", render: (p) => `${p.professional.name}${p.professional.cbo_code ? ` · CBO ${p.professional.cbo_code}` : ""}` },
    { label: "Origem", w: "0.9fr", render: (p) => sourceLabel(p.source) }
  ] : [];
  const cols: Column<PerformedProcedure>[] = [
    { label: "Data", w: "0.8fr", render: (p) => fmtDay(p.performed_on) },
    { label: "Procedimento", w: "2fr", card: "title", render: (p) => (
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span>{`${p.sigtap_code} — ${p.label}`}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink2)" }}>
          {`qtd ${p.quantity}${p.cid10 ? ` · CID ${p.cid10}` : ""} · ${characterLabel(p.character)}`}
        </span>
      </span>
    ) },
    ...billingCols,
    { label: "Situação", w: "1.8fr", render: (p) => <ProcedureVerdict p={p} /> },
    { label: "", w: "auto", align: "right", card: "actions", render: (p) => (canCancel(p) && p.status === "recorded" ? (
      <button type="button" style={secondaryButtonStyle} onClick={() => setCancelling(p)}>Cancelar procedimento</button>
    ) : null) }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <DataTable<PerformedProcedure> cols={cols} rows={rows} rowKey={(p) => p.id} empty="nenhum procedimento registrado" />
      {cancelling && (
        <CancelForm key={cancelling.id} p={cancelling} onClose={() => setCancelling(null)} onStale={onStale}
          onDone={(message) => { setCancelling(null); onChanged(message); }} />
      )}
    </div>
  );
}

function CancelForm({ p, onClose, onDone, onStale }: { p: PerformedProcedure; onClose(): void; onDone(message: string): void; onStale?(): void }) {
  const [ reason, setReason ] = useState("");
  const [ error, setError ] = useState<string | null>(null);

  async function confirm() {
    const problem = reasonProblem(reason);
    if (problem) { setError(problem); return; }
    setError(null);
    try {
      await cancelProcedure(p.id, reason.trim());
      onDone(`Procedimento ${p.sigtap_code} cancelado.`);
    } catch (err) {
      setError(billingError(err));
      if (isStale(err)) onStale?.();
    }
  }

  return (
    <section aria-label={`Cancelar ${p.sigtap_code}`} style={box}>
      <label style={fieldLabel}>
        Motivo do cancelamento
        <textarea value={reason} rows={2} style={inputStyle} onChange={(e) => { setError(null); setReason(e.target.value); }} />
      </label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <ActionButton variant="danger" onClick={confirm}>Confirmar cancelamento</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Voltar</button>
      </div>
    </section>
  );
}
