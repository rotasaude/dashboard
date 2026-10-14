// src/modules/ExamReport.tsx
// Relatório de conferência (módulo 21a; spec §6 e decisão 8; contrato §5):
// por prestador e mês — autorizadas, coletadas, resultado no prazo e em
// atraso, pendentes. Tela e CSV; o detalhado leva só short_code, SIGTAP e
// datas. Admin municipal e regulador (D14).
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchExamReportCsv, getExamReport, listEnabledProviders, type ExamReportRow, type SignatureFile } from "../lib/api";
import { useAuth } from "../lib/auth";
import { todayInCity } from "../lib/campaigns";
import { EXAMS_DISABLED, EXAMS_NO_ROLE, EXAM_PROVIDER_REFS_KEY, EXAM_REPORT_KEY, canUseExams, examError, examRoles } from "../lib/exams";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { ActionButton } from "../components/ActionButton";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

const BLOB_TTL_MS = 60_000;

// O api manda o mesmo nome para resumo e detalhado; a tela sempre monta o seu.
function saveFile(file: SignatureFile, name: string) {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_TTL_MS);
}

export function ExamReport() {
  const { user } = useAuth();
  const roles = examRoles(user);
  const allowed = canUseExams(user) && (roles.admin || roles.regulator);
  const [ month, setMonth ] = useState(() => todayInCity().slice(0, 7));
  const [ providerId, setProviderId ] = useState("");
  const [ downloadError, setDownloadError ] = useState<string | null>(null);
  const validMonth = /^\d{4}-\d{2}$/.test(month);
  const providers = useQuery({ queryKey: [ EXAM_PROVIDER_REFS_KEY, "" ], queryFn: () => listEnabledProviders(), enabled: allowed, retry: false });
  const report = useQuery({
    queryKey: [ EXAM_REPORT_KEY, month, providerId ], queryFn: () => getExamReport(month, providerId || null),
    enabled: allowed && validMonth, retry: false
  });

  if (!user) return null;
  if (!canUseExams(user)) return <Frame><EmptyState title={EXAMS_DISABLED} /></Frame>;
  if (!allowed) return <Frame><EmptyState title={EXAMS_NO_ROLE} /></Frame>;

  async function download(detail: boolean) {
    setDownloadError(null);
    try {
      const file = await fetchExamReportCsv(month, providerId || null, detail);
      saveFile(file, `conferencia-exames-${month}${detail ? "-detalhado" : ""}.csv`);
    } catch (err) {
      setDownloadError(examError(err));
    }
  }

  const n = (v: number) => String(v);
  return (
    <Frame>
      <Panel title="Conferência por prestador" sub="guias autorizadas, coletadas e resultados no prazo e em atraso">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ ...row, alignItems: "flex-end" }}>
            <label style={fieldLabel}>
              Mês
              <input type="month" value={month} style={inputStyle} onChange={(e) => setMonth(e.target.value)} />
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
          </div>
          {!validMonth && <p role="alert" style={alert}>escolha o mês</p>}
          {report.isPending && validMonth && <p className="mono" style={muted}>carregando…</p>}
          {report.isError && <p role="alert" style={alert}>{examError(report.error)}</p>}
          {report.isSuccess && (
            <DataTable<ExamReportRow>
              cols={[
                { label: "Prestador", w: "1.8fr", card: "title", render: (r) => r.provider.name },
                { label: "Autorizadas", w: "0.9fr", align: "right", render: (r) => n(r.authorized) },
                { label: "Coletadas", w: "0.9fr", align: "right", render: (r) => n(r.collected) },
                { label: "Resultado no prazo", w: "1fr", align: "right", render: (r) => n(r.resulted_on_time) },
                { label: "Resultado em atraso", w: "1fr", align: "right", render: (r) => n(r.resulted_late) },
                { label: "Pendentes", w: "0.9fr", align: "right", render: (r) => n(r.pending) }
              ]}
              rows={report.data} rowKey={(r) => r.provider.id} empty="nenhuma guia neste mês"
            />
          )}
          <div style={row}>
            <ActionButton variant="secondary" disabledReason={validMonth ? null : "escolha o mês"} onClick={() => download(false)}>Baixar CSV</ActionButton>
            <ActionButton variant="secondary" disabledReason={validMonth ? null : "escolha o mês"} onClick={() => download(true)}>Baixar CSV detalhado</ActionButton>
          </div>
          <p style={muted}>O CSV detalhado traz só o código do exame, o SIGTAP e as datas — nenhum dado do paciente.</p>
          {downloadError && <p role="alert" style={alert}>{downloadError}</p>}
        </div>
      </Panel>
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={stack}>
      <PageHeader title="Conferência de exames" sub="por prestador e mês · sem BPA-I" />
      {children}
    </div>
  );
}
