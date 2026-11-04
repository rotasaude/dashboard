// Módulo 30 (F-30.1): regras do TFD e do acompanhante, só do municipal_admin. A escrita passa pelo step-up e o api substitui o mapa
// de complementos inteiro: o corpo leva TODOS os códigos preenchidos (`{}` limpa). Limites iguais aos do api (distância 1–1000,
// criança 0–17, idoso 50–100, complemento até R$ 10.000,00). Nada aqui é dado de cidadão.
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTransportSettings, listAllUnits, updateTransportSettings, type TransportSettings as Settings, type TransportSettingsInput } from "../lib/api";
import { STATIC_QUERY, TR_SETTINGS_KEY, fmtCents, parseReais, transportError } from "../lib/transport";
import type { Problem } from "../lib/pharmacy";
import { Panel } from "../components/Panel";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { TransportGate } from "./transport/TransportGate";
import { alert, fieldLabel, muted, okText, stack } from "./exams/styles";

export interface SettingsDraft { minKm: string; maxAgeChild: string; minAgeElderly: string; complements: Record<string, string> }

const MAX_COMPLEMENT_CENTS = 1_000_000;
const COMPANION_NOTE = "Padrão da CIT 13/2017: paciente até 15 anos ou a partir de 60 anos tem acompanhante; fora disso, a central informa o motivo.";
const intIn = (raw: string, lo: number, hi: number): number | null => (/^\d+$/.test(raw.trim()) && Number(raw) >= lo && Number(raw) <= hi ? Number(raw) : null);

export function settingsProblems(d: SettingsDraft): Problem[] {
  const out: Problem[] = [];
  if (intIn(d.minKm, 1, 1000) === null) out.push({ path: "tfd_min_distance_km", text: "a distância mínima precisa ser de 1 a 1000 km" });
  if (intIn(d.maxAgeChild, 0, 17) === null) out.push({ path: "companion_rule.max_age_child", text: "a idade da criança precisa ser de 0 a 17 anos" });
  if (intIn(d.minAgeElderly, 50, 100) === null) out.push({ path: "companion_rule.min_age_elderly", text: "a idade do idoso precisa ser de 50 a 100 anos" });
  for (const [ code, raw ] of Object.entries(d.complements)) {
    if (raw.trim() === "") continue;
    const cents = parseReais(raw);
    if (cents === null || cents > MAX_COMPLEMENT_CENTS) out.push({ path: `allowance_complements.${code}`, text: "o complemento precisa ser um valor em reais, de 0 a 10.000,00" });
  }
  return out;
}

function settingsBody(d: SettingsDraft, unitId: string): TransportSettingsInput {
  const complements: Record<string, number> = {};
  for (const [ code, raw ] of Object.entries(d.complements)) if (raw.trim() !== "") complements[code] = parseReais(raw) as number;
  return {
    tfd_min_distance_km: Number(d.minKm), companion_rule: { max_age_child: Number(d.maxAgeChild), min_age_elderly: Number(d.minAgeElderly) },
    tfd_billing_health_unit_id: unitId || null, allowance_complements: complements
  };
}

const centsText = (cents: number): string => fmtCents(cents).replace(/^R\$\s*/, "").replace(/ /g, "").replace(/\./g, "");
const lineStyle: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 140px", gap: 12, alignItems: "end" };

export function TransportSettings({ onGoToSecurity }: { onGoToSecurity?: () => void } = {}) {
  return (
    <TransportGate title="Regras do TFD e do acompanhante" sub="Distância mínima, acompanhante, CNES e complemento" area="transport" allow={(r) => r.admin}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </TransportGate>
  );
}

function Body({ onGoToSecurity }: { onGoToSecurity?: () => void }) {
  const settings = useQuery({ queryKey: [ TR_SETTINGS_KEY ], queryFn: getTransportSettings, ...STATIC_QUERY });
  const units = useQuery({ queryKey: [ TR_SETTINGS_KEY, "units" ], queryFn: listAllUnits, ...STATIC_QUERY });
  return (
    <Panel title="Regras do TFD" sub="valem para os próximos laudos e viagens">
      <div style={stack}>
        {settings.isPending && <p className="mono" style={muted}>carregando…</p>}
        {settings.isError && <p role="alert" style={alert}>{transportError(settings.error)}</p>}
        {units.isError && <p role="alert" style={alert}>{transportError(units.error)}</p>}
        {settings.data && units.data && (
          <SettingsForm key={JSON.stringify(settings.data)} saved={settings.data} gestao={units.data.filter((u) => u.kind === "health_management" && (u.active || u.id === settings.data.tfd_billing_health_unit_id))}
            onGoToSecurity={onGoToSecurity} />
        )}
      </div>
    </Panel>
  );
}

