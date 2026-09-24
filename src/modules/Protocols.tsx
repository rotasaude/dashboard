// ProtocolsView (§4.6/§5.2) + drill-down de detalhe + ciclo de vida por
// assinaturas (ADR 0016). Cada versão oferece as ações que `actionsFor`
// deriva do estado lido e do papel de quem está olhando; quem decide de
// fato é o command na API, que trava a linha e reconfere.

import { useMemo, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProtocols, useProtocolDetail } from "../hooks/useProtocols";
import { useAuth } from "../lib/auth";
import {
  submitProtocol, signProtocol, publishProtocolVersion,
  activateProtocol, retireProtocol, revertProtocol
} from "../lib/api";
import {
  actionsFor, awaitingMySignature,
  type LifecycleAction, type LifecycleTarget, type Viewer
} from "../lib/protocolLifecycle";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle } from "../components/formStyles";
import { Panel } from "../components/Panel";
import { PageHeader } from "../components/PageHeader";
import { KpiGrid } from "../components/KpiGrid";
import { StatTile } from "../components/StatTile";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { Skeleton } from "../components/Skeleton";
import { ErrorState } from "../components/ErrorState";
import { EmptyState } from "../components/EmptyState";
import { KpiSkeleton } from "./Overview";
import { fmtDateTime } from "../lib/format";
import type { ProtocolRow } from "../lib/types";
import type { ModuleId } from "../shell/modules";

// A frase nomeia a versão-alvo (spec 2026-09-23-revert-target §5). "deve
// voltar", não "vai voltar": a leitura é sem lock, e a API decide no clique.
// Sem alvo na leitura, cai na frase sem número em vez de imprimir "null".
// A reversão é a única ação cuja versão de sucesso NÃO é a versão sobre a qual
// se agiu: ela sai da ativa e volta para a anterior. Nomear `pending.version`
// ali, como as outras ações fazem com razão, anuncia a versão que acabou de
// sair de uso.
//
// Divergir do previsto é fato, não alarme: significa que outra ativação comitou
// entre a leitura e o clique e o servidor reresolveu sob lock, como deve. A
// frase conta, com o mesmo peso do sucesso comum.
function doneMessage(
  pending: { version: string; revertTargetVersion: string | null; action: LifecycleAction },
  name: string,
  revertedTo: string | null
): string {
  if (pending.action.kind !== "revert") {
    return `${pending.action.label} concluído: ${name} v${pending.version}`;
  }
  if (revertedTo == null) return `${pending.action.label} concluído.`;
  if (pending.revertTargetVersion != null && pending.revertTargetVersion !== revertedTo) {
    return `${pending.action.label} concluído: estava previsto v${pending.revertTargetVersion}; ` +
      `a cidade está com ${name} v${revertedTo}.`;
  }
  return `${pending.action.label} concluído: a cidade está com ${name} v${revertedTo}.`;
}

function revertDescription(targetVersion: string | null): string {
  const destino = targetVersion
    ? `a versão ${targetVersion}, que estava em uso antes desta`
    : "a versão ativada antes desta";
  return `A cidade deve voltar para ${destino}. A versão atual sai de uso. ` +
    "Não encadeia: reverter de novo exige uma nova ativação assinada, não outra reversão.";
}

