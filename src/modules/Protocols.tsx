// ProtocolsView (§4.6/§5.2) + drill-down de detalhe + ciclo de vida por
// assinaturas (ADR 0016). Cada versão oferece as ações que `actionsFor`
// deriva do estado lido e do papel de quem está olhando; quem decide de
// fato é o command na API, que trava a linha e reconfere.

import { useEffect, useMemo, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProtocols, useProtocolDetail } from "../hooks/useProtocols";
import { useAuth } from "../lib/auth";
import {
  submitProtocol, signProtocol, publishProtocolVersion,
  activateProtocol, retireProtocol, revertProtocol
} from "../lib/api";
import {
  actionsFor, awaitingMySignature,
  type LifecycleAction, type LifecycleKind, type LifecycleTarget, type Viewer
} from "../lib/protocolLifecycle";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, dangerButtonStyle, disabledButtonStyle, inputStyle } from "../components/formStyles";
import { useDialog } from "../lib/useDialog";
import { actorLabel, eventLabel, type EventPerson } from "../lib/protocolEvents";
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
import { describeActionError } from "../lib/actionErrors";
import { fmtDateTime } from "../lib/format";
import type { ProtocolRow } from "../lib/types";
import type { ModuleId } from "../shell/modules";
import { SegmentedControl } from "../shell/SegmentedControl";
import { canReadCatalog } from "../lib/triageCatalog";
import { TriageCatalogTab } from "./protocols/TriageCatalogTab";

// A reversão é a única ação cuja versão de sucesso NÃO é a versão sobre a qual
// se agiu: ela sai da ativa e volta para a anterior. Nomear `pending.version`
// ali, como as outras ações fazem com razão, anuncia a versão que acabou de
// sair de uso.
//
// Divergir do previsto é fato, não alarme: significa que outra ativação comitou
// entre a leitura e o clique e o servidor reresolveu sob lock, como deve. A
// frase conta, com o mesmo peso do sucesso comum.
// Resultado no particípio (PR-14), igual no maintenance.
const DONE_LABEL: Record<string, string> = {
  submit: "Enviada para revisão", "sign-publication": "Publicação assinada", "sign-activation": "Ativação assinada",
  publish: "Publicada", activate: "Ativada", retire: "Aposentada"
};

function doneMessage(
  pending: { version: string; revertTargetVersion: string | null; action: LifecycleAction },
  name: string,
  revertedTo: string | null
): string {
  if (pending.action.kind !== "revert") {
    return `${DONE_LABEL[pending.action.kind === "sign" ? `sign-${pending.action.purpose}` : pending.action.kind]}: ${name} v${pending.version}`;
  }
  if (revertedTo == null) return `${pending.action.label} concluído.`;
  if (pending.revertTargetVersion != null && pending.revertTargetVersion !== revertedTo) {
    return `${pending.action.label} concluído: estava previsto v${pending.revertTargetVersion}; ` +
      `a cidade está com ${name} v${revertedTo}.`;
  }
  return `${pending.action.label} concluído: a cidade está com ${name} v${revertedTo}.`;
}

// O que cada ação faz, dito antes do Confirmar (spec 6a §3.5, PR-03/05).
// Ativar nomeia a versão em uso que sai, quando há uma.
function consequence(kind: LifecycleKind, revertTarget: string | null, inUse: string | null = null): string {
  switch (kind) {
    case "submit":   return "A versão sai do rascunho e não pode mais ser editada. Os revisores passam a poder assinar a publicação.";
    case "sign":     return "Sua assinatura conta para o próximo passo desta versão. Ela fica registrada com seu nome.";
    case "publish":  return "A versão fica pronta para ativação, mas ainda não vale para a cidade.";
    case "activate": return inUse
      ? `A versão passa a valer para toda a cidade. A versão ${inUse} (em uso) sai de uso.`
      : "A versão passa a valer para toda a cidade. A versão em uso deste protocolo sai de uso.";
    case "retire":   return "A versão não pode mais ser ativada. Isso não pode ser desfeito.";
    case "revert":   return revertDescription(revertTarget);
  }
}

// A frase nomeia a versão-alvo (spec 2026-09-23-revert-target §5). "deve
// voltar", não "vai voltar": a leitura é sem lock, e a API decide no clique.
// Sem alvo na leitura — nulo, ou a chave ausente numa API antiga —, cai na
// frase sem número em vez de imprimir "null" ou "undefined".
function revertDescription(targetVersion: string | null): string {
  const destino = targetVersion
    ? `a versão ${targetVersion}, que estava em uso antes desta`
    : "a versão ativada antes desta";
  return `A cidade deve voltar para ${destino}. A versão atual sai de uso. ` +
    "Não encadeia: reverter de novo exige uma nova ativação assinada, não outra reversão.";
}

