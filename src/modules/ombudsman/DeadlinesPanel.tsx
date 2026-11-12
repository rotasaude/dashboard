// Prazos da ouvidoria (módulo 33; F-33.1): os oito números da configuração, um "Salvar prazos" que manda o corpo inteiro. Cada campo
// aceita só inteiro (1–120 dias; teto de 1–1000): o que não cabe é recusado, nunca cortado nem arredondado. O prazo é sempre o da
// configuração vigente, então mudar vale também para as manifestações já abertas (Q17). Nada em storage.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getOmbudsmanSettings, updateOmbudsmanSettings, type OmbudsmanSettings } from "../../lib/api";
import { OMB_SETTINGS_KEY, STATIC_QUERY, ombudsmanRefusals, settingsProblems } from "../../lib/ombudsman";
import { Panel } from "../../components/Panel";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";
import { fieldLabel, form, muted, okText, row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";

const FIELDS: { key: keyof OmbudsmanSettings; label: string }[] = [
  { key: "response_days", label: "Resposta ao cidadão (dias)" },
  { key: "extension_days", label: "Prorrogação (dias)" },
  { key: "urgent_days", label: "Manifestação urgente (dias)" },
  { key: "complement_days", label: "Prazo do complemento (dias)" },
  { key: "forwarding_days", label: "Resposta do destino (dias)" },
  { key: "forwarding_extension_days", label: "Prorrogação do destino (dias)" },
  { key: "warning_days", label: "Aviso de prazo perto do fim (dias antes)" },
  { key: "anonymous_daily_cap", label: "Teto diário de denúncias anônimas" }
];
export const DEADLINES_NOTE = "Os prazos padrão vêm do modelo federal; confira o decreto municipal de ouvidoria (gate do go-live).";
export const DEADLINES_OPEN_NOTE = "Mudar um prazo vale também para as manifestações já abertas: elas passam a contar pelo prazo novo.";
export const DEADLINES_SAVED = "Prazos salvos.";

type Draft = Record<keyof OmbudsmanSettings, string>;
const toDraft = (s: OmbudsmanSettings): Draft => Object.fromEntries(FIELDS.map((f) => [ f.key, String(s[f.key]) ])) as Draft;
// Só dígitos viram número; o resto vira NaN e é recusado por `settingsProblems`.
const num = (raw: string): number => (/^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
const toSettings = (d: Draft): OmbudsmanSettings => Object.fromEntries(FIELDS.map((f) => [ f.key, num(d[f.key]) ])) as unknown as OmbudsmanSettings;

function DeadlinesForm({ saved }: { saved: OmbudsmanSettings }) {
  const queryClient = useQueryClient();
  const f = useFormProblems({ refusals: (err) => ombudsmanRefusals(err).map((r) => ({ ...r, participantIndex: null })) });
  const [ draft, setDraft ] = useState<Draft>(() => toDraft(saved));
  const [ done, setDone ] = useState(false);
  const set = (key: keyof OmbudsmanSettings, value: string) => { f.clear(key); setDone(false); setDraft((d) => ({ ...d, [key]: value })); };
  const own = (path: string) => FIELDS.some((x) => x.key === path);
  return (
    <form ref={f.formRef} aria-label="Prazos" style={form} noValidate onSubmit={(ev) => {
      setDone(false);
      void f.submit(ev, {
        check: () => settingsProblems(toSettings(draft)),
        call: () => updateOmbudsmanSettings(toSettings(draft)),
        ok: (next) => { queryClient.setQueryData([ OMB_SETTINGS_KEY ], next); setDraft(toDraft(next)); setDone(true); }
      });
    }}>
      {f.top(own)}
      {FIELDS.map(({ key, label }) => (
        <div key={key} style={fieldLabel}>
          <label htmlFor={f.fid(key)}>{label}</label>
          <input id={f.fid(key)} type="text" inputMode="numeric" style={inputStyle} value={draft[key]} onChange={(e) => set(key, e.target.value)} {...f.aria(key)} />
          {f.errNode(key)}
        </div>
      ))}
      <p style={muted}>{DEADLINES_NOTE}</p>
      <p style={muted}>{DEADLINES_OPEN_NOTE}</p>
      <div style={row}>
        <button type="submit" disabled={f.busy} style={f.busy ? disabledButtonStyle : buttonStyle}>Salvar prazos</button>
      </div>
      {done && <p role="status" style={okText}>{DEADLINES_SAVED}</p>}
    </form>
  );
}

export function DeadlinesPanel() {
  const settings = useQuery({ queryKey: [ OMB_SETTINGS_KEY ], queryFn: getOmbudsmanSettings, ...STATIC_QUERY });
  return (
    <Panel title="Prazos" sub="dias e teto de denúncias anônimas">
      {settings.isPending && <p className="mono" style={muted}>carregando…</p>}
      {settings.isError && <p role="alert" style={{ margin: 0, color: "var(--down)" }}>{ombudsmanRefusals(settings.error)[0].text}</p>}
      {settings.data && <DeadlinesForm saved={settings.data} />}
    </Panel>
  );
}
