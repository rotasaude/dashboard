// src/modules/billing/ExportsPanel.tsx
// Versões do arquivo da competência (contrato §5; Divergência B9). O arquivo
// gerado nunca muda; reabrir gera nova versão e a anterior fica aqui. Baixar é
// só do faturista (o admin vê a lista) e cada download fica na trilha
// (billing_export.downloaded). O conteúdo vai direto ao saveFile: nada em
// console, storage ou mensagem; o nome não leva dado pessoal.
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBillingExportFile, listPeriodExports, type BillingExport, type BillingPeriod } from "../../lib/api";
import { EXPORTS_KEY, billingError, exportFileName } from "../../lib/billing";
import { competenceLabel } from "../../lib/competence";
import { fmtDateTime } from "../../lib/format";
import { DataTable, type Column } from "../../components/DataTable";
import { ActionButton } from "../../components/ActionButton";
import { secondaryButtonStyle } from "../../components/formStyles";
import { saveFile } from "../lab/saveFile";
import { alert, muted, panel, row } from "../exams/styles";

export function ExportsPanel({ period, canDownload, onClose }: { period: BillingPeriod; canDownload: boolean; onClose(): void }) {
  const list = useQuery({ queryKey: [ EXPORTS_KEY, period.id ], queryFn: () => listPeriodExports(period.id), gcTime: 0, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const name = `${competenceLabel(period.competence)} · ${period.establishment.name}`;

  async function download(exp: BillingExport) {
    setNotice(null); setError(null);
    try {
      const file = await fetchBillingExportFile(exp.id);
      saveFile(file, file.filename ?? exportFileName(period, exp));
      setNotice(`Versão ${exp.version} baixada — o download fica registrado na trilha.`);
    } catch (err) {
      setError(billingError(err));
    }
  }

  const downloadCol: Column<BillingExport>[] = canDownload ? [ {
    label: "", w: "auto", align: "right", card: "actions",
    render: (e) => <ActionButton variant="secondary" onClick={() => download(e)}>{`Baixar versão ${e.version}`}</ActionButton>
  } ] : [];
  const cols: Column<BillingExport>[] = [
    { label: "Versão", w: "0.6fr", card: "title", render: (e) => `versão ${e.version}` },
    { label: "Gerado em", w: "1.1fr", render: (e) => fmtDateTime(e.generated_at) },
    { label: "Por", w: "1.1fr", render: (e) => e.generated_by },
    { label: "Linhas", w: "1fr", render: (e) => `BPA-I ${e.lines_bpa_i} · BPA-C ${e.lines_bpa_c}` },
    { label: "Conferência (SHA-256)", w: "1.3fr", render: (e) => <span className="mono" title={e.sha256}>{e.sha256.slice(0, 16)}</span> },
    ...downloadCol
  ];

  return (
    <section aria-label={`Versões de ${name}`} style={panel}>
      <div style={row}>
        <strong style={{ flex: 1 }}>{`Versões do arquivo · ${name}`}</strong>
        <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar versões</button>
      </div>
      {!canDownload && <p style={muted}>Baixar o arquivo é do faturista; aqui a administração vê as versões geradas.</p>}
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {list.isPending && <p className="mono" style={muted}>carregando…</p>}
      {list.isError && <p role="alert" style={alert}>{billingError(list.error)}</p>}
      {list.data && (
        <DataTable<BillingExport> cols={cols} rows={list.data} rowKey={(e) => e.id} empty="nenhum arquivo gerado nesta competência" />
      )}
    </section>
  );
}

const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