type ProtocolsTab = "versions" | "catalog";
const TABS: { key: ProtocolsTab; label: string }[] = [
  { key: "versions", label: "Versões" },
  { key: "catalog", label: "Catálogo de triagens" }
];

// Módulo 15: a aba do catálogo só aparece para quem a API deixa ler
// (GET /triage_catalog); para os outros papéis, a tela é a de sempre.
export function Protocols({ onNavigate }: { onNavigate?: (id: ModuleId) => void } = {}) {
  const auth = useAuth();
  const showCatalog = canReadCatalog((auth.user?.memberships ?? []).map((m) => m.role));
  const [ tab, setTab ] = useState<ProtocolsTab>("versions");
  return (
    <Wrap>
      {showCatalog && <SegmentedControl options={TABS} value={tab} onChange={setTab} />}
      {showCatalog && tab === "catalog"
        ? <TriageCatalogTab onNavigate={onNavigate} />
        : <ProtocolVersions onNavigate={onNavigate} />}
    </Wrap>
  );
}

function ProtocolVersions({ onNavigate }: { onNavigate?: (id: ModuleId) => void }) {
  const [ openId, setOpenId ] = useState<string | null>(null);
  // Quem abriu o painel recebe o foco de volta ao fechar (PR-06).
  const [ opener, setOpener ] = useState<HTMLElement | null>(null);
  const { data, isLoading, isError, error, refetch } = useProtocols();
  const auth = useAuth();
  const viewer: Viewer = useMemo(
    () => ({ id: auth.user?.id ?? "", roles: (auth.user?.memberships ?? []).map((m) => m.role) }),
    [ auth.user ]
  );
  const [ onlyMine, setOnlyMine ] = useState(false);
  // Achar o que está em uso sem varrer tudo (PR-13); `?protocolo=` vem do
  // link do editor (PR-10).
  const [ hideRetired, setHideRetired ] = useState(false);
  const [ search, setSearch ] = useState(() => new URLSearchParams(window.location.search).get("protocolo") ?? "");

  if (isLoading) return <Stack><KpiGrid><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /></KpiGrid><Panel title="Lista"><Skeleton rows={5} /></Panel></Stack>;
  if (isError) return <Stack><ErrorState message={(error as Error)?.message || "Erro"} onRetry={() => refetch()} /></Stack>;
  if (!data) return <Stack><EmptyState title="sem dados" /></Stack>;

  const list = data.data.list;
  // D1 — a leitura da API agora distingue "active" (em uso) de "published"
  // (apenas publicada, ainda não ativada); as duas contam para este KPI.
  const published = list.filter((p) => p.status === "published" || p.status === "active").length;
  const awaiting = list.filter((r) => awaitingMySignature(r, viewer)).length;
  const term = search.trim().toLowerCase();
  const shown = [ ...list ]
    .filter((r) => !onlyMine || awaitingMySignature(r, viewer))
    .filter((r) => !hideRetired || r.status !== "retired")
    .filter((r) => !term || r.name.toLowerCase().includes(term))
    .sort((a, b) => Number(a.status === "retired") - Number(b.status === "retired")
      || a.name.localeCompare(b.name) || Number(b.version) - Number(a.version));

  return (
    <Stack>
      <KpiGrid asOf={data.as_of}>
        <StatTile label="Protocolos & versões" value={list.length} source="live" />
        <StatTile label="Publicados ou em uso" value={published} tone="ok" source="live" />
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
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" }}>
            Buscar por nome
            <input value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <input type="checkbox" checked={hideRetired} onChange={(e) => setHideRetired(e.target.checked)} />
            esconder aposentadas
          </label>
        </div>
        <DataTable<ProtocolRow>
          cols={[
            { label: "ID", w: "2fr", render: (r) => <span className="mono">{r.id}</span> },
            { label: "Versão", w: "1fr", render: (r) => <span className="mono">{r.version}</span> },
            { label: "Status", w: "1fr", render: (r) => <Tag tone={statusTone(r.status)}>{statusLabel(r.status)}</Tag> },
            { label: "Publicação", w: "1fr", render: (r) => <span className="mono">{r.signatures.publication.signers.length}/2</span> },
            { label: "Ativação", w: "1fr", render: (r) => <span className="mono">{activationCell(r.status, r.signatures.activation.signers.length)}</span> },
            { label: "Revisores", w: "1fr", render: (r) => <span className="mono">{r.eligibleReviewers}</span> },
            { label: "Detalhe", w: "auto", align: "right", render: () => <span className="mono" style={{ color: "var(--accent)" }}>ver →</span> }
          ]}
          rows={shown}
          rowKey={(r) => `${r.id}-${r.version}`}
          onRowClick={(r) => { setOpener(document.activeElement as HTMLElement | null); setOpenId(r.id); }}
          empty={onlyMine ? "nenhuma versão aguardando sua assinatura" : "nenhum protocolo cadastrado"}
        />
      </Panel>

      {openId && <DetailDrawer id={openId} viewer={viewer} onNavigate={onNavigate} opener={opener} onClose={() => setOpenId(null)} />}
    </Stack>
  );
}

