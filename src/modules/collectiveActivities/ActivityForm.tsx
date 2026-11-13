// src/modules/collectiveActivities/ActivityForm.tsx
// Nova atividade coletiva (módulo 24b, F-24.12), para o celular (campos empilhados, 375 px): equipe, data, turno, tipo, local,
// número de participantes, as listas de códigos, o procedimento SIGTAP, os profissionais e os participantes.
// O que cada tipo exige, proíbe ou aceita vem de `options.domains.rules` (`fieldRule` e companhia, Task 3): nada escrito aqui.
// Toda troca passa por `pruneActivityDraft` (o que ficou proibido sai). Sem `altered_count` no corpo: a tela mostra o calculado (Q38).
// Envio idempotente (`useIdempotentSubmit`, o mesmo da visita): o mesmo `client_uuid` no reenvio depois de rede/5xx, com tudo
// travado; 429 mantém o formulário e o uuid (Q68). A recusa do api cai no campo do `path`; as de um participante reabrem o
// `PersonPick` dele (D-9; Q41/Q49/Q71), e o `duplicate_participant` confirmável oferece "É outra pessoa" (Q54).
// Sem rascunho: fechar perde o que foi digitado (com confirmação se algo foi preenchido). Dado pessoal só em estado e no corpo.
import { useId, useRef, useState, type FormEvent } from "react";
import { recordCollectiveActivity, type CollectiveActivity, type CollectiveOptions, type VisitCandidate, type VisitShift } from "../../lib/api";
import {
  ACTIVITY_NETWORK_RETRY, DISCARD_UNCERTAIN_ACTIVITY, NO_CNS_PROFESSIONAL, OTHER_TEAM_PROFESSIONAL, activityBody, activityProblems, activityWarnings, alteredCount, emptyActivityDraft,
  fieldRule, healthTopicsAllowed, needsProcedure, offeredHealthTopics, offeredPractices, pruneActivityDraft, smokingAllowed, type ActivityDraft,
  type ParticipantDraft
} from "../../lib/collectiveActivities";
import { shiftLabel, type HomeVisitRefusal } from "../../lib/homeVisits";
import type { Problem } from "../../lib/pharmacy";
import { ConfirmButton } from "../../components/ConfirmButton";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import type { PickedPerson } from "../homeVisits/PersonPick";
import { useIdempotentSubmit } from "../homeVisits/useIdempotentSubmit";
import { CodeChecklist } from "./CodeChecklist";
import { ParticipantsField, type ParticipantPatch, type ParticipantPick } from "./ParticipantsField";

export type ActivitySaved = { activity: CollectiveActivity; replayed: boolean };
type ListKey = "meetingTopics" | "targetAudience" | "healthTopics" | "healthPractices";

