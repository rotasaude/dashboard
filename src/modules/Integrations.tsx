// src/modules/Integrations.tsx
// Integrações da cidade (módulo 16; ADR 0028; spec §3; contratos §5.1): só
// municipal_admin. Modo, endereço do PEC e IBGE são do operador da plataforma
// e aparecem só como estado. Credenciais são da cidade: cadastrar e trocar
// passam pelo step-up (SensitiveAction); testar conexão não. Interruptores
// são do mantenedor e aparecem com o que falta, em linguagem simples.
// Nenhum segredo chega aqui; a senha digitada só vive no SensitiveAction.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  checkIntegrationCredential, getIntegrations, setIntegrationCredential,
  type CityFeatureState, type IntegrationCredential
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { featureLabel } from "../lib/features";
import {
  INTEGRATIONS_KEY, checkLabel, checkSummary, credentialLabel, featureState, integrationsError, missingPhrase,
  recordModeLabel, setSummary
} from "../lib/integrations";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { KeyValue } from "../components/KeyValue";
import { EmptyState } from "../components/EmptyState";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../components/formStyles";

const SCREEN_ERRORS = [ "invalid_credential", "unknown_kind" ];

export function Integrations({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = !!user && !user.operator && user.memberships.some((m) => m.role === "municipal_admin");
  const query = useQuery({ queryKey: INTEGRATIONS_KEY, queryFn: getIntegrations, enabled: isAdmin });
  const [ checking, setChecking ] = useState<string | null>(null);
  const [ editing, setEditing ] = useState<IntegrationCredential | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const saved = useRef("");

  if (!user) return null;
  if (!isAdmin) {
    return (
      <div style={column}>
        <PageHeader title="Integrações" sub="e-SUS PEC · CADSUS" />
        <EmptyState title="seu papel não permite ver as integrações" />
      </div>
    );
  }

  const reload = () => void queryClient.invalidateQueries({ queryKey: INTEGRATIONS_KEY });

  async function check(c: IntegrationCredential) {
    if (checking) return;
    setChecking(c.kind); setNotice(null); setError(null);
    try {
      const updated = await checkIntegrationCredential(c.kind);
      setNotice(`Teste de conexão — ${credentialLabel(c.kind)}: ${checkLabel(updated.last_check_status)}`);
      reload();
    } catch (err) {
      setError(integrationsError(err));
    } finally {
      setChecking(null);
    }
  }

  const data = query.data;

  return (
    <div style={column}>
      <PageHeader title="Integrações" sub="e-SUS PEC · CADSUS" />
      {query.isError && <p role="alert" style={alertStyle}>{integrationsError(query.error)}</p>}
      {error && <p role="alert" style={alertStyle}>{error}</p>}
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      {query.isPending && <p className="mono" style={loadingStyle}>carregando…</p>}

      {editing && (
        <SensitiveAction
          key={editing.kind}
          title={`${editing.set ? "Trocar" : "Cadastrar"} credencial — ${credentialLabel(editing.kind)}`}
          description="A senha é gravada cifrada e não aparece de novo, nem para você. Trocar substitui a anterior."
          requiresStepUp
          fields={[
            { name: "username", label: "Usuário", required: true },
            { name: "password", label: "Senha", type: "password", required: true }
          ]}
          confirmLabel="Salvar credencial"
          run={async (values) => {
            // Usuário sem espaços nas pontas; a senha vai como digitada.
            await setIntegrationCredential(editing.kind, values.username.trim(), values.password);
            saved.current = `Credencial do ${credentialLabel(editing.kind)} salva. Teste a conexão para conferir.`;
          }}
          onDone={() => { setEditing(null); setError(null); setNotice(saved.current); reload(); }}
          onCancel={() => setEditing(null)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => {
            const code = (err as { body?: { error?: string } })?.body?.error;
            return code && SCREEN_ERRORS.includes(code) ? integrationsError(err) : null;
          }}
        />
      )}

      {data && (
        <>
          <Panel title="Prontuário da cidade" sub="definido pelo operador da plataforma">
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <KeyValue k="Modo" v={recordModeLabel(data.record_mode)} mono={false} />
              <KeyValue k="Endereço do PEC" v={data.pec_url_set ? "cadastrado" : "não cadastrado"} mono={false} />
              <KeyValue k="Código IBGE" v={data.ibge_code_set ? "cadastrado" : "não cadastrado"} mono={false} />
            </div>
          </Panel>

          <Panel title="Credenciais" sub="da cidade · a senha nunca aparece de novo">
            <DataTable<IntegrationCredential>
              cols={[
                { label: "Integração", w: "1.4fr", render: (c) => credentialLabel(c.kind) },
                { label: "Cadastro", w: "2fr", render: (c) => setSummary(c) },
                { label: "Último teste", w: "2fr", render: (c) => <CheckCell credential={c} /> },
                { label: "", w: "auto", align: "right", render: (c) => (
                  <span style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" aria-label={`${c.set ? "Trocar" : "Cadastrar"} — ${credentialLabel(c.kind)}`}
                      style={buttonStyle}
                      onClick={() => { setNotice(null); setError(null); setEditing(c); }}>
                      {c.set ? "Trocar" : "Cadastrar"}
                    </button>
                    <button type="button" aria-label={`Testar conexão — ${credentialLabel(c.kind)}`}
                      disabled={!c.set || checking !== null}
                      style={!c.set || checking !== null ? disabledButtonStyle : secondaryButtonStyle}
                      onClick={() => void check(c)}>
                      {checking === c.kind ? "testando…" : "Testar conexão"}
                    </button>
                  </span>
                ) }
              ]}
              rows={data.credentials}
              rowKey={(c) => c.kind}
              empty="nenhuma credencial prevista"
            />
          </Panel>

          <Panel title="Funcionalidades" sub="ligadas e desligadas pela equipe do Rota Saúde">
            {data.features.length === 0 ? <EmptyState title="nenhuma funcionalidade com interruptor" /> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.features.map((f) => <FeatureRow key={f.key} feature={f} />)}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

function CheckCell({ credential }: { credential: IntegrationCredential }) {
  const summary = checkSummary(credential);
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span><Tag tone={summary.tone}>{summary.text}</Tag></span>
      {credential.last_check_message && <small style={hint}>{credential.last_check_message}</small>}
    </span>
  );
}

function FeatureRow({ feature }: { feature: CityFeatureState }) {
  const state = featureState(feature);
  return (
    <section aria-label={featureLabel(feature.key)} style={featureBox}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>{featureLabel(feature.key)}</strong>
        <Tag tone={state.tone}>{state.label}</Tag>
      </div>
      {feature.missing.length > 0 && (
        <>
          <p style={hint}>{feature.enabled ? "Para voltar a funcionar:" : "Antes de ligar, falta:"}</p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ink2)" }}>
            {feature.missing.map((code) => <li key={code}>{missingPhrase(code)}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}

const column = { display: "flex", flexDirection: "column" as const, gap: 16 };
const featureBox = { display: "flex", flexDirection: "column" as const, gap: 6, padding: "10px 12px",
  border: "1px solid var(--rule)", borderRadius: 8 };
const hint = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alertStyle = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const statusStyle = { margin: 0, fontSize: 13, fontWeight: 600 };
const loadingStyle = { margin: 0, fontSize: 10.5, color: "var(--ink3)" };
