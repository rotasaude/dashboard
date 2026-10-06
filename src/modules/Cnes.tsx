// src/modules/Cnes.tsx
// CNES da cidade (módulo 16; ADR 0028; spec §5; contratos §5.2): só
// municipal_admin. Mostra o retrato importado pelo operador, as propostas de
// casamento (unidade por CNES, equipe por INE, profissional por CPF/CNS) e as
// divergências. Nada se aplica sozinho: a pessoa seleciona e confirma com
// step-up; proposta que mudou desde a leitura é pulada pela API e dita aqui.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { applyCnesProposals, getCnes, type CnesDivergence, type CnesProposal } from "../lib/api";
import { useAuth } from "../lib/auth";
import { describeActionError } from "../lib/actionErrors";
import { competenceLabel } from "../lib/competence";
import { fmtDateTime } from "../lib/format";
import {
  CNES_KEY, CONFIDENCE, PROPOSAL_ACTION_LABEL, PROPOSAL_KIND_LABEL, applySummary, describeSide, divergenceLabel,
  pruneSelection, subjectLabel, toggleAll, toggleOne
} from "../lib/cnes";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { KeyValue } from "../components/KeyValue";
import { EmptyState } from "../components/EmptyState";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle } from "../components/formStyles";

export function Cnes({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = !!user && !user.operator && user.memberships.some((m) => m.role === "municipal_admin");
  const query = useQuery({ queryKey: CNES_KEY, queryFn: getCnes, enabled: isAdmin });
  const [ selected, setSelected ] = useState<Set<string>>(() => new Set());
  const [ confirming, setConfirming ] = useState<string[] | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const outcome = useRef("");
  const proposals = query.data?.proposals;

  useEffect(() => {
    if (proposals) setSelected((current) => pruneSelection(current, proposals));
  }, [ proposals ]);

  if (!user) return null;
  if (!isAdmin) {
    return (
      <div style={column}>
        <PageHeader title="CNES" sub="unidades · equipes · profissionais" />
        <EmptyState title="seu papel não permite ver o CNES" />
      </div>
    );
  }

  const data = query.data;
  const count = selected.size;

  return (
    <div style={column}>
      <PageHeader title="CNES" sub="unidades · equipes · profissionais" />
      {query.isError && <p role="alert" style={alertStyle}>{readError(query.error)}</p>}
      {done && <p role="status" style={statusStyle}>{done}</p>}
      {query.isPending && <p className="mono" style={loadingStyle}>carregando…</p>}

      {data && data.snapshot === null && (
        <Panel title="Retrato do CNES">
          <EmptyState title="nenhum retrato do CNES importado"
            sub="o operador da plataforma importa a base mensal do CNES; depois disso, as propostas aparecem aqui" />
        </Panel>
      )}

      {data && data.snapshot && (
        <>
          <Panel title="Retrato do CNES" sub="importado pelo operador da plataforma">
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <KeyValue k="Competência" v={competenceLabel(data.snapshot.competence)} />
              <KeyValue k="Importado em" v={fmtDateTime(data.snapshot.imported_at)} />
            </div>
          </Panel>

          {confirming && (
            <SensitiveAction
              title="Confirmar propostas do CNES"
              description={`${confirming.length === 1 ? "1 proposta será aplicada" : `${confirming.length} propostas serão aplicadas`} ao cadastro da cidade. Proposta que mudou desde a leitura é pulada.`}
              requiresStepUp
              confirmLabel="Aplicar"
              run={async () => { outcome.current = applySummary(await applyCnesProposals(confirming)); }}
              onDone={() => {
                setConfirming(null);
                setSelected(new Set());
                setDone(outcome.current);
                void queryClient.invalidateQueries({ queryKey: CNES_KEY });
              }}
              onCancel={() => setConfirming(null)}
              onGoToSecurity={onGoToSecurity}
              translateError={(err) =>
                (err as { body?: { error?: string } })?.body?.error === "invalid_proposals"
                  ? "seleção inválida — recarregue a lista e selecione de novo" : null}
            />
          )}

          <Panel title="Propostas" sub="nada é aplicado sem a sua confirmação" right={
            <button type="button" disabled={count === 0 || confirming !== null}
              style={count === 0 || confirming !== null ? disabledButtonStyle : buttonStyle}
              onClick={() => { setDone(null); setConfirming([ ...selected ]); }}>
              {`Confirmar selecionadas (${count})`}
            </button>
          }>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {data.proposals.length > 0 && (
                <label style={checkLabel}>
                  <input type="checkbox"
                    checked={data.proposals.every((p) => selected.has(p.id))}
                    onChange={() => setSelected((current) => toggleAll(current, data.proposals))} />
                  Selecionar todas
                </label>
              )}
              <DataTable<CnesProposal>
                cols={[
                  { label: "", w: "32px", render: (p) => (
                    <input type="checkbox" aria-label={`Selecionar: ${describeSide(p.cnes)}`} checked={selected.has(p.id)}
                      onChange={() => setSelected((current) => toggleOne(current, p.id))} />
                  ) },
                  { label: "Tipo", w: "1fr", render: (p) => PROPOSAL_KIND_LABEL[p.kind] ?? p.kind },
                  { label: "Ação", w: "1.2fr", render: (p) => PROPOSAL_ACTION_LABEL[p.action] ?? p.action },
                  { label: "No cadastro da cidade", w: "2fr", render: (p) => describeSide(p.local) },
                  { label: "No CNES", w: "2fr", render: (p) => describeSide(p.cnes) },
                  { label: "Casamento", w: "1fr", render: (p) =>
                    <Tag tone={CONFIDENCE[p.confidence]?.tone}>{CONFIDENCE[p.confidence]?.label ?? p.confidence}</Tag> }
                ]}
                rows={data.proposals}
                rowKey={(p) => p.id}
                empty="nenhuma proposta — o cadastro confere com o CNES"
              />
            </div>
          </Panel>

          <Panel title="Divergências" sub="corrija no cadastro ou na base do CNES">
            <DataTable<CnesDivergence>
              cols={[
                { label: "Divergência", w: "1.5fr", render: (d) => divergenceLabel(d.kind) },
                { label: "Onde", w: "1.5fr", render: (d) => subjectLabel(d.subject) },
                { label: "Detalhe", w: "2fr", render: (d) => d.detail ?? "—" }
              ]}
              rows={data.divergences}
              rowKey={(d) => `${d.kind}:${d.subject.type}:${d.subject.id}`}
              empty="nenhuma divergência"
            />
          </Panel>
        </>
      )}
    </div>
  );
}

function readError(err: unknown): string {
  const described = describeActionError(err);
  return "message" in described ? described.message : "não foi possível carregar o CNES — tente de novo";
}

const column = { display: "flex", flexDirection: "column" as const, gap: 16 };
const checkLabel = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink2)" };
const alertStyle = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const statusStyle = { margin: 0, fontSize: 13, fontWeight: 600 };
const loadingStyle = { margin: 0, fontSize: 10.5, color: "var(--ink3)" };