function SettingsForm({ saved, gestao, onGoToSecurity }: { saved: Settings; gestao: { id: string; name: string }[]; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const [ draft, setDraft ] = useState<SettingsDraft>({
    minKm: String(saved.tfd_min_distance_km), maxAgeChild: String(saved.companion_rule.max_age_child), minAgeElderly: String(saved.companion_rule.min_age_elderly),
    complements: Object.fromEntries(saved.allowance_codes.map((c) => [ c.code, saved.allowance_complements[c.code] === undefined ? "" : centsText(saved.allowance_complements[c.code]) ]))
  });
  const [ unitId, setUnitId ] = useState(saved.tfd_billing_health_unit_id ?? "");
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ confirming, setConfirming ] = useState(false);
  const [ done, setDone ] = useState(false);

  const set = (patch: Partial<SettingsDraft>) => { setDraft((d) => ({ ...d, ...patch })); setDone(false); };
  const err = (path: string) => problems.filter((p) => p.path === path).map((p) => <span key={p.text} style={alert}>{p.text}</span>);
  function review() {
    const found = settingsProblems(draft);
    setProblems(found);
    if (found.length === 0) setConfirming(true);
  }

  return (
    <form style={stack} onSubmit={(e) => { e.preventDefault(); review(); }}>
      {done && <p role="status" style={okText}>Regras salvas.</p>}
      <label style={fieldLabel}>
        Distância mínima do TFD (km)
        <input value={draft.minKm} inputMode="numeric" onChange={(e) => set({ minKm: e.target.value })} style={inputStyle} />
        {err("tfd_min_distance_km")}
      </label>
      <label style={fieldLabel}>
        Criança até (anos)
        <input value={draft.maxAgeChild} inputMode="numeric" onChange={(e) => set({ maxAgeChild: e.target.value })} style={inputStyle} />
        {err("companion_rule.max_age_child")}
      </label>
      <label style={fieldLabel}>
        Idoso a partir de (anos)
        <input value={draft.minAgeElderly} inputMode="numeric" onChange={(e) => set({ minAgeElderly: e.target.value })} style={inputStyle} />
        {err("companion_rule.min_age_elderly")}
      </label>
      <p style={muted}>{COMPANION_NOTE}</p>
      <label style={fieldLabel}>
        Unidade do BPA do TFD
        <select value={unitId} onChange={(e) => { setUnitId(e.target.value); setDone(false); }} style={inputStyle}>
          <option value="">Escolha a unidade de gestão</option>
          {gestao.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      <p style={muted}>A unidade precisa ter CNES; é obrigatória enquanto o faturamento de procedimentos estiver ligado.</p>
      <fieldset style={{ ...stack, border: "1px solid var(--rule)", borderRadius: 8, padding: 12, margin: 0 }}>
        <legend style={{ fontSize: 12.5, fontWeight: 600 }}>Complemento por código SIGTAP (R$; vazio = sem complemento)</legend>
        {saved.allowance_codes.map((c) => (
          <div key={c.code} style={lineStyle}>
            <label htmlFor={`cx-${c.code}`} style={{ fontSize: 12, color: "var(--ink2)" }}>{c.name ? `${c.code} — ${c.name}` : c.code}</label>
            <div style={stack}>
              <input id={`cx-${c.code}`} value={draft.complements[c.code] ?? ""} inputMode="decimal" placeholder="0,00" style={inputStyle}
                onChange={(e) => set({ complements: { ...draft.complements, [c.code]: e.target.value } })} />
              {err(`allowance_complements.${c.code}`)}
            </div>
          </div>
        ))}
      </fieldset>
      <div><button type="submit" style={buttonStyle}>Salvar regras</button></div>
      {confirming && (
        <SensitiveAction
          title="Salvar as regras do TFD"
          description="As regras valem para os próximos laudos e viagens; o que já foi calculado não muda."
          requiresStepUp
          run={() => updateTransportSettings(settingsBody(draft, unitId)).then(() => undefined)}
          onDone={() => { setConfirming(false); setDone(true); void queryClient.invalidateQueries({ queryKey: [ TR_SETTINGS_KEY ] }); }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => transportError(e)}
        />
      )}
    </form>
  );
}
