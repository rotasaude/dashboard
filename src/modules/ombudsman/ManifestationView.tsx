// Detalhe da manifestação (módulo 33; F-33.5, F-33.7): dados, identidade por modo, texto, linha do tempo, encaminhamentos,
// anexos e o pedido de reabertura pendente. Leitura nominal (`NOMINAL_QUERY`, gcTime 0): ao sair, o detalhe sai do cache. Cada
// campo é lido pelo nome — o detalhe nunca é espalhado na tela, e a identidade é do `IdentityBlock`. Nada em storage.
// As ações da equipe (`ActionsPanel`, cancelamento do encaminhamento) respondem com o detalhe, que vai direto ao cache (sem nova
// leitura) e invalida a Caixa; tela velha relê o detalhe uma vez. Identidade e anexo protegido abrem no `IdentityDialog`, com
// justificativa; a identidade fica só no estado do diálogo (nunca no cache do detalhe).
import { useEffect, useRef, useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  cancelOmbudsmanForwarding, errorCode, getOmbudsmanManifestation,
  type OmbudsmanAttachment, type OmbudsmanForwarding, type OmbudsmanManifestation
} from "../../lib/api";
import { fmtDay } from "../../lib/careLines";
import { fmtDateTime } from "../../lib/format";
import {
  MANIFESTATION_CHANGED, NOMINAL_QUERY, OMB_DETAIL_KEY, OMB_LIST_KEY, archiveReasonLabel, channelLabel, isChanged, kindLabel, modeLabel, ombudsmanError,
  resolutionLabel, stateLabel, type OmbudsmanRoles
} from "../../lib/ombudsman";
import { KeyValue } from "../../components/KeyValue";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, grid, muted, row, stack, title } from "../exams/styles";
import { ActionsPanel } from "./ActionsPanel";
import { Attachments } from "./Attachments";
import { DeadlineTag } from "./DeadlineTag";
import { Forwardings, type CancelOutcome } from "./Forwardings";
import { IdentityBlock } from "./IdentityBlock";
import { IdentityDialog } from "./IdentityDialog";
import { Timeline } from "./Timeline";
import { ConsentForm } from "./actions/ConsentForm";
import { ReopenDecisionForm } from "./actions/ReopenDecisionForm";

// O detalhe só traz o pedido pendente; outro código aparece cru.
const reopenStateLabel = (s: string): string => (s === "pending" ? "pendente" : s);
const body = { margin: 0, whiteSpace: "pre-wrap" } as const;
// Diálogo aberto: o escopo, o anexo (no protegido) e o botão que abriu (o foco volta para ele).
type DialogOpen = { scope: "identity"; attachment?: undefined; opener: HTMLElement } | { scope: "attachment"; attachment: OmbudsmanAttachment; opener: HTMLElement };

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

function ReopenRequest({ m, roles, onChanged, onStale }: {
  m: OmbudsmanManifestation; roles: OmbudsmanRoles; onChanged(next: OmbudsmanManifestation | null): void; onStale(text: string): void;
}) {
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
        {roles.lead && m.can.decide_reopen && <ReopenDecisionForm key={r.id} requestId={r.id} onChanged={onChanged} onStale={onStale} />}
      </div>
    </Panel>
  );
}

// Consentimento do cidadão para revelar a identidade fora da ouvidoria: só o ouvidor, em qualquer modo com alguém a identificar.
function Consent({ m, roles, onChanged }: { m: OmbudsmanManifestation; roles: OmbudsmanRoles; onChanged(next: OmbudsmanManifestation | null): void }) {
  const [ open, setOpen ] = useState(false);
  useEffect(() => setOpen(false), [ m.id ]);
  if (!roles.lead || !m.can.record_identity_consent) return null;
  return (
    <Panel title="Consentimento de identificação">
      {open
        ? <ConsentForm id={m.id} onChanged={onChanged} onClose={() => setOpen(false)} />
        : <button type="button" style={buttonStyle} onClick={() => setOpen(true)}>Registrar consentimento do cidadão</button>}
    </Panel>
  );
}

