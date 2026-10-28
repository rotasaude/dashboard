// src/modules/regulation/RequestDetail.tsx
// Detalhe do pedido e decisões do regulador (módulo 26a; F-26.3): autorizar (oferta com saldo), devolver, negar e
// cancelar, pelas ações da situação (`actionsFor`). A leitura é nominal e grava trilha: nunca relê sozinha (NOMINAL_QUERY),
// só no "Recarregar". O detalhe nunca mostra posição na fila. `stale_version` e `invalid_transition` deixam o formulário
// aberto e oferecem "Recarregar". Depois de uma decisão, `onChanged(frase)` devolve à fila (que relê); "Voltar à fila"
// avisa por `onBack(changed)` se houve decisão, para a fila reler só quando precisa. `extra` é o espaço das Tasks 12 e 13.
import { useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelRegulationRequest, denyRegulationRequest, errorCode, getRegulationRequest, returnRegulationRequest,
  type RegulationRequest
} from "../../lib/api";
import {
  NOMINAL_QUERY, REG_DETAIL_KEY, actionsFor, colorLabel, colorTone, dueText, monthLabel, providerKindLabel, regulationError, statusLabel,
  statusTone, systemLabel, typeLabel, waitDays, waitText
} from "../../lib/regulation";
import { cityIsoDate, fmtDateTime } from "../../lib/format";
import { patientDocument } from "../../lib/patientDocument";
import { KeyValue } from "../../components/KeyValue";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, grid, list, muted, row, stack, title } from "../exams/styles";
import { AuthorizeForm } from "./AuthorizeForm";
import { ReasonAction } from "./ReasonAction";
import { openGuide } from "./openGuide";

type Mode = "authorize" | "return" | "deny" | "cancel" | null;

const NO_NAME = "pessoa sem nome no cadastro";
const dash = (v: string | null | undefined) => (v && v.trim() !== "" ? v : "—");

// Contexto do `extra` (Tasks 12 e 13): o pedido lido e `applied`, que grava no cache o pedido devolvido por uma ação
// que deixa o detalhe aberto (agendar, desfecho, número externo) e marca que a fila mudou, sem leitura nominal a mais.
export interface DetailContext { request: RegulationRequest; applied(updated: RegulationRequest): void }