function DetailDrawer({
  id, viewer, onNavigate, opener, onClose
}: { id: string; viewer: Viewer; onNavigate?: (id: ModuleId) => void; opener?: HTMLElement | null; onClose: () => void }) {
  const { data, isLoading, isError, error } = useProtocolDetail(id);
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [ pending, setPending ] = useState<{ version: string; revertTargetVersion: string | null; action: LifecycleAction } | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  // Recusa que sobrevive ao fechamento do painel: a frase que nomeia a versão
  // vigente agora precisa continuar na tela DEPOIS de o painel sumir, porque é
  // ela que explica por que a lista mudou embaixo. A mensagem do
  // SensitiveAction vive dentro do painel e iria junto.
  const [ staleNotice, setStaleNotice ] = useState<string | null>(null);
  // O `run` do SensitiveAction resolve para void: o número que a reversão
  // efetivou viaja por aqui até o onDone. Limpo ao abrir cada painel, para
  // que uma ação nunca leia o resultado da anterior.
  const revertedToRef = useRef<string | null>(null);
  const name = data?.data.name ?? id;
  // Diálogo de verdade (PR-06): foco dentro, Tab preso, Escape fecha (a
  // confirmação aberta fecha primeiro) e o foco volta para a linha.
  const pendingRef = useRef(false);
  pendingRef.current = pending !== null;
  const panelRef = useDialog<HTMLDivElement>(true, () => { if (pendingRef.current) setPending(null); else onClose(); }, opener);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);
  const inUse = data?.data.versions.find((v) => v.status === "active")?.version ?? null;
  // Quem aparece nos eventos: signatários e editores que o painel já conhece (PR-11).
  const people: EventPerson[] = (data?.data.versions ?? []).flatMap((v) => [
    ...v.signatures.publication.signers, ...v.signatures.activation.signers,
    ...v.editors.map((e) => ({ id: e.id, email: e.email, kind: e.kind }))
  ]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "color-mix(in srgb, var(--ink) 32%, transparent)",
        backdropFilter: "blur(2px)",
        display: "flex",
        justifyContent: "flex-end",
        zIndex: 80
      }}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="protocol-detail-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 100%)",
          background: "var(--panel)",
          borderLeft: "1px solid var(--rule)",
          padding: 20,
          overflowY: "auto"
        }}
      >
        {/* Conteúdo em bloco flex próprio: o contêiner rolável não espreme os
            painéis quando a confirmação abre (PR-02). */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 id="protocol-detail-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Detalhe do protocolo</h2>
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
            {done && <p ref={doneRef} tabIndex={-1} role="status" style={{ margin: 0, fontSize: 12.5 }}>{done}</p>}
            {staleNotice && <p role="alert" style={{ margin: 0, fontSize: 12.5 }}>{staleNotice}</p>}

            <Panel title="Versões" sub="histórico" asOf={data.as_of}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {data.data.versions.map((v) => (
                  <div key={v.version} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <VersionDetail
                    version={v}
                    viewer={viewer}
                    onPick={(action) => {
                      revertedToRef.current = null;
                      setPending({ version: v.version, revertTargetVersion: v.revertTargetVersion ?? null, action });
                      setDone(null);
                      setStaleNotice(null);
                    }}
                  />
                  {/* A confirmação abre junto da versão escolhida (PR-02). */}
                  {pending && pending.version === v.version && (
                    <SensitiveAction
                      title={`${pending.action.label} ${name} v${pending.version}`}
                      description={consequence(pending.action.kind, pending.revertTargetVersion, inUse !== pending.version ? inUse : null)}
                      requiresStepUp={pending.action.stepUp}
                      fields={pending.action.needsReason ? [ { name: "reason", label: "Motivo", required: true } ] : []}
                      run={async (values) => {
                        try {
                          revertedToRef.current = await runAction(name, pending.version, pending.action, values);
                        } catch (err) {
                          // Recusa por divergência: o SensitiveAction mostra a mensagem
                          // (que nomeia a versão em uso agora), e aqui relemos a lista —
                          // senão a tela segue exibindo o estado que a recusa acabou de
                          // desmentir. Relança para o painel continuar tratando o erro.
                          const described = describeActionError(err);
                          if (described.kind === "rejected" && described.code === "current_version_changed") {
                            // Relê a lista E fecha o painel: `pending` guarda a versão
                            // antiga, então clicar Confirmar de novo mandaria o mesmo
                            // token e levaria a mesma recusa, indefinidamente. O
                            // próximo clique tem de partir da linha relida.
                            void queryClient.invalidateQueries({ queryKey: [ "protocols" ] });
                            void queryClient.invalidateQueries({ queryKey: [ "protocol-detail", id ] });
                            setStaleNotice(described.message);
                            setPending(null);
                          }
                          throw err;
                        }
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
                ))}
              </div>
            </Panel>

            <Panel title="Eventos" sub="protocol.* · auditoria" asOf={data.as_of}>
              <DataTable
                cols={[
                  { label: "Em", w: "1fr", render: (e) => <span className="mono">{fmtDateTime(e.at)}</span> },
                  { label: "Evento", w: "2fr", render: (e) => <Tag>{eventLabel(e.name)}</Tag> },
                  { label: "Quem", w: "1fr", render: (e) => <span className="mono">{actorLabel(e.actor, people)}</span> },
                  { label: "Ref", w: "1fr", render: (e) => <span className="mono" style={{ color: "var(--ink3)" }}>{e.ref}</span> }
                ]}
                rows={data.data.events}
                rowKey={(e, i) => `${e.at}-${i}`}
                empty="nenhum evento"
              />
            </Panel>
          </>
        )}

        </div>
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

      <SignaturesSummary label="Publicação" block={version.signatures.publication} current={version.status === "in_review"} />
      <SignaturesSummary label="Ativação" block={version.signatures.activation} current={version.status === "published"}
        settled={version.status === "active" ? "concluída — versão em uso" : null} />

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

// A assinatura só "falta" na etapa em curso (PR-01): publicação em revisão,
// ativação na publicada. A de ativação se consome ao ativar, então a versão em
// uso mostra a etapa concluída. Quem já assinou continua listado.
function SignaturesSummary({ label, block, current, settled = null }: {
  label: string; block: LifecycleTarget["signatures"]["publication"]; current: boolean; settled?: string | null;
}) {
  const signers = block.signers.length > 0
    ? <span className="mono">{block.signers.map((s) => s.email ?? "—").join(", ")}</span>
    : null;
  return (
    <div style={{ fontSize: 12, color: "var(--ink2)" }}>
      <strong>{label}:</strong>{" "}
      {signers ?? (current ? "ninguém assinou ainda" : (settled ?? "—"))}
      {current && block.missing > 0 && <span style={{ color: "var(--ink3)" }}> · falta {block.missing}</span>}
      {!current && signers && settled && <span style={{ color: "var(--ink3)" }}> · {settled}</span>}
    </div>
  );
}

function VersionActions({
  version, viewer, onPick
}: { version: LifecycleTarget; viewer: Viewer; onPick(action: LifecycleAction): void }) {
  // Destrutivas por último e com estilo de perigo (PR-12).
  const destructive = (k: string) => k === "retire" || k === "revert";
  const actions = [ ...actionsFor(version, viewer) ].sort((a, b) => Number(destructive(a.kind)) - Number(destructive(b.kind)));
  if (actions.length === 0) {
    // Versão em uso sem anterior: diz por que não há Reverter (PR-16).
    return version.status === "active" && !version.revertible
      ? <small style={{ fontSize: 11, color: "var(--ink3)" }}>sem versão anterior para reverter; aposentar não vale para a versão em uso</small>
      : null;
  }

  return (
    <div data-version-actions style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {actions.map((action) => (
        <div key={`${action.kind}-${action.purpose ?? ""}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button
            type="button"
            style={action.disabledReason !== null ? disabledButtonStyle : destructive(action.kind) ? dangerButtonStyle : buttonStyle}
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
    case "revert":   return (await revertProtocol(name, values.reason ?? "", version))?.version ?? null;
  }
}

// A versão active é a que está em uso agora (só ela reverte, R4 nunca
// aposenta) — tom de destaque próprio, distinto do "ok" de published.
// Coluna Ativação da lista (PR-01): só conta assinaturas onde a etapa pede.
function activationCell(status: string, signed: number): string {
  if (status === "active") return "em uso";
  if (status === "published") return `${signed}/2`;
  return "—";
}

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

// O conteúdo de cada aba, sem o cabeçalho: o PageHeader fica uma vez só, no Wrap.
function Stack({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{children}</div>;
}
