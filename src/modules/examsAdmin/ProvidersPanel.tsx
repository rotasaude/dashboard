// src/modules/examsAdmin/ProvidersPanel.tsx
// Prestadores da cidade (spec §4 e §6; contrato §5): cadastro com os exames e
// prazos próprios, e os acessos (token FHIR e usuário do portal).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createExamProvider, errorCode, listCatalogItems, listExamProviders, updateExamProvider, type ExamProvider, type ExamProviderInput
} from "../../lib/api";
import {
  EXAM_ADMIN_CATALOG_KEY, EXAM_ADMIN_PROVIDERS_KEY, EXAM_PROVIDER_REFS_KEY, examError, providerKindLabel
} from "../../lib/exams";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { SensitiveAction } from "../../components/SensitiveAction";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { ProviderAccess } from "./ProviderAccess";
import { ProviderForm } from "./ProviderForm";
import { alert, muted, okText, row } from "../exams/styles";

type Editing = { provider: ExamProvider | null };
type Confirming = { provider: ExamProvider | null; input: ExamProviderInput };

export function ProvidersPanel({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const providers = useQuery({ queryKey: [ EXAM_ADMIN_PROVIDERS_KEY ], queryFn: listExamProviders, retry: false });
  const catalog = useQuery({ queryKey: [ EXAM_ADMIN_CATALOG_KEY ], queryFn: listCatalogItems, retry: false });
  const [ editing, setEditing ] = useState<Editing | null>(null);
  const [ confirming, setConfirming ] = useState<Confirming | null>(null);
  const [ access, setAccess ] = useState<ExamProvider | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const busy = editing !== null || access !== null;

  function reload() {
    void queryClient.invalidateQueries({ queryKey: [ EXAM_ADMIN_PROVIDERS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ EXAM_PROVIDER_REFS_KEY ] });
  }

  return (
    <Panel title="Prestadores" sub="laboratórios e serviços que recebem as guias · prazos próprios por exame">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {providers.isPending && <p className="mono" style={muted}>carregando…</p>}
        {providers.isError && <p role="alert" style={alert}>{examError(providers.error)}</p>}
        {providers.isSuccess && (
          <DataTable<ExamProvider>
            cols={[
              { label: "Nome", w: "1.6fr", card: "title", render: (p) => (
                // `simulated` é só leitura: o api nunca o grava (só a semente de dev).
                p.simulated ? <span style={row}>{p.name}<Tag tone="neutral">simulado</Tag></span> : p.name
              ) },
              { label: "Tipo", w: "1fr", render: (p) => providerKindLabel(p.kind) },
              { label: "CNES", w: "0.9fr", render: (p) => <span className="mono">{p.cnes ?? "—"}</span> },
              { label: "Exames", w: "0.6fr", align: "right", render: (p) => String(p.items.length) },
              { label: "Token FHIR", w: "0.9fr", render: (p) => (p.has_fhir_token ? "ativo" : "sem token") },
              { label: "Situação", w: "0.8fr", render: (p) => <Tag tone={p.active ? "ok" : "neutral"}>{p.active ? "ativo" : "inativo"}</Tag> },
              { label: "", w: "auto", align: "right", card: "actions", render: (p) => (
                <span style={row}>
                  <button type="button" aria-label={`Editar ${p.name}`} style={secondaryButtonStyle} disabled={busy}
                    onClick={() => { setNotice(null); setEditing({ provider: p }); }}>Editar</button>
                  <button type="button" aria-label={`Acesso de ${p.name}`} style={secondaryButtonStyle} disabled={busy}
                    onClick={() => { setNotice(null); setAccess(p); }}>Acesso</button>
                </span>
              ) }
            ]}
            rows={providers.data} rowKey={(p) => p.id} empty="nenhum prestador cadastrado"
          />
        )}
        {providers.isSuccess && !busy && (
          <div><button type="button" style={buttonStyle} onClick={() => { setNotice(null); setEditing({ provider: null }); }}>Novo prestador</button></div>
        )}
        {editing && catalog.isError && <p role="alert" style={alert}>{examError(catalog.error)}</p>}
        {editing && catalog.isSuccess && (
          <div hidden={confirming !== null}>
            <ProviderForm key={editing.provider?.id ?? "new"} initial={editing.provider ?? undefined} catalog={catalog.data}
              onReview={(input) => setConfirming({ provider: editing.provider, input })} onCancel={() => setEditing(null)} />
          </div>
        )}
        {confirming && (
          <SensitiveAction
            title={confirming.provider ? `Salvar ${confirming.provider.name}` : `Incluir o prestador ${confirming.input.name}`}
            description={`${providerKindLabel(confirming.input.kind)} · ${confirming.input.items.length} exames.`}
            requiresStepUp confirmLabel="Salvar prestador"
            run={async () => {
              if (confirming.provider) await updateExamProvider(confirming.provider.id, confirming.input);
              else await createExamProvider(confirming.input);
            }}
            onDone={() => { setConfirming(null); setEditing(null); setNotice("Prestador salvo."); reload(); }}
            onCancel={() => setConfirming(null)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) ? examError(err) : null)}
          />
        )}
        {access && (
          <ProviderAccess key={access.id} provider={access} onGoToSecurity={onGoToSecurity} onChanged={reload} onClose={() => setAccess(null)} />
        )}
      </div>
    </Panel>
  );
}
