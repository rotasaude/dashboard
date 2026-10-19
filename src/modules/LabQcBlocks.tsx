// Bloqueios do CIQ (spec §5.4–§5.7 e §5.9; contrato §3): ativos e encerrados,
// ação corretiva, exceções concedidas no mês e revisões. O contador do menu é
// a rota /count (Task 4); estas listas leem ao abrir e depois de cada ação,
// sem polling (as rotas gravam trilha).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listLabExams, listLabInstruments, listQcBlocks, listQcExceptions, listQcMaterials, type QcBlock, type QcException } from "../lib/api";
import {
  QC_BLOCKS_KEY, QC_DISABLED, QC_EXAMS_KEY, QC_EXCEPTIONS_KEY, QC_INSTRUMENTS_KEY, QC_MATERIALS_KEY, materialAnalyteName, qcError, refreshQc
} from "../lib/qc";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import type { ModuleId } from "../shell/modules";
import { SegmentedControl } from "../shell/SegmentedControl";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { CorrectiveActionForm } from "./qc/CorrectiveActionForm";
import { ReviewsPanel } from "./qc/ReviewsPanel";
import { alert, fieldLabel, okText, stack } from "./exams/styles";

const READ_ONCE = { gcTime: 0, staleTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } as const;
const STATUS_TABS: { key: "active" | "closed"; label: string }[] = [ { key: "active", label: "ativos" }, { key: "closed", label: "encerrados" } ];

export function LabQcBlocks({ onNavigate, onGoToSecurity }: { onNavigate(id: ModuleId): void; onGoToSecurity?(): void }) {
  return (
    <LabGate title="Bloqueios e revisões do CIQ" sub="CIQ · bloqueios, ação corretiva, exceções concedidas e revisões"
      allow={(r) => r.staff || r.releaser} requires={[ "lab_quality_control" ]} disabledText={QC_DISABLED}>
      {() => <LabPick>{(lab) => <BlocksBody providerId={lab.id} lead={lab.lead} onNavigate={onNavigate} onGoToSecurity={onGoToSecurity} />}</LabPick>}
    </LabGate>
  );
}

function BlocksBody({ providerId, lead, onNavigate, onGoToSecurity }: {
  providerId: string; lead: boolean; onNavigate(id: ModuleId): void; onGoToSecurity?(): void;
}) {
  const queryClient = useQueryClient();
  const [ status, setStatus ] = useState<"active" | "closed">("active");
  const [ month, setMonth ] = useState(() => todayInCity().slice(0, 7));
  const blocks = useQuery({ queryKey: [ QC_BLOCKS_KEY, providerId, status ], queryFn: () => listQcBlocks(status, providerId), ...READ_ONCE });
  const exceptions = useQuery({
    queryKey: [ QC_EXCEPTIONS_KEY, providerId, month ], queryFn: () => listQcExceptions(providerId, month), enabled: /^\d{4}-\d{2}$/.test(month), ...READ_ONCE
  });
  const instruments = useQuery({ queryKey: [ QC_INSTRUMENTS_KEY, providerId, "lab" ], queryFn: () => listLabInstruments(providerId), retry: false });
  const exams = useQuery({ queryKey: [ QC_EXAMS_KEY, providerId ], queryFn: () => listLabExams(providerId), retry: false });
  const materials = useQuery({ queryKey: [ QC_MATERIALS_KEY, providerId ], queryFn: () => listQcMaterials(providerId), retry: false });
  const [ acting, setActing ] = useState<QcBlock | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const instrument = (id: string) => (instruments.data ?? []).find((i) => i.id === id)?.name ?? id;
  const analyte = (key: string) => materialAnalyteName(materials.data ?? [], exams.data ?? [], key);
  const label = (b: { instrument_id: string; analyte_key: string }) => `${instrument(b.instrument_id)} · ${analyte(b.analyte_key)}`;
  const refresh = () => { void refreshQc(queryClient).catch(() => undefined); };

  return (
    <div style={stack}>
      {notice && <p role="status" style={okText}>{notice}</p>}
      <Panel title="Bloqueios" sub="analito bloqueado no aparelho: a liberação desses exames fica presa"
        right={<SegmentedControl options={STATUS_TABS} value={status} onChange={(s) => { setStatus(s); setActing(null); }} />}>
        <div style={stack}>
          {blocks.isError ? <p role="alert" style={alert}>{qcError(blocks.error)}</p> : (
            <DataTable<QcBlock>
              cols={[
                { label: "Aparelho · analito", w: "1.6fr", card: "title", render: (b) => label(b) },
                { label: "Aberto", w: "1fr", render: (b) => fmtDateTime(b.opened_at) },
                { label: "Ação corretiva", w: "1.8fr", render: (b) => b.corrective_action ?? "—" },
                { label: status === "closed" ? "Encerrado" : "", w: "auto", card: "actions", render: (b) => (status === "closed"
                  ? fmtDateTime(b.closed_at)
                  : !b.corrective_action && (
                    <button type="button" style={secondaryButtonStyle} onClick={() => { setActing(b); setNotice(null); }}>Registrar ação corretiva</button>
                  )) }
              ]}
              rows={blocks.data ?? []} rowKey={(b) => b.id}
              empty={blocks.isPending ? "carregando…" : status === "active" ? "nenhum bloqueio ativo" : "nenhum bloqueio encerrado"}
            />
          )}
          {acting && (
            <CorrectiveActionForm key={acting.id} block={acting} label={label(acting)} onCancel={() => setActing(null)} onStale={refresh}
              onDone={() => {
                setActing(null);
                setNotice("Ação corretiva registrada. O bloqueio fecha sozinho na próxima corrida aprovada com todos os níveis.");
                refresh();
              }} />
          )}
        </div>
      </Panel>
      <Panel title="Exceções concedidas" sub="itens liberados pelo RT ou substituto com o analito bloqueado"
        right={<label style={fieldLabel}>Mês<input type="month" value={month} style={inputStyle} onChange={(e) => setMonth(e.target.value)} /></label>}>
        {exceptions.isError ? <p role="alert" style={alert}>{qcError(exceptions.error)}</p> : (
          <DataTable<QcException>
            cols={[
              { label: "Requisição", w: "0.9fr", card: "title", render: (e) => <span className="mono">{e.requisition_number}</span> },
              { label: "Exame", w: "1fr", render: (e) => e.exam_label },
              { label: "Aparelho · analito", w: "1.4fr", render: (e) => label(e) },
              { label: "Justificativa", w: "2fr", render: (e) => e.justification },
              { label: "Por", w: "1fr", render: (e) => e.granted_by ?? "—" },
              { label: "Quando", w: "1fr", render: (e) => fmtDateTime(e.granted_at) }
            ]}
            rows={exceptions.data ?? []} rowKey={(e) => e.id}
            empty={!/^\d{4}-\d{2}$/.test(month) ? "escolha o mês" : exceptions.isPending ? "carregando…" : "nenhuma exceção neste mês"}
          />
        )}
      </Panel>
      <ReviewsPanel providerId={providerId} lead={lead} analyte={analyte} instrument={instrument} onNavigate={onNavigate} onGoToSecurity={onGoToSecurity} />
    </div>
  );
}
