// Cadastro e edição de um grupo, oficina ou assembleia do CAPS (F-31.4; P12, P25): nome, tipo, dia da semana (ISO), começo e fim
// ("HH:MM" de parede da cidade, o fim depois do começo), responsável lotado (`options.team`), vagas e o procedimento (instrumento 09 ou 01,
// coletivos primeiro). A tela confere tudo de uma vez (`groupProblems`); o api confere de novo a SIGTAP e o responsável quando mudam ou na
// reativação, e a recusa vai para o campo. A edição manda só o que mudou. Sem duplo envio (`useFormProblems`).
import { useState } from "react";
import { createPsyGroup, updatePsyGroup, type PsyGroup, type PsyOptions, type PsyUnit } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { todayInCity } from "../../lib/campaigns";
import {
  NO_GROUP_PROCEDURES, RESPONSIBLE_OUT, emptyGroupDraft, groupDraftOf, groupInput, groupKindLabel, groupPatch, groupProblems, groupProcedures,
  weekdayLabel, type GroupDraft
} from "../../lib/psychosocial";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { checkLabel, fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "./useFormProblems";

const OWN_FIELDS = [ "name", "kind", "weekday", "starts_at", "ends_at", "responsible_user_id", "capacity", "sigtap_code", "active" ];
const WEEKDAYS = [ 1, 2, 3, 4, 5, 6, 7 ];

export type GroupFormProps = {
  unit: PsyUnit; options: PsyOptions; initial?: PsyGroup; today?: string; onSaved(g: PsyGroup): void; onCancel(): void;
};

export function GroupForm({ unit, options, initial, today, onSaved, onCancel }: GroupFormProps) {
  const { user } = useAuth();
  const f = useFormProblems();
  const { aria, errNode, busy } = f;
  const [ d, setD ] = useState<GroupDraft>(() => (initial ? groupDraftOf(initial) : emptyGroupDraft(today ?? todayInCity(), user?.id ?? "", options)));
  const set = (patch: Partial<GroupDraft>, ...paths: string[]) => { f.clear(...paths); setD((x) => ({ ...x, ...patch })); };

  const procs = groupProcedures(options);
  // O código gravado que saiu da lista (outro CBO, outra competência) aparece cru, nunca some.
  const lostCode = d.sigtapCode !== "" && !procs.some((p) => p.code === d.sigtapCode);
  const lostResponsible = initial && !options.team.some((t) => t.user_id === initial.responsible.user_id) ? initial.responsible : null;
  const title = initial ? `Editar ${initial.name}` : "Novo grupo ou oficina";

  return (
    <form ref={f.formRef} aria-label={title} style={form} noValidate onSubmit={(ev) => {
      void f.submit(ev, {
        check: () => groupProblems(d),
        call: () => (initial ? updatePsyGroup(initial.id, groupPatch(d, initial)) : createPsyGroup(groupInput(d, unit.id))),
        ok: onSaved
      });
    }}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{title}</p>
      {f.top((path) => OWN_FIELDS.includes(path))}

      <label style={fieldLabel}>
        Nome
        <input value={d.name} autoComplete="off" style={inputStyle} {...aria("name")} onChange={(ev) => set({ name: ev.target.value }, "name")} />
      </label>
      {errNode("name")}

      <div style={row}>
        <label style={fieldLabel}>
          Tipo
          <select value={d.kind} style={inputStyle} {...aria("kind")} onChange={(ev) => set({ kind: ev.target.value }, "kind")}>
            {[ ...new Set([ ...options.group_kinds, d.kind ]) ].map((k) => <option key={k} value={k}>{groupKindLabel(k)}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Dia da semana
          <select value={d.weekday} style={inputStyle} {...aria("weekday")} onChange={(ev) => set({ weekday: ev.target.value }, "weekday")}>
            {WEEKDAYS.map((n) => <option key={n} value={String(n)}>{weekdayLabel(n)}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Começa
          <input type="time" value={d.startsAt} style={inputStyle} {...aria("starts_at")}
            onChange={(ev) => set({ startsAt: ev.target.value }, "starts_at", "ends_at")} />
        </label>
        <label style={fieldLabel}>
          Termina
          <input type="time" value={d.endsAt} style={inputStyle} {...aria("ends_at")} onChange={(ev) => set({ endsAt: ev.target.value }, "ends_at")} />
        </label>
      </div>
      {errNode("kind")}{errNode("weekday")}{errNode("starts_at")}{errNode("ends_at")}

      <div style={row}>
        <label style={fieldLabel}>
          Responsável
          <select value={d.responsibleUserId} style={inputStyle} {...aria("responsible_user_id")}
            onChange={(ev) => set({ responsibleUserId: ev.target.value }, "responsible_user_id")}>
            <option value="">Escolha o responsável</option>
            {options.team.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}
            {lostResponsible && <option value={lostResponsible.user_id}>{`${lostResponsible.name} (${RESPONSIBLE_OUT})`}</option>}
          </select>
        </label>
        <label style={fieldLabel}>
          Vagas
          <input value={d.capacity} inputMode="numeric" autoComplete="off" style={{ ...inputStyle, width: 90 }} {...aria("capacity")}
            onChange={(ev) => set({ capacity: ev.target.value }, "capacity")} />
        </label>
      </div>
      {errNode("responsible_user_id")}{errNode("capacity")}

      <label style={fieldLabel}>
        Procedimento
        <select value={d.sigtapCode} style={inputStyle} {...aria("sigtap_code")} onChange={(ev) => set({ sigtapCode: ev.target.value }, "sigtap_code")}>
          <option value="">Escolha o procedimento</option>
          {procs.map((p) => <option key={p.code} value={p.code}>{`${p.code} · ${p.name}`}</option>)}
          {lostCode && <option value={d.sigtapCode}>{d.sigtapCode}</option>}
        </select>
      </label>
      {procs.length === 0 && <p style={muted}>{NO_GROUP_PROCEDURES}</p>}
      {errNode("sigtap_code")}

      {initial && (
        <>
          <label style={checkLabel}>
            <input type="checkbox" checked={d.active} {...aria("active")} onChange={(ev) => set({ active: ev.target.checked }, "active", "sigtap_code", "responsible_user_id")} />
            Ativo
          </label>
          {errNode("active")}
        </>
      )}

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Salvar grupo</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