export function RequestDetail({ id, today, onBack, onChanged, extra }: {
  id: string; today?: string; onBack(changed: boolean): void; onChanged(text: string): void; extra?: (ctx: DetailContext) => ReactNode;
}) {
  const queryClient = useQueryClient();
  const day = today ?? cityIsoDate();
  const detail = useQuery({ queryKey: [ REG_DETAIL_KEY, id ], queryFn: () => getRegulationRequest(id), ...NOMINAL_QUERY });
  const [ mode, setMode ] = useState<Mode>(null);
  const [ stale, setStale ] = useState<string | null>(null);
  const [ guideError, setGuideError ] = useState<string | null>(null);
  const changed = useRef(false);
  const request = detail.data;

  const done = (text: string) => { changed.current = true; onChanged(text); };
  const applied = (updated: RegulationRequest) => { changed.current = true; queryClient.setQueryData([ REG_DETAIL_KEY, id ], updated); };
  const reload = () => { void detail.refetch().then((r) => { if (!r.isError) setStale(null); }); };
  const guide = async () => {
    setGuideError(null);
    const out = await openGuide(id);
    if (!out.ok) setGuideError(out.text);
  };

  // Recusa de versão ou de situação: a tela fica como está, com a frase e o "Recarregar".
  const reasonAction = (r: RegulationRequest, run: (reason: string, version: number) => Promise<unknown>, text: string) => async (reason: string) => {
    try {
      await run(reason, r.version);
    } catch (err) {
      const code = errorCode(err);
      if (code === "stale_version" || code === "invalid_transition") { setStale(regulationError(err)); return; }
      throw err;
    }
    done(text);
  };

  if (!request) {
    return (
      <div style={stack}>
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={() => onBack(changed.current)}>Voltar à fila</button></div>
        {detail.isPending && <p style={muted}>carregando…</p>}
        {detail.isError && (
          <div style={row}>
            <p role="alert" style={alert}>{regulationError(detail.error)}</p>
            <button type="button" style={secondaryButtonStyle} onClick={reload}>Recarregar</button>
          </div>
        )}
      </div>
    );
  }

  const actions = actionsFor(request);
  const doc = patientDocument(request.patient);
  const auth = request.authorization;
  const cancelText = auth && request.outcome === null ? "Pedido cancelado; a vaga volta para a cota do mês." : "Pedido cancelado.";
  const close = () => setMode(null);
  // O formulário aberto só vale enquanto a situação lida ainda permite a ação (um "Recarregar" pode ter mudado isso).
  const allowed: Record<Exclude<Mode, null>, boolean> = {
    authorize: actions.authorize, return: actions.returnBack, deny: actions.deny, cancel: actions.cancel
  };
  const active: Mode = mode && allowed[mode] ? mode : null;

  return (
    <section aria-label={request.target.name} style={stack}>
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} onClick={() => onBack(changed.current)}>Voltar à fila</button>
        <button type="button" style={secondaryButtonStyle} onClick={() => void guide()}>Guia em PDF</button>
      </div>
      <h3 style={title}>{request.target.name}</h3>
      <div style={grid}>
        <KeyValue k="Paciente" v={request.patient.display_name || NO_NAME} mono={false} />
        <KeyValue k={doc.k} v={doc.v} />
        <KeyValue k="Tipo" v={typeLabel(request.type)} mono={false} />
        <KeyValue k="Alvo" v={`${request.target.code} — ${request.target.name}`} />
        <KeyValue k="CID-10" v={dash(request.cid10)} />
        <KeyValue k="CIAP-2" v={dash(request.ciap2)} />
        <KeyValue k="Situação" v={<Tag tone={statusTone(request.status)}>{statusLabel(request.status)}</Tag>} />
        <KeyValue k="Cor sugerida" v={<Tag tone={colorTone(request.suggested_color)}>{colorLabel(request.suggested_color)}</Tag>} />
        <KeyValue k="Cor confirmada" v={<Tag tone={colorTone(request.color)}>{colorLabel(request.color)}</Tag>} />
        {request.color_reason && <KeyValue k="Motivo da mudança de cor" v={request.color_reason} mono={false} />}
        <KeyValue k="Solicitante" v={request.requester.name} mono={false} />
        <KeyValue k="Unidade" v={dash(request.requester.unit?.name)} mono={false} />
        <KeyValue k="Pedido em" v={fmtDateTime(request.requested_at)} />
        <KeyValue k="Espera" v={request.requested_at ? waitText(waitDays(request.requested_at, day)) : "—"} />
        <KeyValue k="Prazo" v={request.overdue ? <Tag tone="down">{dueText(request.due_on, true, day)}</Tag> : dueText(request.due_on, false, day)} />
        <KeyValue k="Faltas" v={String(request.misses)} />
        <KeyValue k="Número externo" v={request.external ? `${systemLabel(request.external.system)} ${request.external.number}` : "—"} />
      </div>
      <div>
        <p className="mono" style={muted}>Justificativa</p>
        <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap" }}>{request.justification}</p>
      </div>
      {auth && (
        <div style={grid}>
          <KeyValue k="Autorizado em" v={auth.provider.name} mono={false} />
          <KeyValue k="Tipo do prestador" v={providerKindLabel(auth.provider.kind)} mono={false} />
          <KeyValue k="Mês da cota" v={monthLabel(auth.month)} mono={false} />
          <KeyValue k="Autorizado por" v={`${auth.by.name} · ${fmtDateTime(auth.at)}`} mono={false} />
          {auth.skip_reason && <KeyValue k="Motivo da autorização fora da ordem" v={auth.skip_reason} mono={false} />}
        </div>
      )}
      {request.schedule && (
        <div style={grid}>
          <KeyValue k="Agendamento" v={fmtDateTime(request.schedule.at)} />
          <KeyValue k="Local" v={request.schedule.place} mono={false} />
          {request.schedule.notes && <KeyValue k="Observação" v={request.schedule.notes} mono={false} />}
        </div>
      )}
      <div>
        <h4 style={title}>Andamento</h4>
        <ol aria-label="Andamento" style={list}>
          {(request.events ?? []).map((ev, i) => (
            <li key={`${ev.status}-${ev.at}-${i}`}>
              <span>{statusLabel(ev.status)}</span>
              <span className="mono" style={muted}>{` · ${fmtDateTime(ev.at)}${ev.by ? ` · ${ev.by.name}` : ""}`}</span>
              {ev.reason && <span style={muted}>{` — ${ev.reason}`}</span>}
            </li>
          ))}
        </ol>
      </div>
      {guideError && <p role="alert" style={alert}>{guideError}</p>}
      {detail.isError && <p role="alert" style={alert}>{regulationError(detail.error)}</p>}
      {stale && (
        <div style={row}>
          <p role="alert" style={alert}>{stale}</p>
          <button type="button" style={buttonStyle} onClick={reload}>Recarregar</button>
        </div>
      )}
      {active === null && (
        <div style={row}>
          {actions.authorize && <button type="button" style={buttonStyle} onClick={() => setMode("authorize")}>Autorizar</button>}
          {actions.returnBack && <button type="button" style={secondaryButtonStyle} onClick={() => setMode("return")}>Devolver para complementar</button>}
          {actions.deny && <button type="button" style={secondaryButtonStyle} onClick={() => setMode("deny")}>Negar</button>}
          {actions.cancel && <button type="button" style={secondaryButtonStyle} onClick={() => setMode("cancel")}>Cancelar o pedido</button>}
        </div>
      )}
      {active === "authorize" && <AuthorizeForm request={request} today={day} onDone={done} onStale={setStale} onCancel={close} />}
      {active === "return" && (
        <ReasonAction label="Motivo da devolução" submitLabel="Devolver" onCancel={close}
          onSubmit={reasonAction(request, (reason, v) => returnRegulationRequest(id, reason, v), "Pedido devolvido à unidade solicitante para complementar.")} />
      )}
      {active === "deny" && (
        <ReasonAction label="Motivo da negativa" submitLabel="Negar pedido" onCancel={close}
          onSubmit={reasonAction(request, (reason, v) => denyRegulationRequest(id, reason, v), "Pedido negado.")} />
      )}
      {active === "cancel" && (
        <ReasonAction label="Motivo do cancelamento" submitLabel="Cancelar pedido" onCancel={close}
          onSubmit={reasonAction(request, (reason, v) => cancelRegulationRequest(id, reason, v), cancelText)} />
      )}
      {extra?.({ request, applied })}
    </section>
  );
}
