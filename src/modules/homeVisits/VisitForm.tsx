// src/modules/homeVisits/VisitForm.tsx
// Nova visita (módulo 24b, F-24.10), para o celular (campos empilhados, 375 px): quando, onde, quem, desfecho, motivos, medidas,
// visita compartilhada e observação. As regras vêm do domínio (`offeredReasons`, `allowedMeasurements`, `visitProblems`); trocar
// imóvel, sujeito, pessoa ou desfecho tira o que deixou de valer e diz o quê numa linha `role="status"`. Envio idempotente
// (`useIdempotentSubmit`): o mesmo `client_uuid` no reenvio depois de rede/5xx, com os campos travados. A recusa do api cai no
// campo do `path`; as da pessoa digitada reabrem o `PersonPick` (Q49/Q71; 409 `duplicate_suspected` com os candidatos do 409).
// Dado pessoal só em estado local e no corpo do POST: nada em URL, storage ou mensagem.
import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getVisitHousehold, recordHomeVisit, type HomeVisit, type HomeVisitContext, type HomeVisitDay, type HomeVisitTeam, type VisitCandidate,
  type VisitHousehold, type VisitOutcome
} from "../../lib/api";
import { fmtHourMinute } from "../../lib/format";
import {
  HOME_VISIT_ERRORS, HV_HOUSEHOLD_KEY, NOMINAL_QUERY, NON_RESIDENTIAL_NO_PERSON, NOTE_HINT, NO_MICRO_AREA, RESPONSIBLE_EXITED,
  allowedMeasurements, emptyVisitDraft, familyVisitNotice, homeVisitError, isNonResidential, measurementsAnyAllowed, offeredReasons,
  prunedText, pruneVisitDraft, shiftPreview, visitBody, visitProblems, type DraftHousehold, type HomeVisitRefusal, type MeasureDraft, type VisitDraft
} from "../../lib/homeVisits";
import { NO_NAME } from "../../lib/territoryRegistry";
import type { Problem } from "../../lib/pharmacy";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { MeasurementsField } from "./MeasurementsField";
import { OUT_OF_AREA, PlacePick, type PlaceMode } from "./PlacePick";
import { PersonPick, type PersonRestart, type PickedPerson } from "./PersonPick";
import type { QuickInitial, QuickRefusal } from "./QuickPatientForm";
import { ReasonsField } from "./ReasonsField";
import { useIdempotentSubmit } from "./useIdempotentSubmit";
import type { VisitStart } from "./useVisitHandoff";

export type VisitSaved = { visit: HomeVisit; day: HomeVisitDay; replayed: boolean };
type Pick = { n: number; restart?: PersonRestart; initialNew?: QuickInitial; refusal?: QuickRefusal | null };

const NOTE_MAX = 500;
const PERSON_CODES = [ "duplicate_suspected", "cpf_taken", "cns_taken", "invalid_patient", "cpf_or_reason_required", "invalid_cpf", "invalid_cns" ];
const OWN = new Set([ "occurred_at", "household_id", "micro_area_id", "out_of_area", "property_type", "subject", "patient_id", "family_id", "outcome", "shared", "note" ]);
const isOwn = (path: string) => OWN.has(path) || path === "reasons" || path.startsWith("reasons[") || path.startsWith("measurements.") || path.startsWith("new_patient");

function candidatesOf(err: unknown): VisitCandidate[] {
  const body = (err as { body?: unknown } | null)?.body;
  const list = body && typeof body === "object" ? (body as { candidates?: unknown }).candidates : null;
  return Array.isArray(list) ? (list as VisitCandidate[]) : [];
}

function initialDraft(context: HomeVisitContext, now: Date, start: VisitStart | null | undefined): VisitDraft {
  const d: VisitDraft = { ...emptyVisitDraft(), day: context.today, time: fmtHourMinute(now.toISOString()) };
  if (!start) return d;
  if (start.householdId) d.place = { kind: "household", householdId: start.householdId, propertyType: "", microAreaId: start.microAreaId };
  if (start.patientId) { d.subject = "resident"; d.person = { kind: "patient", patientId: start.patientId, sex: null }; }
  else if (start.familyId && start.householdId) { d.subject = "family_responsible"; d.familyId = start.familyId; }
  return d;
}

