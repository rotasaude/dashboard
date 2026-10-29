// src/modules/pharmacy/SettingsPanel.tsx
// Configurações da cidade (módulo 27a; F-27.1; contrato §3): os cinco números. Faixas do api (conferidas antes, as recusas do api
// são as mesmas): validades 1–365, intervalo do uso contínuo 1–90, alerta de validade 1–365, limite do ajuste 0–100.
// O corpo vai com NÚMEROS, e as cinco chaves sempre (o api recusa a ausência de qualquer uma). Escrita no step-up.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPharmacySettings, updatePharmacySettings } from "../../lib/api";
import type { PharmacySettings } from "../../lib/api";
import { PH_SETTINGS_KEY, STATIC_QUERY, pharmacyError, settingsProblem } from "../../lib/pharmacy";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";
import { fieldBox, fieldsetStyle, hintStyle, statusStyle } from "../regulation/styles";

const FIELDS: { key: keyof PharmacySettings; label: string; hint: string }[] = [
  { key: "common_validity_days", label: "Validade da receita comum (dias)", hint: "de 1 a 365" },
  { key: "continuous_validity_days", label: "Validade da receita de uso contínuo (dias)", hint: "de 1 a 365" },
  { key: "continuous_interval_days", label: "Intervalo do uso contínuo (dias)", hint: "de 1 a 90" },
  { key: "expiry_alert_days", label: "Alerta de validade (dias)", hint: "de 1 a 365" },
  { key: "adjustment_approval_percent", label: "Limite do ajuste sem aprovação (%)", hint: "de 0 a 100" }
];

type Raw = Record<keyof PharmacySettings, string>;

export function SettingsPanel({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const settings = useQuery({ queryKey: [ PH_SETTINGS_KEY ], queryFn: getPharmacySettings, ...STATIC_QUERY });
  // O aviso fica aqui: depois de salvar, a leitura nova remonta o formulário (a chave segue os valores).
  const [ notice, setNotice ] = useState<string | null>(null);
  return (
    <Panel title="Configurações" sub="prazos e limites da farmácia da cidade">
      {notice && <p role="status" style={statusStyle}>{notice}</p>}
      {settings.isPending && <p className="mono" style={muted}>carregando…</p>}
      {settings.isError && <p role="alert" style={alert}>{pharmacyError(settings.error)}</p>}
      {settings.data && <SettingsForm key={JSON.stringify(settings.data)} current={settings.data} onNotice={setNotice} onGoToSecurity={onGoToSecurity} />}
    </Panel>
  );
}

function SettingsForm({ current, onNotice, onGoToSecurity }: { current: PharmacySettings; onNotice(message: string | null): void; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const [ raw, setRaw ] = useState<Raw>(() => Object.fromEntries(FIELDS.map((f) => [ f.key, String(current[f.key]) ])) as Raw);
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);

  const set = (key: keyof PharmacySettings, value: string) => { setError(null); onNotice(null); setRaw({ ...raw, [key]: value }); };
  const body = (): PharmacySettings => Object.fromEntries(FIELDS.map((f) => [ f.key, Number(raw[f.key].trim()) ])) as unknown as PharmacySettings;

  function review() {
    const problem = settingsProblem(raw);
    if (problem) { setError(problem); return; }
    setConfirming(true);
  }

  return (
    <div style={form}>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          {FIELDS.map((f) => (
            <div key={f.key} style={fieldBox}>
              <label style={fieldLabel}>
                {f.label}
                <input value={raw[f.key]} inputMode="numeric" style={inputStyle} onChange={(e) => set(f.key, e.target.value)} />
              </label>
              <span style={hintStyle}>{f.hint}</span>
            </div>
          ))}
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && (
            <div style={row}>
              <button type="button" style={buttonStyle} onClick={review}>Revisar configurações</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => { setError(null); setRaw(Object.fromEntries(FIELDS.map((f) => [ f.key, String(current[f.key]) ])) as Raw); }}>
                Desfazer
              </button>
            </div>
          )}
        </div>
      </fieldset>
      {confirming && (
        <SensitiveAction
          title="Salvar as configurações da farmácia"
          description="Os novos prazos valem daqui em diante: receitas e ajustes já registrados não mudam."
          requiresStepUp
          confirmLabel="Salvar configurações"
          run={async () => { await updatePharmacySettings(body()); }}
          onDone={() => {
            setConfirming(false); onNotice("Configurações salvas.");
            void queryClient.invalidateQueries({ queryKey: [ PH_SETTINGS_KEY ] });
          }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => pharmacyError(err)}
        />
      )}
    </div>
  );
}
