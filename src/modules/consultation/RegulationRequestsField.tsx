// src/modules/consultation/RegulationRequestsField.tsx
// "Pedir regulação" no rascunho da consulta (módulo 26a; F-26.2; contrato §3 e §13 G4/G12). O pedido nasce em
// rascunho e vai para a fila da regulação quando a consulta (ou o adendo) é finalizada. NUNCA bloqueia a
// finalização: toda recusa e toda falha de leitura ficam aqui, em frase, e quem finaliza não depende desta peça.
// Rascunho que deixou de valer não trava nada: o api devolve `regulation_not_sent` e a tela o marca "não enviado".
// Leitura nominal (grava trilha): uma vez, sem polling; relê só depois de criar, editar, retirar ou por `refreshKey`.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  createRegulationRequest, deleteRegulationRequest, listConsultationRegulationRequests, updateRegulationRequest,
  type RegulationNotSent, type RegulationRequest, type RegulationRequestInput
} from "../../lib/api";
import {
  ADDENDUM_NOTE, NOMINAL_QUERY, NOT_SENT_LABEL, REG_CONSULTATION_KEY, UNSAVED_REQUEST_NOTE, colorLabel, colorTone, draftFromRequest,
  draftsNote, notSentReason, regulationError, statusLabel, statusTone, typeLabel
} from "../../lib/regulation";
import { Tag } from "../../components/Tag";
import { ConfirmButton } from "../../components/ConfirmButton";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, row, title } from "../exams/styles";
import { RequestForm } from "../regulation/RequestForm";

interface Props {
  consultationId: string;
  cbo: string | null;
  cid10Allowed: boolean;
  mode: "draft" | "addendum";
  finalizing?: boolean;
  // Onde os avisos de finalização aparecem: `undefined` = aqui mesmo; elemento = nele (a caixa de finalizar
  // do editor); `null` = o destino ainda não existe.
  noteTarget?: HTMLElement | null;
  searchDelayMs?: number;
  // Com a função, os pedidos já enviados oferecem "Guia em PDF".
  // Devolve a frase da falha (a guia que não abriu), que aparece aqui mesmo; nada ou `null` = abriu.
  onOpenGuide?(id: string): void | Promise<string | null | void>;
  // Quantos pedidos há (rascunho ou enviado): a finalização do editor usa para aceitar "encaminhado" sem unidade.
  onCountChange?(count: number): void;
  // Mudou → relê a lista (ex.: o api recusou a finalização e a lista pode ter mudado).
  refreshKey?: number;
  // `regulation_not_sent` do finalize ou do adendo: só no adendo; o rascunho vira "não enviado", e o motivo vem do api.
  notSent?: RegulationNotSent[];
}

type Editing = { kind: "new" } | { kind: "edit"; request: RegulationRequest } | null;

