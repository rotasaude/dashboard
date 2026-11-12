// Detalhe da manifestação (módulo 33; F-33.5, F-33.7): dados, identidade por modo, texto, linha do tempo, encaminhamentos,
// anexos e o pedido de reabertura pendente. Leitura nominal (`NOMINAL_QUERY`, gcTime 0): ao sair, o detalhe sai do cache. Cada
// campo é lido pelo nome — o detalhe nunca é espalhado na tela, e a identidade é do `IdentityBlock`. Nada em storage.
// As ações (`ActionsPanel`) entram na Task 6; o diálogo de identidade e de anexo protegido, na Task 8.
import { useQuery } from "@tanstack/react-query";
import { getOmbudsmanManifestation, type OmbudsmanAttachment, type OmbudsmanManifestation } from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtDateTime } from "../../lib/format";
import {
  NOMINAL_QUERY, OMB_DETAIL_KEY, archiveReasonLabel, channelLabel, kindLabel, modeLabel, ombudsmanError, resolutionLabel, stateLabel,
  type OmbudsmanRoles
} from "../../lib/ombudsman";
import { KeyValue } from "../../components/KeyValue";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, grid, muted, row, stack, title } from "../exams/styles";
import { Attachments } from "./Attachments";
import { DeadlineTag } from "./DeadlineTag";
import { Forwardings } from "./Forwardings";
import { IdentityBlock } from "./IdentityBlock";
import { Timeline } from "./Timeline";

// O detalhe só traz o pedido pendente; outro código aparece cru.
const reopenStateLabel = (s: string): string => (s === "pending" ? "pendente" : s);
const body = { margin: 0, whiteSpace: "pre-wrap" } as const;

function channelText(m: OmbudsmanManifestation): string {
  return m.channel === "ouvidorsus" && m.ouvidorsus_number ? `${channelLabel(m.channel)} nº ${m.ouvidorsus_number}` : channelLabel(m.channel);
}
function archiveText(m: OmbudsmanManifestation): string | null {
  if (!m.archive_reason) return null;
  const reason = archiveReasonLabel(m.archive_reason);
  if (m.archive_reason === "duplicate" && m.duplicate_of) return `${reason} — original ${m.duplicate_of.protocol}`;
  if (m.archive_reason === "forwarded_elsewhere" && m.external_body_name) return `${reason} — ${m.external_body_name}`;
  return reason;
}
const subjectText = (m: OmbudsmanManifestation): string =>
  (m.subject ? (m.subject.parent ? `${m.subject.parent.name} › ${m.subject.name}` : m.subject.name) : "sem assunto");

function Data({ m }: { m: OmbudsmanManifestation }) {
  const archived = archiveText(m);
  return (
    <Panel title="Dados da manifestação">
      <div style={stack}>
        <div style={grid}>
          <KeyValue k="Tipo" v={kindLabel(m.kind)} mono={false} />
          <KeyValue k="Modo" v={modeLabel(m.identification_mode)} mono={false} />
          <KeyValue k="Canal" v={channelText(m)} mono={false} />
          <KeyValue k="Recebida em" v={fmtDateTime(m.received_at)} />
          <KeyValue k="Estado" v={stateLabel(m.state)} mono={false} />
          <KeyValue k="Prazo" v={(
            <span style={row}>
              {m.color ? <DeadlineTag color={m.color} dueOn={m.due_on} /> : <span>{fmtDay(m.due_on)}</span>}
              {m.state === "awaiting_complement" && m.complement_due_on && (
                <span>{`complemento até ${fmtDay(m.complement_due_on)}`}</span>
              )}
            </span>
          )} />
          <KeyValue k="Assunto" v={subjectText(m)} mono={false} />
          <KeyValue k="Unidade" v={m.health_unit?.name ?? "—"} mono={false} />
          <KeyValue k="Profissional" v={m.referred_professional?.name ?? "—"} mono={false} />
          <KeyValue k="Ciclo" v={String(m.cycle)} />
          <KeyValue k="Prorrogada" v={m.extended ? "sim" : "não"} mono={false} />
          {m.resolution && <KeyValue k="Resolutividade" v={resolutionLabel(m.resolution)} mono={false} />}
          {m.concluded_at && <KeyValue k="Concluída em" v={fmtDateTime(m.concluded_at)} />}
          {archived && <KeyValue k="Motivo do arquivamento" v={archived} mono={false} />}
        </div>
        {m.extended && m.extension_reason && (
          <div>
            <p style={muted}>Motivo da prorrogação</p>
            <p style={body}>{m.extension_reason}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ReopenRequest({ m }: { m: OmbudsmanManifestation }) {
  const r = m.reopen_request;
  if (!r) return null;
  return (
    <Panel title="Pedido de reabertura">
      <div style={stack}>
        <div style={grid}>
          <KeyValue k="Estado" v={reopenStateLabel(r.state)} mono={false} />
          <KeyValue k="Pedido em" v={fmtDateTime(r.created_at)} />
          <KeyValue k="Ciclo" v={String(r.cycle)} />
        </div>
        <div>
          <p style={muted}>Motivo</p>
          <p style={body}>{r.reason}</p>
        </div>
      </div>
    </Panel>
  );
}

// `now` fica na assinatura (a Caixa o passa), mas a cor do prazo é do api: não ligue um relógio local aqui.
export function ManifestationView({ id, roles, onBack }: { id: string; roles: OmbudsmanRoles; now?: Date; onBack(): void }) {
  const detail = useQuery({ queryKey: [ OMB_DETAIL_KEY, id ], queryFn: () => getOmbudsmanManifestation(id), ...NOMINAL_QUERY });
  const m = detail.data;
  // Ganchos do diálogo da Task 8 (identidade e anexo protegido, com justificativa). Aqui nada chama `/identity` nem o anexo.
  const openIdentityDialog = () => {};
  const openProtectedAttachment = (_a: OmbudsmanAttachment) => {};
  return (
    <div style={stack}>
      <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onBack}>Voltar à caixa</button></div>
      {detail.isPending && <p className="mono" style={muted}>carregando…</p>}
      {detail.isError && <p role="alert" style={alert}>{ombudsmanError(detail.error)}</p>}
      {m && (
        <>
          <div style={row}>
            <h2 style={title}>{`Manifestação ${m.protocol}`}</h2>
            {m.urgent && <Tag tone="down">urgente</Tag>}
          </div>
          <Data m={m} />
          {/* ActionsPanel (Task 6) entra aqui. */}
          <IdentityBlock m={m} roles={roles} onReveal={openIdentityDialog} />
          <Panel title="Texto da manifestação"><p style={body}>{m.body}</p></Panel>
          <Timeline events={m.events} />
          <Forwardings m={m} />
          <Attachments m={m} roles={roles} onProtected={openProtectedAttachment} />
          <ReopenRequest m={m} />
        </>
      )}
    </div>
  );
}