const SHIFTS: VisitShift[] = [ 1, 2, 3 ];
const NO_EVENT = { preventDefault: () => {} } as FormEvent;
const OWN = /^(team_id|held_on|shift|activity_type|place_health_unit_id|place_text|participants_count|procedure_code|meeting_topics|target_audience|health_topics|health_practices|professionals|participants)(\[|\.|$)/;
const isOwn = (path: string) => OWN.test(path);
const PARTICIPANT = /^participants\[(\d+)\](?:\.(.*))?$/;

function candidatesOf(err: unknown): VisitCandidate[] {
  const body = (err as { body?: unknown } | null)?.body;
  const list = body && typeof body === "object" ? (body as { candidates?: unknown }).candidates : null;
  return Array.isArray(list) ? (list as VisitCandidate[]) : [];
}

type Extras = Pick<ParticipantDraft, "altered" | "weight" | "height" | "smoking">;
const NO_EXTRAS: Extras = { altered: false, weight: "", height: "", smoking: null };
const toParticipant = (c: PickedPerson, x: Extras): ParticipantDraft =>
  c.kind === "patient"
    ? { kind: "patient", patientId: c.patientId, displayName: c.displayName, hasCpf: c.hasCpf, hasCns: c.hasCns, ...x }
    : { kind: "new", patient: c.patient, duplicatesReviewed: c.duplicatesReviewed, ...x };

// `onClose(uncertain)`: `true` quando se descartou um envio pendurado (rede/5xx) — o pai relê a lista uma vez.
export function ActivityForm({ options, onSaved, onClose }: { options: CollectiveOptions; onSaved(r: ActivitySaved): void; onClose(uncertain?: boolean): void }) {
  const { domains } = options;
  const uid = useId();
  const s = useIdempotentSubmit({ networkText: ACTIVITY_NETWORK_RETRY });
  const teams = options.teams.filter((t) => t.can_register);
  const [ initial ] = useState<ActivityDraft>(() => ({ ...emptyActivityDraft(options.today), teamId: teams.length === 1 ? teams[0].id : null }));
  const [ draft, setDraft ] = useState<ActivityDraft>(initial);
  const [ pick, setPick ] = useState<ParticipantPick | null>(null);
  // Participantes com `duplicate_participant` confirmável (Q54).
  const [ confirmable, setConfirmable ] = useState<number[]>([]);
  const picks = useRef(0);

  const frozen = s.locked || s.busy;
  const type = draft.activityType;
  const team = teams.find((t) => t.id === draft.teamId) ?? null;
  const update = (next: ActivityDraft) => {
    const pruned = pruneActivityDraft(domains, next);
    // A regra esvaziou a lista: os índices deixam de valer, como no "Retirar" — sem marca confirmável, seletor nem recusa velha.
    if (pruned.participants.length !== next.participants.length) resetParticipantMarks();
    setDraft(pruned);
  };
  function resetParticipantMarks() {
    s.clear(...s.problems.filter((p) => p.path.startsWith("participants")).map((p) => p.path));
    setConfirmable([]);
    setPick(null);
  }
  const openPick = (p: Omit<ParticipantPick, "n"> | null) => { if (!p) { setPick(null); return; } picks.current += 1; setPick({ ...p, n: picks.current }); };
  const clearParticipant = (i: number) =>
    s.clear(...s.problems.filter((p) => p.path === `participants[${i}]` || (p.path.startsWith(`participants[${i}].`) && !p.path.includes(".measurements."))).map((p) => p.path), "participants");

  function toggleList(key: ListKey, path: string, code: number) {
    const list = draft[key];
    s.clear(path, ...list.map((_, i) => `${path}[${i}]`), ...(key === "healthPractices" ? [ "procedure_code" ] : []));
    update({ ...draft, [key]: list.includes(code) ? list.filter((c) => c !== code) : [ ...list, code ] });
  }
  function toggleProfessional(id: string) {
    s.clear(...draft.professionals.map((_, i) => `professionals[${i}]`));
    setDraft((d) => ({ ...d, professionals: d.professionals.includes(id) ? d.professionals.filter((p) => p !== id) : [ ...d.professionals, id ] }));
  }
  function choose(index: number | null, c: PickedPerson) {
    setPick(null);
    if (index === null) {
      s.clear("participants", "participants_count");
      update({ ...draft, participants: [ ...draft.participants, toParticipant(c, NO_EXTRAS) ] });
      return;
    }
    clearParticipant(index);
    setConfirmable((list) => list.filter((i) => i !== index));
    // Trocar a pessoa guarda o que já se marcou dela (avaliação, medidas, tabagismo).
    update({ ...draft, participants: draft.participants.map((p, i) => (i === index
      ? toParticipant(c, { altered: p.altered, weight: p.weight, height: p.height, smoking: p.smoking }) : p)) });
  }
  function patch(index: number, change: ParticipantPatch) {
    s.clear(...Object.keys(change).map((k) => (k === "weight" ? `participants[${index}].measurements.weight_kg` : k === "height"
      ? `participants[${index}].measurements.height_cm` : `participants[${index}].${k}`)));
    setDraft((d) => ({ ...d, participants: d.participants.map((p, i) => (i === index ? { ...p, ...change } : p)) }));
  }
  function remove(index: number) {
    // Os índices mudam: as marcas dos participantes saem todas.
    resetParticipantMarks();
    s.clear("participants_count");
    update({ ...draft, participants: draft.participants.filter((_, i) => i !== index) });
  }

  // Recusas do api: a de um participante reabre o PersonPick DELE com o que foi digitado (ou os candidatos do 409); o resto vai ao campo.
  function refused(refusals: HomeVisitRefusal[], err: unknown, sent: ActivityDraft): Problem[] {
    const out = refusals.map((r) => {
      const m = PARTICIPANT.exec(r.path);
      const sub = m?.[2] ?? "";
      const path = m && r.code === "cpf_or_reason_required" && !sub.startsWith("new_patient.") ? `participants[${m[1]}].new_patient.no_cpf_reason` : r.path;
      return { path, text: r.text, code: r.code, confirmable: r.confirmable === true };
    });
    setConfirmable(out.flatMap((r) => {
      const m = PARTICIPANT.exec(r.path);
      return r.code === "duplicate_participant" && r.confirmable && m && !m[2] ? [ Number(m[1]) ] : [];
    }));
    for (const r of out) {
      const m = PARTICIPANT.exec(r.path);
      const sub = m?.[2] ?? "";
      const p = m ? sent.participants[Number(m[1])] : undefined;
      if (!m || !p) continue;
      const index = Number(m[1]);
      if (p.kind === "new" && r.code === "duplicate_suspected") {
        const q = p.patient;
        openPick({ index, restart: { query: { full_name: q.full_name, birth_date: q.birth_date, mother_name: q.mother_name ?? null }, candidates: candidatesOf(err) } });
        break;
      }
      if (p.kind === "new" && sub.startsWith("new_patient")) {
        openPick({ index, initialNew: p.patient, refusal: { path: sub.startsWith("new_patient.") ? sub : "new_patient", text: r.text } });
        break;
      }
      if (sub === "patient_id") {
        openPick({ index, refusal: { path: "patient_id", text: r.text } });
        break;
      }
    }
    return out.map(({ path, text }) => ({ path, text }));
  }

  function sendDraft(ev: FormEvent, d: ActivityDraft) {
    void s.send(ev, {
      check: () => activityProblems(d, { options, today: options.today }),
      body: () => activityBody(d, domains),
      call: recordCollectiveActivity,
      ok: onSaved,
      refused: (r, err) => refused(r, err, d)
    });
  }
  function submit(ev: FormEvent) {
    // Os formulários do PersonPick ficam dentro deste: o envio deles sobe até aqui e não é o da atividade.
    if (ev.target !== ev.currentTarget) { ev.preventDefault(); return; }
    sendDraft(ev, draft);
  }
  // "É outra pessoa": o participante vai com `duplicates_reviewed` (o api não confere mais os duplicados dele) e a atividade sai de novo.
  function confirmOther(index: number) {
    const next = { ...draft, participants: draft.participants.map((p, i) => (i === index && p.kind === "new" ? { ...p, duplicatesReviewed: true } : p)) };
    setDraft(next);
    setConfirmable([]);
    sendDraft(NO_EVENT, next);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const professionals = team ? [ ...team.professionals ].sort((a, b) => Number(b.in_team) - Number(a.in_team)) : [];
  const participantsRule = fieldRule(domains, type, "participants");
  const placeId = `${uid}-place`;
  const placeNotice = `${uid}-place-notice`;
  const profErrors = [ ...new Set(s.problems.filter((p) => p.path.startsWith("professionals")).map((p) => p.text)) ];
  // Com um envio pendurado (rede/5xx) não se sabe se o api gravou: a pergunta avisa e o pai relê a lista uma vez.
  const close = (label: string) => (s.busy
    ? <button type="button" aria-disabled style={disabledButtonStyle}>{label}</button>
    : s.locked
      ? <ConfirmButton label={label} question={DISCARD_UNCERTAIN_ACTIVITY} onConfirm={() => onClose(true)} />
      : dirty
        ? <ConfirmButton label={label} question="Descartar a atividade?" onConfirm={() => onClose()} />
        : <button type="button" style={secondaryButtonStyle} onClick={() => onClose()}>{label}</button>);

  return (
    <form ref={s.formRef} noValidate style={form} aria-label="Nova atividade coletiva" onSubmit={submit}>
      <p ref={s.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Nova atividade coletiva</p>

      <label style={fieldLabel}>
        Equipe
        <select value={draft.teamId ?? ""} disabled={frozen} style={inputStyle} {...s.aria("team_id")}
          onChange={(e) => { s.clear("team_id", ...draft.professionals.map((_, i) => `professionals[${i}]`)); update({ ...draft, teamId: e.target.value || null, professionals: [] }); }}>
          {teams.length !== 1 && <option value="">— escolha —</option>}
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name ?? t.ine}</option>)}
        </select>
      </label>
      {s.errNode("team_id")}

      <div style={row}>
        <label style={{ ...fieldLabel, flex: "1 1 150px" }}>
          Data da atividade
          <input type="date" value={draft.heldOn} min={options.min_date} max={options.today} disabled={frozen} style={inputStyle} {...s.aria("held_on")}
            onChange={(e) => { s.clear("held_on"); const v = e.target.value; setDraft((d) => ({ ...d, heldOn: v })); }} />
        </label>
        <label style={{ ...fieldLabel, flex: "1 1 120px" }}>
          Turno
          <select value={draft.shift ?? ""} disabled={frozen} style={inputStyle} {...s.aria("shift")}
            onChange={(e) => { s.clear("shift"); const v = e.target.value; setDraft((d) => ({ ...d, shift: v ? Number(v) as VisitShift : null })); }}>
            <option value="">— escolha —</option>
            {SHIFTS.map((c) => <option key={c} value={c}>{shiftLabel(c)}</option>)}
          </select>
        </label>
      </div>
      {s.errNode("held_on")}
      {s.errNode("shift")}

      <label style={fieldLabel}>
        Tipo de atividade
        <select value={type ?? ""} disabled={frozen} style={inputStyle} {...s.aria("activity_type")}
          onChange={(e) => { s.clear("activity_type", "participants"); update({ ...draft, activityType: e.target.value ? Number(e.target.value) : null }); }}>
          <option value="">— escolha —</option>
          {domains.activity_types.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
      </label>
      {s.errNode("activity_type")}

      <fieldset style={fieldset}>
        <legend style={legend}>Local</legend>
        <div style={row}>
          <label style={checkLabel}>
            <input type="radio" name={placeId} checked={draft.place.kind === "unit"} disabled={frozen}
              onChange={() => { s.clear("place_text"); setDraft((d) => ({ ...d, place: { kind: "unit", unitId: null } })); }} />
            Unidade
          </label>
          <label style={checkLabel}>
            <input type="radio" name={placeId} checked={draft.place.kind === "text"} disabled={frozen}
              onChange={() => { s.clear("place_health_unit_id"); setDraft((d) => ({ ...d, place: { kind: "text", text: "" } })); }} />
            Outro local
          </label>
        </div>
        {draft.place.kind === "unit" ? (
          <label style={fieldLabel}>
            Unidade do local
            <select value={draft.place.unitId ?? ""} disabled={frozen} style={inputStyle} {...s.aria("place_health_unit_id")}
              onChange={(e) => { s.clear("place_health_unit_id"); const v = e.target.value; setDraft((d) => ({ ...d, place: { kind: "unit", unitId: v || null } })); }}>
              <option value="">— escolha —</option>
              {options.units.map((u) => <option key={u.id} value={u.id} disabled={!u.has_cnes}>{u.has_cnes ? u.name : `${u.name} (sem CNES)`}</option>)}
            </select>
          </label>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={fieldLabel}>
              Descrição do local
              <input value={draft.place.text} maxLength={250} disabled={frozen} style={inputStyle} autoComplete="off"
                aria-describedby={[ placeNotice, s.textOf("place_text") ? `${s.fid("place_text")}-err` : "" ].filter(Boolean).join(" ")}
                {...(s.textOf("place_text") ? { "aria-invalid": true as const } : {})}
                onChange={(e) => { s.clear("place_text"); const v = e.target.value; setDraft((d) => ({ ...d, place: { kind: "text", text: v } })); }} />
            </label>
            <FrozenTextNotice id={placeNotice} />
          </div>
        )}
        {s.errNode("place_health_unit_id")}
        {s.errNode("place_text")}
      </fieldset>

      <label style={fieldLabel}>
        Número de participantes
        <input value={draft.participantsCount} inputMode="numeric" disabled={frozen} style={inputStyle} autoComplete="off" {...s.aria("participants_count")}
          onChange={(e) => { s.clear("participants_count"); const v = e.target.value; setDraft((d) => ({ ...d, participantsCount: v })); }} />
      </label>
      {s.errNode("participants_count")}
      {participantsRule !== "forbidden" && <p style={muted}>{`Avaliações alteradas (calculado pela lista): ${alteredCount(draft)}`}</p>}

      <CodeChecklist legend="Temas para reunião" rule={fieldRule(domains, type, "meeting_topics")} codes={domains.meeting_topics} value={draft.meetingTopics}
        max={domains.rules.list_max.meeting_topics} disabled={frozen} path="meeting_topics" problems={s.problems}
        onToggle={(c) => toggleList("meetingTopics", "meeting_topics", c)} />
      <CodeChecklist legend="Público-alvo" rule={fieldRule(domains, type, "target_audience")} codes={domains.target_audience} value={draft.targetAudience}
        max={domains.rules.list_max.target_audience} disabled={frozen} path="target_audience" problems={s.problems}
        onToggle={(c) => toggleList("targetAudience", "target_audience", c)} />
      <CodeChecklist legend="Temas para saúde" rule={healthTopicsAllowed(domains, draft)} codes={offeredHealthTopics(domains, draft)} value={draft.healthTopics}
        max={domains.rules.list_max.health_topics} disabled={frozen} path="health_topics" problems={s.problems}
        onToggle={(c) => toggleList("healthTopics", "health_topics", c)} />
      <CodeChecklist legend="Práticas em saúde" rule={fieldRule(domains, type, "health_practices")} codes={offeredPractices(domains, type)} value={draft.healthPractices}
        max={domains.rules.list_max.health_practices} disabled={frozen} path="health_practices" problems={s.problems}
        onToggle={(c) => toggleList("healthPractices", "health_practices", c)} />

      {needsProcedure(domains, draft.healthPractices) && (
        <>
          <label style={fieldLabel}>
            Procedimento (SIGTAP)
            <select value={draft.procedureCode} disabled={frozen} style={inputStyle} {...s.aria("procedure_code")}
              onChange={(e) => { s.clear("procedure_code"); const v = e.target.value; setDraft((d) => ({ ...d, procedureCode: v })); }}>
              <option value="">— escolha —</option>
              {domains.procedures.map((p) => <option key={p.code} value={p.code}>{`${p.code} — ${p.label}`}</option>)}
            </select>
          </label>
          {s.errNode("procedure_code")}
        </>
      )}

      {team && (
        <fieldset style={fieldset} {...(profErrors.length > 0 ? { "aria-invalid": true as const } : {})}>
          <legend style={legend}>Profissionais participantes</legend>
          {professionals.length === 0 && <p style={muted}>Nenhum outro profissional nesta equipe.</p>}
          {professionals.map((p) => (
            <div key={p.id} style={row}>
              <label style={checkLabel}>
                <input type="checkbox" checked={draft.professionals.includes(p.id)} disabled={frozen || !p.has_cns} onChange={() => toggleProfessional(p.id)} />
                {p.name}
              </label>
              {!p.has_cns && <span style={muted}>{NO_CNS_PROFESSIONAL}</span>}
              {!p.in_team && <span style={muted}>{OTHER_TEAM_PROFESSIONAL}</span>}
            </div>
          ))}
          {profErrors.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
        </fieldset>
      )}

      <ParticipantsField rule={participantsRule} participants={draft.participants} smoking={smokingAllowed(domains, draft.healthPractices)} today={options.today}
        frozen={frozen} pick={pick} confirmable={confirmable} problems={s.problems} warnings={activityWarnings(draft)} aria={s.aria} errNode={s.errNode}
        onPick={(p) => openPick(p)} onChoose={choose} onPatch={patch} onRemove={remove} onConfirmOther={confirmOther} />

      {s.top(isOwn)}

      {s.locked ? (
        <div style={row}>
          <button type="button" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : buttonStyle}
            onClick={() => { if (!s.busy) void s.retry(); }}>Tentar de novo</button>
          {close("Descartar")}
        </div>
      ) : (
        <div style={row}>
          <button type="submit" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : buttonStyle}>Registrar atividade</button>
          {close("Cancelar")}
        </div>
      )}
    </form>
  );
}