export function RegulationRequestsField(props: Props) {
  const { consultationId, cbo, cid10Allowed, mode, finalizing, noteTarget, onOpenGuide } = props;
  const [ editing, setEditing ] = useState<Editing>(null);
  const [ dirty, setDirty ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);

  const list = useQuery({
    queryKey: [ REG_CONSULTATION_KEY, consultationId ], queryFn: () => listConsultationRegulationRequests(consultationId), ...NOMINAL_QUERY
  });
  const refetchRef = useRef(list.refetch);
  refetchRef.current = list.refetch;
  const seenKey = useRef(props.refreshKey);
  useEffect(() => {
    if (seenKey.current === props.refreshKey) return;
    seenKey.current = props.refreshKey;
    void refetchRef.current();
  }, [ props.refreshKey ]);

  const requests = list.data ?? [];
  const drafts = requests.filter((r) => r.status === "draft").length;
  const notSent = new Map((props.notSent ?? []).map((n) => [ n.id, n ]));
  const onCount = useRef(props.onCountChange);
  onCount.current = props.onCountChange;
  const count = list.data?.length;
  useEffect(() => { if (count !== undefined) onCount.current?.(count); }, [ count ]);

  async function openGuide(id: string) {
    setError(null);
    const text = await onOpenGuide?.(id);
    if (typeof text === "string") setError(text);
  }

  function close() { setEditing(null); setDirty(false); }

  async function save(input: RegulationRequestInput) {
    if (editing?.kind === "edit") await updateRegulationRequest(consultationId, editing.request.id, input);
    else await createRegulationRequest(consultationId, input);
    setError(null);
    close();
    await list.refetch();
  }

  async function withdraw(r: RegulationRequest) {
    setError(null);
    try {
      await deleteRegulationRequest(consultationId, r.id);
      await list.refetch();
    } catch (err) {
      setError(regulationError(err));
    }
  }

  const notes = (
    <>
      {finalizing && drafts > 0 && <p style={noteText}>{draftsNote(drafts)}</p>}
      {finalizing && editing && dirty && <p style={noteText}>{UNSAVED_REQUEST_NOTE}</p>}
    </>
  );
  const hasNotes = finalizing && ((drafts > 0) || (editing !== null && dirty));

  return (
    <section aria-label="Pedidos de regulação" style={box}>
      <strong style={title}>Pedidos de regulação</strong>
      {mode === "addendum" && !list.isPending && <p style={muted}>{ADDENDUM_NOTE}</p>}
      {list.isPending && <p style={muted}>carregando os pedidos…</p>}
      {list.isError && <p role="alert" style={alert}>{regulationError(list.error)}</p>}

      {requests.length > 0 && (
        <ul style={listStyle}>
          {requests.map((r) => {
            const draft = r.status === "draft";
            // No adendo o rascunho que sobrou é "não enviado" (no lugar de "rascunho"); o motivo só se o api o devolveu.
            const unsent = mode === "addendum" && draft;
            const missed = unsent ? notSent.get(r.id) : undefined;
            return (
              <li key={r.id} aria-label={r.target.name} style={item}>
                <div style={row}>
                  <strong style={{ fontSize: 13 }}>{r.target.name}</strong>
                  <span style={muted}>{typeLabel(r.type)}</span>
                  <Tag tone={colorTone(r.suggested_color)}>{colorLabel(r.suggested_color)}</Tag>
                  {unsent ? <Tag tone="warn">{NOT_SENT_LABEL}</Tag> : <Tag tone={statusTone(r.status)}>{statusLabel(r.status)}</Tag>}
                </div>
                {missed && <small style={reasonText}>{notSentReason(missed)}</small>}
                <div style={row}>
                  {draft ? (
                    <>
                      <button type="button" aria-label={`Editar o pedido de ${r.target.name}`} disabled={editing !== null}
                        style={secondaryButtonStyle} onClick={() => { setError(null); setDirty(false); setEditing({ kind: "edit", request: r }); }}>
                        Editar
                      </button>
                      <ConfirmButton label={`Retirar o pedido de ${r.target.name}`} question="Retirar este pedido de regulação?"
                        disabledReason={editing !== null ? "feche o formulário aberto antes" : null} onConfirm={() => withdraw(r)} />
                    </>
                  ) : onOpenGuide ? (
                    <button type="button" style={secondaryButtonStyle} onClick={() => void openGuide(r.id)}>Guia em PDF</button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing ? (
        <RequestForm key={editing.kind === "edit" ? editing.request.id : "new"} cbo={cbo} cid10Allowed={cid10Allowed} mode="create"
          initial={editing.kind === "edit" ? draftFromRequest(editing.request) : undefined} submitLabel="Salvar pedido"
          delayMs={props.searchDelayMs} onSubmit={save} onCancel={close} onDirty={setDirty} />
      ) : (
        <div>
          <button type="button" style={buttonStyle} onClick={() => { setError(null); setDirty(false); setEditing({ kind: "new" }); }}>
            Pedir regulação
          </button>
        </div>
      )}

      {error && <p role="alert" style={alert}>{error}</p>}
      {/* Portal e não o editor: a conta depende da lista lida e do formulário aberto, que só esta peça conhece. */}
      {noteTarget === undefined ? (hasNotes ? notes : null) : noteTarget && hasNotes ? createPortal(notes, noteTarget) : null}
    </section>
  );
}

const listStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 };
const item: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: 8, border: "1px solid var(--rule)", borderRadius: 8 };
const reasonText: CSSProperties = { fontSize: 12, color: "var(--ink)" };
const noteText: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--ink)" };
