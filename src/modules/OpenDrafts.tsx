// src/modules/OpenDrafts.tsx
// Rascunhos abertos (fix51, rotasaude/api#51; módulo 19a, ADR 0031): consultas
// em rascunho cuja autora saiu travam o atendimento. O municipal_admin escolhe
// entre descartar o rascunho (a casca fica, sem conteúdo clínico) ou designar
// outro profissional da unidade. Cada escrita exige step-up e motivo de 10 a
// 500 caracteres no corpo do POST. A tela não mostra conteúdo clínico, nome nem
// CPF de paciente: só as iniciais. A lista vive só no estado do componente
// (gcTime 0): dado de prontuário não fica em cache.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { discardDraft, errorCode, listDraftCandidates, listOpenDrafts, reassignDraft } from "../lib/api";
import { useAuth } from "../lib/auth";
import { hasFeature } from "../lib/features";
import { draftAdminError, draftReasonProblem, type DraftCandidate, type OpenDraft } from "../lib/consultationDrafts";
import { fmtDateTime } from "../lib/format";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { SensitiveAction } from "../components/SensitiveAction";
import { secondaryButtonStyle } from "../components/formStyles";

type Pending = { kind: "discard"; draft: OpenDraft } | { kind: "reassign"; draft: OpenDraft };

// Recusa local (motivo fora da faixa): nada vai ao servidor.
class ReasonProblem extends Error {}

// Recusas que dizem "a lista está velha": a tela relê.
const STALE = new Set([ "not_draft", "not_found" ]);

const DISCARDED = "Rascunho descartado. O atendimento segue em atendimento: um profissional com vínculo na unidade o encerra pela fila da unidade.";