// `now` fica na assinatura (a Caixa o passa), mas a cor do prazo é do api: não ligue um relógio local aqui.
export function ManifestationView({ id, roles, onBack }: { id: string; roles: OmbudsmanRoles; now?: Date; onBack(): void }) {
  const detail = useQuery({ queryKey: [ OMB_DETAIL_KEY, id ], queryFn: () => getOmbudsmanManifestation(id), ...NOMINAL_QUERY });
  const m = detail.data;
  const queryClient = useQueryClient();
  // A manifestação que está na tela; resposta que chega depois de sair (ou de trocar de id) não grava nem relê.
  const liveId = useRef<string | null>(id);
  // Frase da decisão do pedido e do consentimento quando a tela estava velha: o formulário some com o detalhe novo.
  const [ leadNotice, setLeadNotice ] = useState<string | null>(null);
  const [ dialog, setDialog ] = useState<DialogOpen | null>(null);
  useEffect(() => { setLeadNotice(null); setDialog(null); }, [ id ]);
  useEffect(() => {
    liveId.current = id;
    return () => { liveId.current = null; };
  }, [ id ]);
  // Resposta de uma ação = o detalhe novo; `null` = tela velha: uma releitura, nenhum reenvio.
  const onChanged = (next: OmbudsmanManifestation | null) => {
    if (liveId.current !== id) return;
    if (next) { queryClient.setQueryData([ OMB_DETAIL_KEY, id ], next); setLeadNotice(null); }
    else void detail.refetch();
    void queryClient.invalidateQueries({ queryKey: [ OMB_LIST_KEY ] });
  };
  // Cancelamento com o estado lido do encaminhamento (Q33). Tela velha (409 `forwarding_changed`, 422 `invalid_transition`):
  // MANIFESTATION_CHANGED e uma releitura; encaminhamento que sumiu (404): a frase dele e uma releitura.
  const cancelForwarding = async (f: OmbudsmanForwarding): Promise<CancelOutcome> => {
    try {
      onChanged(await cancelOmbudsmanForwarding(f.id, f.state));
      return null;
    } catch (err) {
      if (isChanged(err)) { onChanged(null); return { text: MANIFESTATION_CHANGED, reread: true }; }
      if (errorCode(err) === "not_found") { onChanged(null); return { text: ombudsmanError(err), reread: true }; }
      return { text: ombudsmanError(err), reread: false };
    }
  };
  // Abrir o diálogo não chama nada: `/identity` e o link do anexo só saem do envio da justificativa.
  const openIdentityDialog = (opener: HTMLElement) => setDialog({ scope: "identity", opener });
  const openProtectedAttachment = (a: OmbudsmanAttachment, opener: HTMLElement) => setDialog({ scope: "attachment", attachment: a, opener });
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
          <ActionsPanel key={m.id} m={m} roles={roles} onChanged={onChanged} />
          <IdentityBlock m={m} roles={roles} onReveal={openIdentityDialog} />
          <Consent m={m} roles={roles} onChanged={onChanged} />
          <Panel title="Texto da manifestação"><p style={body}>{m.body}</p></Panel>
          <Timeline events={m.events} />
          <Forwardings m={m} roles={roles} onCancel={cancelForwarding} />
          <Attachments m={m} roles={roles} onProtected={openProtectedAttachment} />
          {leadNotice && <p role="alert" style={alert}>{leadNotice}</p>}
          <ReopenRequest m={m} roles={roles} onChanged={onChanged} onStale={setLeadNotice} />
          {dialog && roles.lead && (
            <IdentityDialog manifestationId={m.id} scope={dialog.scope} attachment={dialog.attachment} returnFocusTo={dialog.opener}
              onClose={() => setDialog(null)} />
          )}
        </>
      )}
    </div>
  );
}