export function Protocols({ onNavigate }: { onNavigate?: (id: ModuleId) => void } = {}) {
  const [ openId, setOpenId ] = useState<string | null>(null);
  const { data, isLoading, isError, error, refetch } = useProtocols();
  const auth = useAuth();
  const viewer: Viewer = useMemo(
    () => ({ id: auth.user?.id ?? "", roles: (auth.user?.memberships ?? []).map((m) => m.role) }),
    [ auth.user ]
  );
  const [ onlyMine, setOnlyMine ] = useState(false);

  if (isLoading) return <Wrap><KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Lista"><Skeleton rows={5} /></Panel></Wrap>;
  if (isError) return <Wrap><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Wrap>;
  if (!data) return <Wrap><EmptyState title="sem dados" /></Wrap>;

  const list = data.data.list;
  // D1 — a leitura da API agora distingue "active" (em uso) de "published"
  // (apenas publicada, ainda não ativada); as duas contam para este KPI.
  const published = list.filter((p) => p.status === "published" || p.status === "active").length;
  const awaiting = list.filter((r) => awaitingMySignature(r, viewer)).length;
  const shown = onlyMine ? list.filter((r) => awaitingMySignature(r, viewer)) : list;

  return (
    <Wrap>
      <KpiGrid>
        <StatTile label="Protocolos & versões" value={list.length} source="live" />
        <StatTile label="Publicados" value={published} tone="ok" source="live" />
        <button
          type="button"
          aria-pressed={onlyMine}
          onClick={() => setOnlyMine((v) => !v)}
          style={{ all: "unset", cursor: "pointer", borderRadius: 10, outline: onlyMine ? "2px solid var(--accent)" : "2px solid transparent", outlineOffset: 2 }}
        >
          <StatTile label="Aguardando sua assinatura" value={awaiting}
                    tone={awaiting > 0 ? "warn" : "ok"} source="live" />
        </button>
      </KpiGrid>

      <Panel title="Protocolos & versões" sub="autoria · publicação · validação" asOf={data.as_of}>
        <DataTable<ProtocolRow>
          cols={[
            { label: "ID", w: "2fr", render: (r) => <span className="mono">{r.id}</span> },
            { label: "Versão", w: "1fr", render: (r) => <span className="mono">{r.version}</span> },
            { label: "Status", w: "1fr", render: (r) => <Tag tone={statusTone(r.status)}>{statusLabel(r.status)}</Tag> },
            { label: "Publicação", w: "1fr", render: (r) => <span className="mono">{r.signatures.publication.signers.length}/2</span> },
            { label: "Ativação", w: "1fr", render: (r) => <span className="mono">{r.signatures.activation.signers.length}/2</span> },
            { label: "Revisores", w: "1fr", render: (r) => <span className="mono">{r.eligibleReviewers}</span> },
            { label: "Detalhe", w: "auto", align: "right", render: () => <span className="mono" style={{ color: "var(--accent)" }}>ver →</span> }
          ]}
          rows={shown}
          rowKey={(r) => `${r.id}-${r.version}`}
          onRowClick={(r) => setOpenId(r.id)}
          empty={onlyMine ? "nenhuma versão aguardando sua assinatura" : "nenhum protocolo cadastrado"}
        />
      </Panel>

      {openId && <DetailDrawer id={openId} viewer={viewer} onNavigate={onNavigate} onClose={() => setOpenId(null)} />}
    </Wrap>
  );
}

function DetailDrawer({
  id, viewer, onNavigate, onClose
}: { id: string; viewer: Viewer; onNavigate?: (id: ModuleId) => void; onClose: () => void }) {
  const { data, isLoading, isError, error } = useProtocolDetail(id);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [ pending, setPending ] = useState<{ version: string; revertTargetVersion: string | null; action: LifecycleAction } | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  // O `run` do SensitiveAction resolve para void: o número que a reversão
  // efetivou viaja por aqui até o onDone. Limpo ao abrir cada painel, para
  // que uma ação nunca leia o resultado da anterior.
  const revertedToRef = useRef<string | null>(null);
  const name = data?.data.name ?? id;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,20,40,0.32)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 80
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          background: "var(--panel)",
          borderLeft: "1px solid var(--rule)",
          padding: 20,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Detalhe do protocolo</h2>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{id}</span>
          </div>
          <button onClick={onClose} className="mono" style={{ fontSize: 11, color: "var(--ink2)", padding: "4px 10px", border: "1px solid var(--rule)", borderRadius: 6 }}>
            fechar
          </button>
        </div>

        {isLoading && <Skeleton rows={6} />}
        {isError && <ErrorState message={(error as Error)?.message || "Erro"} />}
        {data && (
          <>
            {done && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{done}</p>}

            <Panel title="Versões" sub="histórico" asOf={data.as_of}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {data.data.versions.map((v) => (
                  <VersionDetail
                    key={v.version}
                    version={v}
                    viewer={viewer}
                    onPick={(action) => {
                      revertedToRef.current = null;
                      setPending({ version: v.version, revertTargetVersion: v.revertTargetVersion, action });
                      setDone(null);
                    }}
                  />
                ))}
              </div>
            </Panel>

            <Panel title="Eventos" sub="protocol.* · auditoria" asOf={data.as_of}>
              <DataTable
                cols={[
                  { label: "Em", w: "1fr", render: (e) => <span className="mono">{fmtDateTime(e.at)}</span> },
                  { label: "Evento", w: "2fr", render: (e) => <Tag>{e.name}</Tag> },
                  { label: "Actor", w: "1fr", render: (e) => <span className="mono">{e.actor || "sistema"}</span> },
                  { label: "Ref", w: "1fr", render: (e) => <span className="mono" style={{ color: "var(--ink3)" }}>{e.ref}</span> }
                ]}
                rows={data.data.events}
                rowKey={(e, i) => `${e.at}-${i}`}
                empty="nenhum evento"
              />
            </Panel>
          </>
        )}

        {pending && (
          <SensitiveAction
            title={`${pending.action.label} ${name} v${pending.version}`}
            description={pending.action.kind === "revert" ? revertDescription(pending.revertTargetVersion) : undefined}
            requiresStepUp={pending.action.stepUp}
            fields={pending.action.needsReason ? [ { name: "reason", label: "Motivo", required: true } ] : []}
            run={async (values) => {
              revertedToRef.current = await runAction(name, pending.version, pending.action, values);
            }}
            onDone={() => {
              setDone(doneMessage(pending, name, revertedToRef.current));
              setPending(null);
              void queryClient.invalidateQueries({ queryKey: [ "protocols" ] });
              void queryClient.invalidateQueries({ queryKey: [ "protocol-detail", id ] });
              void auth.reload();
            }}
            onCancel={() => setPending(null)}
            onGoToSecurity={() => onNavigate?.("security")}
          />
        )}
      </div>
    </div>
  );
}

