// Início da sala de vacina na cidade (módulo 29; F-29.1): a data do go-live. O api só aceita de hoje − 2 anos a hoje + 1 ano
// (out_of_range) — o campo já limita a faixa pelo dia da CIDADE e a conferência repete a frase. Vazio limpa a data. Escrita no step-up.
import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getVaccinationSettings, updateVaccinationSettings } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { VAC_SETTINGS_KEY, STATIC_QUERY, vaccinationError } from "../../lib/vaccination";
import { Panel } from "../../components/Panel";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, row } from "../exams/styles";
import { fieldBox, fieldsetStyle, hintStyle, statusStyle } from "../regulation/styles";

export const GO_LIVE_HINT = "Quem nasceu a partir desta data já tem a caderneta conferida desde o nascimento.";
export const GO_LIVE_RANGE_TEXT = "a data precisa estar entre dois anos atrás e um ano à frente";

// Soma meses ao dia ISO, parando no fim do mês quando o dia não existe (como o api).
export function shiftMonths(date: string, months: number): string {
  const [ y, m, d ] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0, 12)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export function goLiveRange(today: string): { min: string; max: string } {
  return { min: shiftMonths(today, -24), max: shiftMonths(today, 12) };
}

export function GoLivePanel({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const settings = useQuery({ queryKey: [ VAC_SETTINGS_KEY ], queryFn: getVaccinationSettings, ...STATIC_QUERY });
  const [ notice, setNotice ] = useState<string | null>(null);
  return (
    <Panel title="Início na cidade" sub="a data a partir da qual a sala de vacina vale na cidade">
      <div role="status">{notice && <p style={statusStyle}>{notice}</p>}</div>
      {settings.isPending && <p className="mono" style={muted}>carregando…</p>}
      {settings.isError && <p role="alert" style={alert}>{vaccinationError(settings.error)}</p>}
      {settings.data && <GoLiveForm key={settings.data.go_live_on ?? "none"} current={settings.data.go_live_on} onNotice={setNotice} onGoToSecurity={onGoToSecurity} />}
    </Panel>
  );
}

function GoLiveForm({ current, onNotice, onGoToSecurity }: { current: string | null; onNotice(m: string | null): void; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const [ value, setValue ] = useState(current ?? "");
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const { min, max } = goLiveRange(todayInCity());

  const hint = useId();

  function review(e?: FormEvent) {
    e?.preventDefault();
    if (value !== "" && (value < min || value > max)) { setError(GO_LIVE_RANGE_TEXT); return; }
    setConfirming(true);
  }

  return (
    <div style={form}>
      <form style={form} onSubmit={review} noValidate>
      <fieldset disabled={confirming} style={fieldsetStyle}>
        <div style={form}>
          <div style={fieldBox}>
            <label style={fieldLabel}>
              Início da sala de vacina na cidade
              <input type="date" value={value} min={min} max={max} aria-describedby={hint} style={inputStyle}
                onChange={(e) => { setError(null); onNotice(null); setValue(e.target.value); }} />
            </label>
            <span id={hint} style={hintStyle}>{GO_LIVE_HINT}</span>
          </div>
          {error && <p role="alert" style={alert}>{error}</p>}
          {!confirming && (
            <div style={row}>
              <button type="submit" style={buttonStyle}>Salvar data</button>
              <button type="button" style={secondaryButtonStyle} onClick={() => { setError(null); setValue(current ?? ""); }}>Desfazer</button>
            </div>
          )}
        </div>
      </fieldset>
      </form>
      {confirming && (
        <SensitiveAction
          title={value === "" ? "Limpar a data de início da sala de vacina" : "Salvar a data de início da sala de vacina"}
          description="Quem nasceu a partir da data passa a ter a caderneta conferida desde o nascimento; a conferência não se desfaz."
          requiresStepUp
          confirmLabel="Salvar"
          run={async () => { await updateVaccinationSettings({ go_live_on: value === "" ? null : value }); }}
          onDone={() => {
            setConfirming(false); onNotice("Data de início salva.");
            void queryClient.invalidateQueries({ queryKey: [ VAC_SETTINGS_KEY ] });
          }}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => vaccinationError(err)}
        />
      )}
    </div>
  );
}