export function OpenDrafts({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const [ pending, setPending ] = useState<Pending | null>(null);
  const [ chosen, setChosen ] = useState<string | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const inFlight = useRef(false);
  const allowed = !!user && !user.operator && hasFeature(user, "clinical_record")
    && user.memberships.some((m) => m.role === "municipal_admin");
  const drafts = useQuery({ queryKey: [ "open-drafts" ], queryFn: listOpenDrafts, enabled: allowed, gcTime: 0, retry: false });
  const reassignId = pending?.kind === "reassign" ? pending.draft.consultation_id : null;
  const candidates = useQuery({
    queryKey: [ "open-drafts", "candidates", reassignId ], queryFn: () => listDraftCandidates(reassignId as string),
    enabled: allowed && !!reassignId, gcTime: 0, retry: false
  });

  if (!user) return null;
  if (!hasFeature(user, "clinical_record")) return <Frame><EmptyState title="o prontuário está desligado nesta cidade" /></Frame>;
  if (!allowed) return <Frame><EmptyState title="seu papel não permite ver esta tela" /></Frame>;

  function open(next: Pending) {
    setDone(null);
    setChosen(null);
    setPending(next);
  }
  function close() { setPending(null); setChosen(null); }

  function finished(message: string) {
    setDone(message);
    close();
    void drafts.refetch();
  }

  // Trava contra duplo envio: o segundo clique não chama a API.
  async function once(call: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    try { await call(); } finally { inFlight.current = false; }
  }

  function translate(err: unknown): string | null {
    if (err instanceof ReasonProblem) return err.message;
    if (STALE.has(errorCode(err) ?? "")) void drafts.refetch();
    if (errorCode(err) === "invalid_professional") void candidates.refetch();
    return errorCode(err) ? draftAdminError(err) : null;
  }

  function discardPanel(draft: OpenDraft) {
    return (
      <SensitiveAction
        key={`discard-${draft.consultation_id}`}
        title={`Descartar rascunho de ${draft.patient_initials} (${draft.health_unit.name})`}
        description={(
          <>
            <p style={text}>
              O rascunho não vira registro clínico: o conteúdo escrito é apagado e fica só a casca (unidade, profissional e datas).
              Documentos já emitidos não são tocados.
            </p>
            <p style={text}>O atendimento continua em atendimento e é encerrado pela fila da unidade, por um profissional com vínculo.</p>
          </>
        )}
        requiresStepUp
        fields={[ { name: "reason", label: "Motivo", required: true } ]}
        confirmLabel="Descartar rascunho"
        run={(values) => once(async () => {
          const problem = draftReasonProblem(values.reason);
          if (problem) throw new ReasonProblem(problem);
          await discardDraft(draft.consultation_id, values.reason.trim());
        })}
        onDone={() => finished(DISCARDED)}
        onCancel={close}
        onGoToSecurity={onGoToSecurity}
        translateError={translate}
      />
    );
  }

  function reassignPanel(draft: OpenDraft) {
    const list = candidates.data;
    const picked = list?.find((c) => c.user_id === chosen);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <section aria-label="Candidatos a autor" style={box}>
          <strong>Designar outro profissional — {draft.health_unit.name}</strong>
          {candidates.isLoading && <p style={text}>carregando candidatos…</p>}
          {candidates.isError && <p role="alert" style={alert}>{draftAdminError(candidates.error)}</p>}
          {list && list.length === 0 && <p style={text}>nenhum profissional elegível nesta unidade</p>}
          {list && list.length > 0 && (
            <div role="radiogroup" aria-label="Profissional" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((c) => (
                <label key={c.user_id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }}>
                  <input type="radio" name="candidate" checked={chosen === c.user_id} onChange={() => setChosen(c.user_id)} />
                  <span>
                    <strong>{c.name}</strong>
                    <span style={{ display: "block", fontSize: 12, color: "var(--ink2)" }}>{candidateLine(c)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div><button type="button" style={secondaryButtonStyle} onClick={close}>Fechar</button></div>
        </section>
        {picked && (
          <SensitiveAction
            key={`reassign-${draft.consultation_id}-${picked.user_id}`}
            title={`Designar rascunho para ${picked.name}`}
            description={(
              <>
                <p style={text}>O texto já escrito é mantido. Depois de designar, {picked.name} encontra o rascunho pelo atendimento, na fila da unidade.</p>
                <p style={text}>As regras de CID-10 e CIAP-2 passam a valer pela ocupação (CBO) do novo profissional.</p>
              </>
            )}
            requiresStepUp
            fields={[ { name: "reason", label: "Motivo", required: true } ]}
            confirmLabel="Designar"
            run={(values) => once(async () => {
              const problem = draftReasonProblem(values.reason);
              if (problem) throw new ReasonProblem(problem);
              await reassignDraft(draft.consultation_id, picked.user_id, values.reason.trim());
            })}
            onDone={() => finished(`Rascunho designado a ${picked.name}. Ele o encontra pelo atendimento, na fila da unidade.`)}
            onCancel={close}
            onGoToSecurity={onGoToSecurity}
            translateError={translate}
          />
        )}
      </div>
    );
  }

  return (
    <Frame>
      <Panel title="Consultas em rascunho" sub="travam o atendimento enquanto ficam abertas">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={text}>
            São consultas iniciadas e não finalizadas. Descarte o rascunho ou designe outro profissional da unidade.
            Esta tela não mostra conteúdo clínico: do paciente aparecem só as iniciais.
          </p>
          {done && <p role="status" style={status}>{done}</p>}
          {drafts.isError && <p role="alert" style={alert}>{draftAdminError(drafts.error)}</p>}
          {pending?.kind === "discard" && discardPanel(pending.draft)}
          {pending?.kind === "reassign" && reassignPanel(pending.draft)}
          {drafts.isLoading && <p style={text}>carregando…</p>}
          {drafts.data && (drafts.data.length === 0 ? <EmptyState title="nenhum rascunho aberto" /> : (
            <DataTable<OpenDraft>
              cols={[
                { label: "Unidade", w: "1.2fr", render: (r) => r.health_unit.name },
                { label: "Profissional", w: "1.6fr", render: (r) => (
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    {r.author.name}{!r.author_linked && <Tag tone="warn">sem vínculo ativo</Tag>}
                  </span>
                ) },
                { label: "Paciente", w: "0.7fr", render: (r) => r.patient_initials },
                { label: "Início", w: "1fr", render: (r) => fmtDateTime(r.started_at) },
                { label: "Último salvamento", w: "1fr", render: (r) => fmtDateTime(r.last_saved_at) },
                { label: "", w: "1.6fr", render: (r) => (
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => open({ kind: "discard", draft: r })}>Descartar</button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => open({ kind: "reassign", draft: r })}>Designar outro profissional</button>
                  </span>
                ) }
              ]}
              rows={drafts.data}
              rowKey={(r) => r.consultation_id}
            />
          ))}
        </div>
      </Panel>
    </Frame>
  );
}

function candidateLine(c: DraftCandidate): string {
  const cbo = c.cbo_code ? (c.cbo_title ? `${c.cbo_code} — ${c.cbo_title}` : c.cbo_code) : "ocupação não informada";
  const council = c.council
    ? [ c.council_state ? `${c.council}/${c.council_state}` : c.council, c.registration_number ].filter(Boolean).join(" ")
    : null;
  return council ? `${cbo} · ${council}` : cbo;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Rascunhos abertos" sub="descartar ou designar outro profissional" />
      {children}
    </div>
  );
}

const text: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--ink2)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const status: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--ink)" };
const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 16,
  border: "1px solid var(--rule)", borderRadius: 8, background: "var(--panel)" };
