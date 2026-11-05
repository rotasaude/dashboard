// Registro de matriciamento do CAPS com uma equipe da UBS (F-31.7; §7, P12, P23, P44): equipe (`options.health_teams`, "nome ·
// unidade"), data (não futura), tema (1 a 200), profissionais do CAPS (`options.team`, de 1 a 20) e o procedimento BPA-C
// (`matrixProcedures`: instrumento 01 e não 02). A tela confere tudo de uma vez; a recusa do api vem toda de uma vez (`instrument_mismatch`,
// `action_rejected` com `held_on` e `sigtap_code`) e vai ao campo. "Agora" é lido na hora do envio (`now` só nos testes): o formulário
// aberto desde ontem confere a data contra o dia de hoje. Sem duplo envio (`useFormProblems`).
import { useState } from "react";
import { createPsyMatrixSupport, type PsyMatrixSupport, type PsyOptions, type PsyUnit } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import {
  MATRIX_BPAC_NOTE, NO_HEALTH_TEAMS, NO_MATRIX_PROCEDURES, emptyMatrixDraft, matrixInput, matrixProblems, matrixProcedures, matrixRefusal, matrixTeamLabel,
  type MatrixDraft
} from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const OWN_FIELDS = [ "health_team_id", "held_on", "topic", "participants_user_ids", "sigtap_code" ];

export type MatrixFormProps = {
  unit: PsyUnit; options: PsyOptions; today?: string; now?: Date; onSaved(s: PsyMatrixSupport): void; onCancel(): void;
};

export function MatrixForm({ unit, options, today, now, onSaved, onCancel }: MatrixFormProps) {
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  const clock = () => now ?? new Date();
  const procs = matrixProcedures(options);
  const [ d, setD ] = useState<MatrixDraft>(() => emptyMatrixDraft(today ?? todayInCity(clock()), procs));
  const set = (patch: Partial<MatrixDraft>, ...paths: string[]) => { f.clear(...paths); setD((x) => ({ ...x, ...patch })); };
  const toggle = (userId: string, on: boolean) =>
    set({ userIds: on ? [ ...d.userIds, userId ] : d.userIds.filter((id) => id !== userId) }, "participants_user_ids");

  // Código gravado que saiu da lista aparece cru; nunca some.
  const lostCode = d.sigtapCode !== "" && !procs.some((p) => p.code === d.sigtapCode);

  return (
    <form ref={f.formRef} aria-label="Registrar matriciamento" style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => matrixProblems(d, todayInCity(clock())),
        call: () => createPsyMatrixSupport(matrixInput(d, unit.id)),
        ok: onSaved,
        refused: (refusals) => refusals.map(matrixRefusal)
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Registrar matriciamento</p>
      <p style={muted}>{MATRIX_BPAC_NOTE}</p>
      {f.top((path) => OWN_FIELDS.includes(path))}

      <label style={fieldLabel}>
        Equipe da UBS
        <select value={d.teamId} style={inputStyle} {...aria("health_team_id")} onChange={(ev) => set({ teamId: ev.target.value }, "health_team_id")}>
          <option value="">Escolha a equipe</option>
          {options.health_teams.map((t) => <option key={t.id} value={t.id}>{matrixTeamLabel(t, options.health_teams)}</option>)}
        </select>
      </label>
      {options.health_teams.length === 0 && <p style={muted}>{NO_HEALTH_TEAMS}</p>}
      {errNode("health_team_id")}

      <div style={row}>
        <label style={fieldLabel}>
          Data
          <input type="date" value={d.heldOn} max={todayInCity(clock())} style={inputStyle} {...aria("held_on")}
            onChange={(ev) => set({ heldOn: ev.target.value }, "held_on")} />
        </label>
      </div>
      {errNode("held_on")}

      <label style={fieldLabel}>
        Tema
        <input value={d.topic} autoComplete="off" style={inputStyle} {...aria("topic")} onChange={(ev) => set({ topic: ev.target.value }, "topic")} />
      </label>
      {errNode("topic")}

      <fieldset style={fieldset} {...aria("participants_user_ids")}>
        <legend style={legend}>Profissionais do CAPS</legend>
        {options.team.map((p) => (
          <label key={p.user_id} style={checkLabel}>
            <input type="checkbox" checked={d.userIds.includes(p.user_id)} onChange={(ev) => toggle(p.user_id, ev.target.checked)} />
            {p.name}
          </label>
        ))}
      </fieldset>
      {errNode("participants_user_ids")}

      <label style={fieldLabel}>
        Procedimento
        <select value={d.sigtapCode} style={inputStyle} {...aria("sigtap_code")} onChange={(ev) => set({ sigtapCode: ev.target.value }, "sigtap_code")}>
          <option value="">Escolha o procedimento</option>
          {procs.map((p) => <option key={p.code} value={p.code}>{`${p.code} · ${p.name}`}</option>)}
          {lostCode && <option value={d.sigtapCode}>{d.sigtapCode}</option>}
        </select>
      </label>
      {procs.length === 0 && <p style={muted}>{NO_MATRIX_PROCEDURES}</p>}
      {errNode("sigtap_code")}

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Salvar matriciamento</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