export function VisitForm({ team, context, start, now, onSaved, onClose }: {
  team: HomeVisitTeam; context: HomeVisitContext; start?: VisitStart | null; now?: Date; onSaved(r: VisitSaved): void; onClose(): void;
}) {
  const { domains } = context;
  const uid = useId();
  const s = useIdempotentSubmit();
  const [ draft, setDraft ] = useState<VisitDraft>(() => initialDraft(context, now ?? new Date(), start));
  const [ microArea, setMicroArea ] = useState(() => start?.microAreaId ?? (team.micro_areas.length === 1 ? team.micro_areas[0].id : ""));
  const [ mode, setMode ] = useState<PlaceMode>(start?.householdId ? "household" : null);
  const [ picked, setPicked ] = useState<VisitHousehold | null>(null);
  // Nome da pessoa escolhida fora dos moradores (busca, registro rápido ou atalho).
  const [ otherName, setOtherName ] = useState<string | null>(start?.patientId ? start.displayName ?? NO_NAME : null);
  const [ pick, setPick ] = useState<Pick | null>(null);
  const [ taken, setTaken ] = useState(false);
  const [ cleared, setCleared ] = useState<string | null>(null);

  const householdId = draft.place?.kind === "household" ? draft.place.householdId : null;
  const detail = useQuery({ queryKey: [ HV_HOUSEHOLD_KEY, householdId ], queryFn: () => getVisitHousehold(householdId!), enabled: !!householdId, ...NOMINAL_QUERY });
  const household: DraftHousehold | null = householdId ? detail.data ?? picked : null;
  // O sexo do morador escolhido pelo atalho só se conhece com os moradores: as regras o leem daqui.
  const withSex = (d: VisitDraft): VisitDraft => {
    const p = d.person;
    if (p?.kind !== "patient" || p.sex !== null) return d;
    const sex = detail.data?.residents.find((r) => r.patient_id === p.patientId)?.sex ?? null;
    return sex ? { ...d, person: { ...p, sex } } : d;
  };
  const rules = withSex(draft);

  const frozen = s.locked || s.busy;
  const property = household?.property_type ?? draft.place?.propertyType ?? "";
  const nonResidential = property !== "" && isNonResidential(domains, property);
  const offered = offeredReasons(domains, rules, household);
  const allowed = allowedMeasurements(domains, rules, household);
  const notice = familyVisitNotice(domains, rules, household);
  const noArea = team.micro_areas.length === 0 && !team.out_of_area_allowed;

  // Toda troca passa pela poda; o que saiu vai à linha de status.
  function update(next: VisitDraft, h: DraftHousehold | null = household) {
    const out = pruneVisitDraft(domains, withSex(next), h);
    setDraft(out.draft);
    setCleared(out.cleared.length > 0 ? prunedText(out.cleared) : null);
  }
  const withoutPerson = (d: VisitDraft): VisitDraft => ({ ...d, subject: null, person: null, familyId: null });
  const placeFor = (ma: string, propertyType: string) =>
    ({ kind: "no_household" as const, propertyType, microAreaId: ma === OUT_OF_AREA || ma === "" ? null : ma, outOfArea: ma === OUT_OF_AREA });

  function onMicroArea(v: string) {
    setMicroArea(v);
    s.clear("micro_area_id", "out_of_area");
    if (v === OUT_OF_AREA || mode === "no_household") {
      setMode("no_household");
      const propertyType = draft.place?.kind === "no_household" ? draft.place.propertyType : "";
      update({ ...(mode === "household" ? withoutPerson(draft) : draft), place: placeFor(v, propertyType) }, null);
      return;
    }
    // Trocar a microárea limpa o domicílio e a pessoa.
    setPicked(null); setOtherName(null);
    update({ ...withoutPerson(draft), place: null }, null);
  }
  function onMode(m: Exclude<PlaceMode, null>) {
    setMode(m); setPicked(null); setOtherName(null); setPick(null);
    s.clear("household_id");
    update({ ...withoutPerson(draft), place: m === "no_household" ? placeFor(microArea, "") : null }, null);
  }
  function onHousehold(h: VisitHousehold | null) {
    setPicked(h); setOtherName(null); setPick(null);
    s.clear("household_id");
    update({ ...withoutPerson(draft), place: h ? { kind: "household", householdId: h.id, propertyType: h.property_type, microAreaId: h.micro_area.id } : null }, h);
  }
  function onPropertyType(t: string) {
    s.clear("property_type", "subject");
    update({ ...draft, place: placeFor(microArea, t) });
  }
  function choosePerson(c: PickedPerson) {
    setPick(null); setTaken(false);
    s.clear("patient_id", "subject", ...s.problems.filter((p) => p.path.startsWith("new_patient")).map((p) => p.path));
    const resident = c.kind === "patient" && household?.residents?.some((r) => r.patient_id === c.patientId);
    setOtherName(resident ? null : c.kind === "patient" ? c.displayName ?? NO_NAME : c.patient.full_name);
    update({ ...draft, subject: "resident", familyId: null,
      person: c.kind === "patient" ? { kind: "patient", patientId: c.patientId, sex: c.sex } : { kind: "new", patient: c.patient, duplicatesReviewed: c.duplicatesReviewed } });
  }
  function toggleReason(code: number) {
    const adding = !draft.reasons.includes(code);
    // A caixa já vem desabilitada; isto só impede o clique que escapa dela (Q36 e motivo indisponível).
    if (adding && (draft.reasons.length >= domains.reasons_max || !offered.some((r) => r.code === code && !r.disabled))) return;
    s.clear("reasons", ...draft.reasons.map((_, i) => `reasons[${i}]`));
    update({ ...draft, reasons: draft.reasons.includes(code) ? draft.reasons.filter((c) => c !== code) : [ ...draft.reasons, code ] });
  }
  function setMeasure(key: keyof MeasureDraft, v: string) {
    s.clear(`measurements.${key}`);
    setDraft((d) => ({ ...d, measurements: { ...d.measurements, [key]: v } }));
  }

  // Recusas do api: as da pessoa digitada reabrem o PersonPick com o que foi digitado; o resto vai ao campo do `path`.
  function refused(refusals: HomeVisitRefusal[], err: unknown): Problem[] {
    const out = refusals.map((r) => ({
      path: r.code === "cpf_or_reason_required" && !r.path.startsWith("new_patient.") ? "new_patient.no_cpf_reason" : r.path, text: r.text, code: r.code }));
    const person = draft.person;
    const hit = out.find((r) => r.path.startsWith("new_patient") || PERSON_CODES.includes(r.code));
    if (person?.kind === "new" && hit) {
      const n = (pick?.n ?? 0) + 1;
      if (hit.code === "duplicate_suspected") {
        const q = person.patient;
        setPick({ n, restart: { query: { full_name: q.full_name, birth_date: q.birth_date, mother_name: q.mother_name ?? null }, candidates: candidatesOf(err) } });
      } else {
        setPick({ n, initialNew: person.patient, refusal: { path: hit.path.startsWith("new_patient.") ? hit.path : "new_patient", text: hit.text } });
      }
      setTaken(hit.code === "cpf_taken" || hit.code === "cns_taken");
    }
    return out.map(({ path, text }) => ({ path, text }));
  }

  function submit(ev: FormEvent) {
    // O submit das buscas de pessoa (PersonPick/QuickPatientForm, formulários dentro deste) sobe pela árvore do React: só o desta
    // própria <form> envia a visita.
    if (ev.target !== ev.currentTarget) { ev.preventDefault(); return; }
    void s.send(ev, {
      check: () => visitProblems(rules, { domains, today: context.today, minDate: context.min_date, team, household, now: now ?? new Date() }),
      body: () => ({ team_id: team.id, ...visitBody(draft) }),
      call: recordHomeVisit,
      ok: onSaved,
      refused
    });
  }

  if (noArea) {
    return (
      <section aria-label="Nova visita" style={form}>
        <p role="status" style={alert}>{NO_MICRO_AREA}</p>
        <div><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button></div>
      </section>
    );
  }

  const noteId = `${uid}-note`;
  const hintId = `${uid}-hint`;
  const noteLength = [ ...draft.note.trim() ].length;
  const personErrors = s.problems.filter((p) => p.path.startsWith("new_patient") && !pick);
  const residents = household?.residents;
  const families = household ? household.families.filter((f) => !f.moved_out) : [];
  const unidentifiedIds = (residents ?? []).filter((r) => r.unidentified).map((r) => r.patient_id);
  const isResident = (id: string) => !!residents?.some((r) => r.patient_id === id);
  const chosenPatient = draft.subject === "resident" && draft.person?.kind === "patient" ? draft.person.patientId : null;
  const other = draft.subject === "resident" && draft.person && otherName && !(draft.person.kind === "patient" && isResident(draft.person.patientId));
  const who = `${uid}-who`;

  return (
    <form ref={s.formRef} noValidate style={form} aria-label="Nova visita" onSubmit={submit}>
      <p ref={s.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Nova visita</p>

      <fieldset style={fieldset}>
        <legend style={legend}>Quando</legend>
        <div style={row}>
          <label style={{ ...fieldLabel, flex: "1 1 150px" }}>
            Data
            <input type="date" value={draft.day} min={context.min_date} max={context.today} disabled={frozen} style={inputStyle} {...s.aria("occurred_at")}
              onChange={(e) => { s.clear("occurred_at"); setDraft((d) => ({ ...d, day: e.target.value })); }} />
          </label>
          <label style={{ ...fieldLabel, flex: "1 1 110px" }}>
            Hora
            <input type="time" value={draft.time} disabled={frozen} style={inputStyle} {...s.aria("occurred_at")}
              onChange={(e) => { s.clear("occurred_at"); setDraft((d) => ({ ...d, time: e.target.value })); }} />
          </label>
          {shiftPreview(draft.time) && <span style={muted}>{shiftPreview(draft.time)}</span>}
        </div>
        {s.errNode("occurred_at")}
      </fieldset>

      <PlacePick team={team} domains={domains} microArea={microArea} mode={mode} propertyType={draft.place?.kind === "no_household" ? draft.place.propertyType : ""}
        chosen={!!householdId} household={householdId ? (detail.data ?? picked) : null} disabled={frozen} name={`${uid}-place`}
        onMicroArea={onMicroArea} onMode={onMode} onHousehold={onHousehold} onPropertyType={onPropertyType} aria={s.aria} errNode={s.errNode} />

      {nonResidential ? <p role="status" style={muted}>{NON_RESIDENTIAL_NO_PERSON}</p> : (
        <fieldset style={fieldset}>
          <legend style={legend}>Quem foi visitado</legend>
          {householdId && !detail.data && (detail.isError
            ? <p role="alert" style={alert}>{homeVisitError(detail.error)}</p>
            : <p role="status" style={muted}>Carregando moradores…</p>)}
          {residents?.map((r) => (
            <div key={r.patient_id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <label style={checkLabel}>
                <input type="radio" name={who} checked={chosenPatient === r.patient_id} disabled={frozen || r.unidentified}
                  {...(chosenPatient === r.patient_id ? s.aria("patient_id") : {})}
                  onChange={() => choosePerson({ kind: "patient", patientId: r.patient_id, displayName: r.display_name, hasCpf: true, hasCns: false, sex: r.sex })} />
                {r.display_name ?? NO_NAME}
              </label>
              {r.unidentified && <span style={muted}>{HOME_VISIT_ERRORS.patient_unidentified}</span>}
            </div>
          ))}
          {other && (
            <label style={checkLabel}>
              <input type="radio" name={who} checked disabled={frozen} readOnly {...s.aria("patient_id")} />
              {otherName}
            </label>
          )}
          {families.map((f) => (
            <div key={f.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <label style={checkLabel}>
                <input type="radio" name={who} checked={draft.subject === "family_responsible" && draft.familyId === f.id} disabled={frozen || f.responsible_exited}
                  {...(draft.familyId === f.id ? s.aria("family_id") : {})}
                  onChange={() => { setOtherName(null); setPick(null); s.clear("subject", "family_id", "patient_id"); update({ ...draft, subject: "family_responsible", familyId: f.id, person: null }); }} />
                {`Família — responsável ${f.responsible.display_name ?? NO_NAME}`}
              </label>
              {f.responsible_exited && <span style={muted}>{RESPONSIBLE_EXITED}</span>}
            </div>
          ))}
          <label style={checkLabel}>
            <input type="radio" name={who} checked={draft.subject === "none"} disabled={frozen} {...s.aria("subject")}
              onChange={() => { setOtherName(null); setPick(null); s.clear("subject", "patient_id", "family_id"); update({ ...draft, subject: "none", person: null, familyId: null }); }} />
            Imóvel sem pessoa
          </label>
          {s.errNode("subject")}
          {s.errNode("patient_id")}
          {s.errNode("family_id")}
          {personErrors.map((p) => <p key={p.path + p.text} role="alert" style={alert}>{p.text}</p>)}
          {/* Enviando ou travado (rede/5xx), o seletor sai: o reenvio leva a pessoa do primeiro envio e a tela não pode mostrar outra. */}
          {pick && !frozen ? (
            <PersonPick key={pick.n} scope="home_visits" today={context.today} restart={pick.restart} initialNew={pick.initialNew} refusal={pick.refusal ?? null}
              unidentifiedIds={unidentifiedIds} onChoose={choosePerson} onCancel={() => setPick(null)} />
          ) : (
            <div style={row}>
              <button type="button" disabled={frozen} style={secondaryButtonStyle} onClick={() => setPick({ n: 1 })}>
                {householdId ? "Outra pessoa" : "Buscar pessoa"}
              </button>
            </div>
          )}
          {taken && pick && (
            <div style={row}>
              <button type="button" disabled={frozen} style={secondaryButtonStyle} onClick={() => { setTaken(false); setPick({ n: pick.n + 1 }); }}>
                Buscar pelo documento
              </button>
            </div>
          )}
        </fieldset>
      )}

      <fieldset style={fieldset}>
        <legend style={legend}>Desfecho</legend>
        <div style={row}>
          {domains.desfecho.map((o, i) => (
            <label key={o.code} style={checkLabel}>
              <input type="radio" name={`${uid}-outcome`} checked={draft.outcome === o.code} disabled={frozen} {...(i === 0 ? s.aria("outcome") : {})}
                onChange={() => { s.clear("outcome", "reasons"); update({ ...draft, outcome: o.code as VisitOutcome }); }} />
              {o.label}
            </label>
          ))}
        </div>
        {s.errNode("outcome")}
      </fieldset>

      {draft.outcome === 1 && offered.length > 0 && (
        <ReasonsField offered={offered} chosen={draft.reasons} max={domains.reasons_max} disabled={frozen} onToggle={toggleReason} aria={s.aria} errNode={s.errNode} />
      )}

      {measurementsAnyAllowed(allowed) && (
        <MeasurementsField domains={domains} allowed={allowed} value={draft.measurements} disabled={frozen} onChange={setMeasure} aria={s.aria} errNode={s.errNode} />
      )}

      <label style={checkLabel}>
        <input type="checkbox" checked={draft.shared} disabled={frozen} onChange={(e) => { const v = e.target.checked; setDraft((d) => ({ ...d, shared: v })); }} />
        Visita compartilhada
      </label>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={fieldLabel}>
          Observação (interna)
          <textarea value={draft.note} rows={3} disabled={frozen} style={inputStyle}
            aria-describedby={[ hintId, noteId, s.textOf("note") ? `${s.fid("note")}-err` : "" ].filter(Boolean).join(" ")}
            {...(s.textOf("note") ? { "aria-invalid": true as const } : {})}
            onChange={(e) => { s.clear("note"); const v = e.target.value; setDraft((d) => ({ ...d, note: v })); }} />
        </label>
        <span id={hintId} style={muted}>{`${NOTE_HINT} ${noteLength}/${NOTE_MAX}`}</span>
        <FrozenTextNotice id={noteId} />
        {s.errNode("note")}
      </div>

      {cleared && <p role="status" style={muted}>{cleared}</p>}
      {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>{notice}</p>}
      {s.top(isOwn)}

      {s.locked ? (
        <div style={row}>
          <button type="button" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : buttonStyle}
            onClick={() => { if (!s.busy) void s.retry(); }}>Tentar de novo</button>
          <button type="button" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { if (!s.busy) onClose(); }}>Descartar</button>
        </div>
      ) : (
        <div style={row}>
          <button type="submit" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : buttonStyle}>Registrar visita</button>
          <button type="button" aria-disabled={s.busy || undefined} style={s.busy ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { if (!s.busy) onClose(); }}>Cancelar</button>
        </div>
      )}
    </form>
  );
}
