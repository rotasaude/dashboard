import { useQuery } from "@tanstack/react-query";
import { listCampaigns, type CampaignSummary } from "../../lib/api";
import { CAMPAIGNS_KEY, STATUS_LABEL, STATUS_TONE, campaignError } from "../../lib/campaigns";
import { fmtDateTime, fmtNumber } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alertStyle, noteStyle } from "./styles";

export function sendLabel(c: CampaignSummary): string {
  if (c.status === "scheduled" && c.send_at) return `agendada para ${fmtDateTime(c.send_at)}`;
  if (c.dispatched_at) return fmtDateTime(c.dispatched_at);
  return "—";
}

export function CampaignList({ onNew, onOpen }: { onNew(): void; onOpen(c: CampaignSummary): void }) {
  const list = useQuery({ queryKey: CAMPAIGNS_KEY, queryFn: listCampaigns });
  return (
    <Panel title="Lista" sub="mais novas primeiro"
      right={<button type="button" style={buttonStyle} onClick={onNew}>Nova campanha</button>}>
      {list.isError ? <p role="alert" style={alertStyle}>{campaignError(list.error)}</p>
        : list.isPending ? <p className="mono" style={noteStyle}>carregando…</p>
        : (
          <DataTable<CampaignSummary>
            cols={[
              { label: "Título", w: "3fr", render: (c) => (
                <button type="button" aria-label={`Abrir ${c.title}`} onClick={() => onOpen(c)}
                  style={{ ...secondaryButtonStyle, border: "none", textAlign: "left" }}>
                  {c.title}
                </button>
              ) },
              { label: "Status", w: "1fr", render: (c) => <Tag tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Tag> },
              { label: "Envio", w: "2fr", render: (c) => sendLabel(c) },
              { label: "Destinatários", w: "1fr", align: "right", render: (c) => <span className="mono">{fmtNumber(c.recipients_count)}</span> }
            ]}
            rows={list.data}
            rowKey={(c) => c.id}
            empty="nenhuma campanha ainda — crie a primeira"
          />
        )}
    </Panel>
  );
}
