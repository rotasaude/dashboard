// src/modules/exams/OverduePanel.tsx
// Painel "Exames atrasados" (spec §5 "Alertas"): o atraso por etapa é do api
// (job diário); aqui só os filtros por etapa, prestador e exame. Na unidade,
// cada exame abre; na coordenação (cidade inteira, D15) a lista é só de
// acompanhamento — a leitura do exame segue as regras do 19a na unidade.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listEnabledProviders, listExamCatalog, listExamOrders, type ExamOrder, type ExamOrderQuery, type ExamStage } from "../../lib/api";
import {
  EXAM_CATALOG_KEY, EXAM_ORDERS_KEY, EXAM_PROVIDER_REFS_KEY, EXAM_STAGES, STAGE_LABEL, daysLateLabel, examError
} from "../../lib/exams";
import { useExamOrderPages } from "../../hooks/useExamOrderPages";
import { Panel } from "../../components/Panel";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ExamOrderDetail } from "./ExamOrderDetail";
import { alert, fieldLabel, muted, row } from "./styles";

export function OverduePanel({ unitId, canOpen }: { unitId?: string; canOpen: boolean }) {
  const [ stage, setStage ] = useState<ExamStage | "">("");
  const [ providerId, setProviderId ] = useState("");
  const [ sigtapCode, setSigtapCode ] = useState("");
  const [ open, setOpen ] = useState<string | null>(null);
  const providers = useQuery({ queryKey: [ EXAM_PROVIDER_REFS_KEY, "" ], queryFn: () => listEnabledProviders(), retry: false });
  const catalog = useQuery({ queryKey: [ EXAM_CATALOG_KEY ], queryFn: listExamCatalog, retry: false });
  const { query, orders } = useExamOrderPages(
    [ EXAM_ORDERS_KEY, "overdue", unitId ?? "city", stage, providerId, sigtapCode ],
    (before) => {
      const q: ExamOrderQuery = { overdue: true, before };
      if (unitId) q.unitId = unitId;
      if (stage) q.stage = stage;
      if (providerId) q.providerId = providerId;
      if (sigtapCode) q.sigtapCode = sigtapCode;
      return listExamOrders(q);
    });

  const cols: Column<ExamOrder>[] = [
    { label: "Código", w: "1fr", render: (o) => <span className="mono">{o.short_code}</span> },
    { label: "Paciente", w: "1.3fr", card: "title", render: (o) => o.patient.display_name },
    { label: "Exame", w: "1.6fr", render: (o) => (
      <span style={row}><span>{o.label}</span>{o.priority === "urgent" && <Tag tone="urgent">urgente</Tag>}</span>
    ) },
    { label: "Etapa", w: "0.9fr", render: (o) => (o.overdue ? STAGE_LABEL[o.overdue.stage] ?? o.overdue.stage : "—") },
    { label: "Atraso", w: "1fr", render: (o) => (o.overdue ? daysLateLabel(o.overdue.days_late) : "—") },
    { label: "Prestador", w: "1.2fr", render: (o) => o.provider?.name ?? "—" },
    ...(unitId ? [] : [ { label: "Unidade", w: "1.2fr", render: (o: ExamOrder) => o.unit.name } ]),
    ...(canOpen ? [ { label: "", w: "auto", align: "right" as const, card: "actions" as const, render: (o: ExamOrder) => (
      <button type="button" aria-label={`Abrir ${o.label} de ${o.patient.display_name}`} style={secondaryButtonStyle}
        onClick={() => setOpen(o.id)}>Abrir</button>
    ) } ] : [])
  ];
  const count = `${orders.length}${query.hasNextPage ? "+" : ""}`;

  return (
    <Panel title="Exames atrasados" sub={unitId ? "desta unidade · por etapa, prestador e exame" : "da cidade · por etapa, prestador e exame"}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...row, alignItems: "flex-end" }}>
          <label style={fieldLabel}>
            Etapa
            <select value={stage} style={inputStyle} onChange={(e) => setStage(e.target.value as ExamStage | "")}>
              <option value="">todas</option>
              {EXAM_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
            </select>
          </label>
          {providers.isSuccess && (
            <label style={fieldLabel}>
              Prestador
              <select value={providerId} style={inputStyle} onChange={(e) => setProviderId(e.target.value)}>
                <option value="">todos</option>
                {providers.data.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {catalog.isSuccess && (
            <label style={fieldLabel}>
              Exame
              <select value={sigtapCode} style={inputStyle} onChange={(e) => setSigtapCode(e.target.value)}>
                <option value="">todos</option>
                {catalog.data.map((c) => <option key={c.sigtap_code} value={c.sigtap_code}>{c.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" style={secondaryButtonStyle} disabled={query.isFetching} onClick={() => void query.refetch()}>Atualizar</button>
        </div>
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{examError(query.error)}</p>}
        {query.isSuccess && (
          <>
            <p role="status" style={muted}>{orders.length === 1 && !query.hasNextPage ? "1 exame atrasado" : `${count} exames atrasados`}</p>
            <DataTable cols={cols} rows={orders} rowKey={(o) => o.id} empty="nenhum exame atrasado com estes filtros" />
          </>
        )}
        {query.hasNextPage && (
          <div><button type="button" style={secondaryButtonStyle} onClick={() => void query.fetchNextPage()}>Carregar mais</button></div>
        )}
        {open && <ExamOrderDetail key={open} id={open} onClose={() => setOpen(null)} />}
      </div>
    </Panel>
  );
}
