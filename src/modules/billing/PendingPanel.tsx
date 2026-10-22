// src/modules/billing/PendingPanel.tsx
// Pendências da competência (contrato §5; Divergência B6): críticas
// recalculadas com o cadastro de agora, agrupadas pelo que corrigir. A rota
// grava trilha (contém paciente): lê ao abrir e no "Conferir de novo", nunca
// sozinha. Corrigido o cadastro, a pendência sai sem relançar (spec §2).
import { useQuery } from "@tanstack/react-query";
import { getPeriodPending, type BillingPeriod, type PendingItem } from "../../lib/api";
import { LATE_TEXT, PENDING_KEY, billingError, establishmentLabel, fixInfo, groupPending, reasonLabel } from "../../lib/billing";
import { competenceLabel } from "../../lib/competence";
import { fmtDay } from "../../lib/exams";
import { DataTable, type Column } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { alert, box, muted, panel, row } from "../exams/styles";

const COLS: Column<PendingItem>[] = [
  { label: "Data", w: "0.8fr", render: (i) => fmtDay(i.performed_on ?? null) },
  { label: "Procedimento", w: "2fr", card: "title", render: (i) => (
    <>
      {i.sigtap_code ? `${i.sigtap_code} — ${i.label ?? ""}` : i.procedure_id}
      {i.late && <> <Tag tone="info" mono={false}>{LATE_TEXT}</Tag></>}
    </>
  ) },
  { label: "Paciente", w: "1.2fr", render: (i) => i.patient?.display_name ?? "—" },
  { label: "Profissional", w: "1.2fr", render: (i) => i.professional?.name ?? "—" },
  { label: "Motivo", w: "2fr", render: (i) => i.reasons.map(reasonLabel).join("; ") }
];

export function PendingPanel({ period, onClose }: { period: BillingPeriod; onClose(): void }) {
  const query = useQuery({
    queryKey: [ PENDING_KEY, period.id ], queryFn: () => getPeriodPending(period.id), gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false
  });
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
      {query.isPending && <p className="mono" style={muted}>conferindo…</p>}
      {query.isError && <p role="alert" style={alert}>{billingError(query.error)}</p>}
      {query.isSuccess && groups.length === 0 && <EmptyState title="nenhuma pendência nesta competência" />}
      {groups.map((g) => {
        const info = fixInfo(g.fix);
        return (
          <section key={g.fix} aria-label={info.title} style={box}>
            <strong>{`${info.title} · ${g.items.length}`}</strong>
            {info.hint && <p style={muted}>{info.hint}</p>}
            <DataTable<PendingItem> cols={COLS} rows={g.items} rowKey={(i) => i.procedure_id} />
          </section>
        );
      })}
    </section>
  );
}