function VersionDetail({
  version, viewer, onPick
}: {
  version: LifecycleTarget & {
    createdBy: string | null; publishedBy: string | null; fourEyes: boolean | null;
    at: string; schema: string; linter: string; gates: string;
  };
  viewer: Viewer;
  onPick(action: LifecycleAction): void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingBottom: 12, borderBottom: "1px solid var(--rule)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono" style={{ fontWeight: 600 }}>v{version.version}</span>
        <Tag tone={statusTone(version.status)}>{statusLabel(version.status)}</Tag>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{fmtDateTime(version.at)}</span>
      </div>

      <SignaturesSummary label="Publicação" block={version.signatures.publication} />
      <SignaturesSummary label="Ativação" block={version.signatures.activation} />

      <div style={{ fontSize: 12, color: "var(--ink2)" }}>
        <strong>Editores:</strong>{" "}
        {version.editors.length === 0
          ? "—"
          : version.editors.map((e, i) => (
              <span key={`${e.kind}-${e.id}`}>
                {i > 0 && ", "}
                <span className="mono">{e.kind === "maintainer" ? "mantenedor" : (e.email ?? "—")}</span>
              </span>
            ))}
      </div>

      <div style={{ fontSize: 12, color: "var(--ink2)" }}>
        <strong>Revisores elegíveis:</strong> <span className="mono">{version.eligibleReviewers}</span>
      </div>

      <VersionActions version={version} viewer={viewer} onPick={onPick} />
    </div>
  );
}

function SignaturesSummary({ label, block }: { label: string; block: LifecycleTarget["signatures"]["publication"] }) {
  return (
    <div style={{ fontSize: 12, color: "var(--ink2)" }}>
      <strong>{label}:</strong>{" "}
      {block.signers.length === 0 ? "ninguém assinou ainda" : (
        <span className="mono">{block.signers.map((s) => s.email ?? "—").join(", ")}</span>
      )}
      {block.missing > 0 && <span style={{ color: "var(--ink3)" }}> · falta {block.missing}</span>}
    </div>
  );
}

function VersionActions({
  version, viewer, onPick
}: { version: LifecycleTarget; viewer: Viewer; onPick(action: LifecycleAction): void }) {
  const actions = actionsFor(version, viewer);
  if (actions.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {actions.map((action) => (
        <div key={`${action.kind}-${action.purpose ?? ""}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button
            type="button"
            style={action.disabledReason !== null ? disabledButtonStyle : buttonStyle}
            disabled={action.disabledReason !== null}
            onClick={() => onPick(action)}
          >
            {action.label}
          </button>
          {action.disabledReason && (
            <small style={{ fontSize: 11, color: "var(--ink3)" }}>{action.disabledReason}</small>
          )}
        </div>
      ))}
    </div>
  );
}

// Devolve a versão que a reversão efetivou, e null para todas as outras ações
// — só a reversão troca a versão em uso por OUTRA que não a versão sobre a
// qual se agiu. Quem guarda o número é o chamador, porque o `run` do
// SensitiveAction resolve para void.
async function runAction(
  name: string, version: string, action: LifecycleAction, values: Record<string, string>
): Promise<string | null> {
  switch (action.kind) {
    case "submit":   await submitProtocol(name, version); return null;
    case "sign":     await signProtocol(name, version, action.purpose!); return null;
    case "publish":  await publishProtocolVersion(name, version); return null;
    case "activate": await activateProtocol(name, version); return null;
    case "retire":   await retireProtocol(name, version); return null;
    case "revert":   return (await revertProtocol(name, values.reason ?? ""))?.version ?? null;
  }
}

// A versão active é a que está em uso agora (só ela reverte, R4 nunca
// aposenta) — tom de destaque próprio, distinto do "ok" de published.
function statusTone(s: string): string {
  if (s === "active") return "accent";
  if (s === "published") return "ok";
  if (s === "draft") return "info";
  if (s === "retired") return "neutral";
  return "neutral";
}

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  in_review: "em revisão",
  published: "publicada",
  active: "em uso",
  retired: "aposentada"
};

function statusLabel(s: string): string {
  return STATUS_LABEL[s] ?? s;
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Protocolos" sub="protocols · governança" />
      {children}
    </div>
  );
}
