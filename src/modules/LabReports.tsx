// src/modules/LabReports.tsx
// Relatórios do laboratório (spec §7; contrato §6; Divergência D13):
// produção por unidade de origem, exame, setor e liberador com quantidade e
// valor SIGTAP; rejeições por motivo e unidade; prazo de entrega (no prazo,
// atrasado, pendente). Tela e CSV; admin municipal e liberador. Sem dado de
// paciente.
import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchLabReportCsv, getLabProduction, getLabRejections, getLabTurnaround,
  type LabProductionRow, type LabRejectionRow, type LabReportKind, type LabReportQuery, type LabTurnaroundRow, type SignatureFile, listExamProviders
} from "../lib/api";
import { EXAM_ADMIN_PROVIDERS_KEY } from "../lib/exams";
import { labProviders } from "../lib/labAdmin";
import { EmptyState } from "../components/EmptyState";
import { LAB_REPORTS_KEY, labError, sectorLabel, type LabRoles } from "../lib/lab";
import { todayInCity } from "../lib/campaigns";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { ActionButton } from "../components/ActionButton";
import { inputStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { useLabContext } from "./lab/useLabContext";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";

const BLOB_TTL_MS = 60_000;
const FILE_NAME: Record<LabReportKind, string> = { production: "producao", rejections: "rejeicoes", turnaround: "prazo" };

// Centavos inteiros em reais, só com aritmética inteira (sem arredondar Float).
export function fmtCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const reais = String(Math.trunc(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}

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

export function LabReports() {
  return (
    <LabGate title="Relatórios do laboratório" sub="laboratório municipal · produção, rejeição e prazo" allow={(r) => r.admin || r.releaser} needsLab={false}>
      {(roles) => <ReportsBody roles={roles} />}
    </LabGate>
  );
}

function ReportsBody({ roles }: { roles: LabRoles }) {
  // Laboratórios que o usuário pode reportar: administrador, os prestadores com
  // laboratório municipal; só liberador, os que libera (contexto da sessão).
  const providers = useQuery({ queryKey: [ EXAM_ADMIN_PROVIDERS_KEY ], queryFn: listExamProviders, enabled: roles.admin, retry: false });
  const context = useLabContext(!roles.admin);
  const source = roles.admin ? providers : context;
  const labs = roles.admin
    ? labProviders(providers.data ?? []).map((p) => ({ id: p.id, name: p.name }))
    : (context.data?.labs ?? []).filter((l) => context.data?.releaser_of.includes(l.id));
  if (source.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (source.isError) return <p role="alert" style={alert}>{labError(source.error)}</p>;
  if (labs.length === 0) {
    return <EmptyState title="nenhum laboratório municipal para reportar" sub="marque o laboratório em Exames → Catálogo e prestadores" />;
  }
  return <ReportsView labs={labs} />;
}

function ReportsView({ labs }: { labs: { id: string; name: string }[] }) {
  const [ month, setMonth ] = useState(() => todayInCity().slice(0, 7));
  const [ providerId, setProviderId ] = useState("");
  const [ downloadError, setDownloadError ] = useState<string | null>(null);
  const busy = useRef(false);
  const [ downloading, setDownloading ] = useState(false);
  const valid = /^\d{4}-\d{2}$/.test(month);
  const q: LabReportQuery = { providerId: providerId || null, month };
  const production = useQuery({ queryKey: [ LAB_REPORTS_KEY, "production", q ], queryFn: () => getLabProduction(q), enabled: valid, retry: false });
  const rejections = useQuery({ queryKey: [ LAB_REPORTS_KEY, "rejections", q ], queryFn: () => getLabRejections(q), enabled: valid, retry: false });
  const turnaround = useQuery({ queryKey: [ LAB_REPORTS_KEY, "turnaround", q ], queryFn: () => getLabTurnaround(q), enabled: valid, retry: false });

  async function download(kind: LabReportKind) {
    if (busy.current) return;
    busy.current = true;
    setDownloading(true);
    setDownloadError(null);
    try {
      saveFile(await fetchLabReportCsv(kind, q), `laboratorio-${FILE_NAME[kind]}-${month}.csv`);
    } catch (err) {
      setDownloadError(labError(err));
    } finally {
      busy.current = false;
      setDownloading(false);
    }
  }

  const csv = (kind: LabReportKind) => (
    <ActionButton variant="secondary" busy={downloading} disabledReason={valid ? null : "escolha o mês"} onClick={() => download(kind)}>Baixar CSV</ActionButton>
  );
  const state = (query: { isPending: boolean; isError: boolean; error: unknown }, body: ReactNode) =>
    query.isError ? <p role="alert" style={alert}>{labError(query.error)}</p> : query.isPending && valid ? <p className="mono" style={muted}>carregando…</p> : body;

  return (
    <div style={stack}>
      <div style={{ ...row, alignItems: "flex-end" }}>
        <label style={fieldLabel}>Mês<input type="month" value={month} style={inputStyle} onChange={(e) => setMonth(e.target.value)} /></label>
        <label style={fieldLabel}>
          Laboratório
          <select value={providerId} style={inputStyle} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">todos</option>
            {labs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>
      {!valid && <p role="alert" style={alert}>escolha o mês</p>}
      {downloadError && <p role="alert" style={alert}>{downloadError}</p>}
      <Panel title="Produção" sub="por unidade de origem, exame, setor e liberador · quantidade e valor SIGTAP" right={csv("production")}>
        {state(production, production.data && (
          <>
            <DataTable<LabProductionRow>
              cols={[
                { label: "Unidade", w: "1.3fr", card: "title", render: (r) => r.origin_unit.name },
                { label: "Exame", w: "1.4fr", render: (r) => `${r.exam_name} (${r.sigtap_code})` },
                { label: "Setor", w: "1fr", render: (r) => sectorLabel(r.sector) },
                { label: "Liberador", w: "1.2fr", render: (r) => r.releaser?.name ?? "—" },
                { label: "Quantidade", w: "0.8fr", align: "right", render: (r) => String(r.quantity) },
                { label: "Valor SIGTAP", w: "1fr", align: "right", render: (r) => fmtCents(r.sigtap_value_cents) }
              ]}
              rows={production.data.rows} rowKey={(r, i) => `${r.origin_unit.id}:${r.sigtap_code}:${r.releaser?.id ?? "-"}:${i}`} empty="nenhum laudo liberado neste mês"
            />
            <p style={muted}>{`Total: ${production.data.total_quantity} exames · ${fmtCents(production.data.total_value_cents)}`}</p>
          </>
        ))}
      </Panel>
      <Panel title="Rejeições" sub="por motivo e unidade de origem" right={csv("rejections")}>
        {state(rejections, rejections.data && (
          <DataTable<LabRejectionRow>
            cols={[
              { label: "Motivo", w: "1.4fr", card: "title", render: (r) => r.reason.name },
              { label: "Unidade", w: "1.4fr", render: (r) => r.origin_unit.name },
              { label: "Amostras", w: "0.8fr", align: "right", render: (r) => String(r.count) }
            ]}
            rows={rejections.data} rowKey={(r) => `${r.reason.id}:${r.origin_unit.id}`} empty="nenhuma rejeição neste mês"
          />
        ))}
      </Panel>
      <Panel title="Prazo de entrega" sub="laudos no prazo, atrasados e pendentes, por exame" right={csv("turnaround")}>
        {state(turnaround, turnaround.data && (
          <DataTable<LabTurnaroundRow>
            cols={[
              { label: "Exame", w: "1.6fr", card: "title", render: (r) => `${r.exam_name} (${r.sigtap_code})` },
              { label: "No prazo", w: "0.8fr", align: "right", render: (r) => String(r.on_time) },
              { label: "Atrasados", w: "0.8fr", align: "right", render: (r) => String(r.late) },
              { label: "Pendentes", w: "0.8fr", align: "right", render: (r) => String(r.pending) }
            ]}
            rows={turnaround.data} rowKey={(r) => r.sigtap_code} empty="nenhum exame neste mês"
          />
        ))}
      </Panel>
    </div>
  );
}
