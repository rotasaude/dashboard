// src/modules/billing/PendingPanel.tsx
// Pendências da competência (contrato §5; Divergência B6): críticas
// recalculadas com o cadastro de agora, agrupadas pelo que corrigir. A rota
// grava trilha (contém paciente): lê ao abrir, no "Conferir de novo" e depois
// de o faturista completar raça/cor ou endereço (ação explícita; contrato §12,
// D-U1) — nunca sozinha. Corrigido o cadastro, a pendência sai sem relançar (spec §2).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPeriodPending, updatePatientDemographics, type BillingPeriod, type PendingItem } from "../../lib/api";
import { LATE_TEXT, PENDING_KEY, patientName, billingError, demographicsMissingOf, establishmentLabel, fixInfo, groupPending, reasonLabel } from "../../lib/billing";
import { competenceLabel } from "../../lib/competence";
import { fmtDay } from "../../lib/exams";
import { DataTable, type Column } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { DemographicsForm } from "../attendance/DemographicsForm";
import { alert, box, muted, panel, row } from "../exams/styles";

const columns = (canFix: boolean, onFix: (i: PendingItem) => void): Column<PendingItem>[] => [
  { label: "Data", w: "0.8fr", render: (i) => fmtDay(i.performed_on ?? null) },
  { label: "Procedimento", w: "2fr", card: "title", render: (i) => (
    <>
      {i.sigtap_code ? `${i.sigtap_code} — ${i.label ?? ""}` : i.procedure_id}
      {i.late && <> <Tag tone="info" mono={false}>{LATE_TEXT}</Tag></>}
    </>
  ) },
  { label: "Paciente", w: "1.2fr", render: (i) => i.patient ? patientName(i.patient) : "—" },
  { label: "Profissional", w: "1.2fr", render: (i) => i.professional?.name ?? "—" },
  { label: "Motivo", w: "2fr", render: (i) => i.reasons.map(reasonLabel).join("; ") },
  ...(canFix ? [ { label: "", w: "auto", align: "right" as const, card: "actions" as const, render: (i: PendingItem) => (
    i.patient && demographicsMissingOf(i.reasons).length > 0
      ? <ActionButton variant="secondary" onClick={() => onFix(i)}>Completar dados</ActionButton> : null
  ) } ] : [])
];

export function PendingPanel({ period, onClose, canFix = false }: { period: BillingPeriod; onClose(): void; canFix?: boolean }) {
  const query = useQuery({
    queryKey: [ PENDING_KEY, period.id ], queryFn: () => getPeriodPending(period.id), gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false
  });
  const [ fixing, setFixing ] = useState<PendingItem | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const cols = columns(canFix, (i) => { setNotice(null); setFixing(i); });
  const groups = groupPending(query.data ?? []);
  return (
    <section aria-label={`Pendências de ${competenceLabel(period.competence)} · ${period.establishment.name}`} style={panel}>
      <div style={row}>
        <strong style={{ flex: 1 }}>{`Pendências de ${competenceLabel(period.competence)} · ${establishmentLabel(period.establishment)}`}</strong>
        <ActionButton variant="secondary" onClick={async () => { await query.refetch(); }}>Conferir de novo</ActionButton>
        <ActionButton variant="secondary" onClick={onClose}>Fechar pendências</ActionButton>
      </div>
      <p style={muted}>
        As críticas são recalculadas com o cadastro de agora. Corrigido o cadastro, a pendência sai daqui — nada precisa ser relançado.
        Pendência não entra no arquivo.
      </p>
      {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{notice}</p>}
      {query.isPending && <p className="mono" style={muted}>conferindo…</p>}
      {query.isError && <p role="alert" style={alert}>{billingError(query.error)}</p>}
      {query.isSuccess && groups.length === 0 && <EmptyState title="nenhuma pendência nesta competência" />}
      {groups.map((g) => {
        const info = fixInfo(g.fix);
        return (
          <section key={g.fix} aria-label={info.title} style={box}>
            <strong>{`${info.title} · ${g.items.length}`}</strong>
            {info.hint && <p style={muted}>{info.hint}</p>}
            <DataTable<PendingItem> cols={cols} rows={g.items} rowKey={(i) => i.procedure_id} />
          </section>
        );
      })}
      {fixing?.patient && (
        <DemographicsForm key={fixing.procedure_id} title={`Completar dados de ${patientName(fixing.patient)}`}
          missing={demographicsMissingOf(fixing.reasons)}
          save={(body) => updatePatientDemographics(fixing.patient!.id, body)}
          onSaved={() => {
            setNotice(`Dados de ${patientName(fixing.patient)} salvos; as pendências foram conferidas de novo.`);
            setFixing(null);
            void query.refetch();
          }}
          onCancel={() => setFixing(null)} />
      )}
    </section>
  );
}
