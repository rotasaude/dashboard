// src/modules/BillingSettings.tsx
// Configuração do faturamento da cidade (contrato §6; Divergência B10): o que
// vai no cabeçalho do arquivo do BPA Magnético — nome e sigla do órgão de
// origem, CNPJ de origem, órgão de destino e gestão (M/E). Só o
// municipal_admin; salvar passa pelo step-up. As larguras do layout são
// conferidas aqui (recusar, nunca cortar) e de novo no api.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getBillingSettings, saveBillingSettings, type BillingSettings as Settings } from "../lib/api";
import {
  DESTINATION_MAX, ORIGIN_ACRONYM_MAX, ORIGIN_NAME_MAX, SETTINGS_KEY, billingError, settingsBody, settingsComplete, settingsDraft, settingsProblem,
  type SettingsDraft
} from "../lib/billing";
import { formatCnpj } from "../lib/clinicalDocuments";
import { Panel } from "../components/Panel";
import { KeyValue } from "../components/KeyValue";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, form, grid, muted, row, stack } from "./exams/styles";
import { BillingGate } from "./billing/BillingGate";

const MANAGEMENT_LABEL: Record<string, string> = { M: "municipal (M)", E: "estadual (E)" };
const NOT_SET = "não preenchido";

export function BillingSettings({ onGoToSecurity }: { onGoToSecurity?(): void } = {}) {
  return (
    <BillingGate title="Configuração do faturamento" sub="cabeçalho do arquivo do BPA Magnético · administração municipal" allow={(r) => r.admin}>
      {() => <SettingsBody onGoToSecurity={onGoToSecurity} />}
    </BillingGate>
  );
}

function SettingsBody({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [ SETTINGS_KEY ], queryFn: getBillingSettings, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  const [ draft, setDraft ] = useState<SettingsDraft | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const settings: Settings | null = query.data ?? null;
  const set = (patch: Partial<SettingsDraft>) => { setError(null); setDraft((d) => (d ? { ...d, ...patch } : d)); };

  function review() {
    if (!draft) return;
    const problem = settingsProblem(draft);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  // A dica fica fora do <label>: o nome acessível do campo é só o rótulo.
  const text = (label: string, key: keyof SettingsDraft, hint: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label style={fieldLabel}>
        {label}
        <input value={draft?.[key] ?? ""} style={inputStyle} onChange={(e) => set({ [key]: e.target.value } as Partial<SettingsDraft>)} />
      </label>
      <span style={hintStyle}>{hint}</span>
    </div>
  );

  return (
    <Panel title="Cabeçalho do arquivo BPA" sub="vale para todas as competências fechadas daqui em diante">
      <div style={{ ...stack, padding: 16 }}>
        {query.isPending && <p className="mono" style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{billingError(query.error)}</p>}
        {notice && <p role="status" style={statusStyle}>{notice}</p>}
        {query.isSuccess && (
          <div style={grid}>
            <KeyValue k="Órgão de origem" v={settings?.origin_name ?? NOT_SET} mono={false} />
            <KeyValue k="Sigla" v={settings?.origin_acronym || NOT_SET} />
            <KeyValue k="CNPJ de origem" v={settings?.origin_cnpj ? formatCnpj(settings.origin_cnpj) : NOT_SET} />
            <KeyValue k="Órgão de destino" v={settings?.destination_body ?? NOT_SET} mono={false} />
            <KeyValue k="Gestão" v={settings?.management ? MANAGEMENT_LABEL[settings.management] : NOT_SET} mono={false} />
          </div>
        )}
        {query.isSuccess && !settingsComplete(settings) && (
          <p style={muted}>Sem a configuração completa, o faturista não consegue fechar competência.</p>
        )}
        {query.isSuccess && !draft && (
          <div>
            <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setConfirming(false); setDraft(settingsDraft(settings)); }}>
              {settingsComplete(settings) ? "Editar configuração" : "Configurar faturamento"}
            </button>
          </div>
        )}
        {draft && !confirming && (
          <section aria-label="Editar configuração do faturamento" style={box}>
            <div style={form}>
              {text("Nome do órgão de origem", "originName", `até ${ORIGIN_NAME_MAX} caracteres (largura do arquivo)`)}
              {text("Sigla do órgão de origem", "originAcronym", `até ${ORIGIN_ACRONYM_MAX} caracteres`)}
              {text("CNPJ de origem", "originCnpj", "secretaria ou fundo municipal de saúde")}
              {text("Órgão de destino", "destinationBody", `até ${DESTINATION_MAX} caracteres`)}
              <label style={fieldLabel}>
                Gestão
                <select value={draft.management} style={inputStyle} onChange={(e) => set({ management: e.target.value as SettingsDraft["management"] })}>
                  <option value="">escolha a gestão</option>
                  <option value="M">municipal (M)</option>
                  <option value="E">estadual (E)</option>
                </select>
              </label>
              {error && <p role="alert" style={alert}>{error}</p>}
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => { setDraft(null); setError(null); }}>Cancelar</button>
              </div>
            </div>
          </section>
        )}
        {draft && confirming && (
          <SensitiveAction
            title="Salvar a configuração do faturamento"
            description={`Origem: ${draft.originName.trim()}${draft.originAcronym.trim() ? ` (${draft.originAcronym.trim()})` : ""}, CNPJ ${formatCnpj(settingsBody(draft).origin_cnpj)}; destino: ${draft.destinationBody.trim()}; gestão ${MANAGEMENT_LABEL[draft.management] ?? draft.management}. Vale para os próximos arquivos; os já gerados não mudam.`}
            requiresStepUp
            confirmLabel="Salvar configuração"
            run={async () => { await saveBillingSettings(settingsBody(draft)); }}
            onDone={() => {
              setDraft(null); setConfirming(false); setNotice("Configuração do faturamento salva.");
              void queryClient.invalidateQueries({ queryKey: [ SETTINGS_KEY ] });
            }}
            onCancel={() => setConfirming(false)}
            onGoToSecurity={onGoToSecurity}
            translateError={(err) => (errorCode(err) ? billingError(err) : null)}
          />
        )}
      </div>
    </Panel>
  );
}

const hintStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink3)" };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
