// PTS da matrícula (F-31.3; §4, P12, P16, P33): as versões, da mais nova para a mais antiga (`GET …/care_plans` grava a trilha
// `care_plans`: só corre com a aba aberta, `NOMINAL_QUERY`, com o id do CAPS na chave). Versão gravada não se edita: "Revisar PTS"
// cria a versão seguinte, pré-preenchida com a última. A revisão vencida (`review_on < hoje`, só na versão vigente) é calculada na
// tela (R4). A revisão sugerida é hoje + `DEFAULT_CARE_PLAN_REVIEW_DAYS`: a equipe não lê `GET /settings` (P33), e o api confere a
// data (depois de hoje e até hoje + 365). Responsável só da equipe lotada (`options.team`); o de fora não é reaproveitado.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPsyCarePlan, errorCode, listPsyCarePlans, type CareIntensity, type PsyCarePlan, type PsyEnrollment, type PsyOptions, type PsyUnit
} from "../../lib/api";
import { addDays } from "../../lib/campaigns";
import { fmtDay } from "../../lib/careLines";
import { fmtDateTime } from "../../lib/format";
import {
  CARE_PLAN_OVERDUE_TAG, CARE_PLAN_SAVED, DEFAULT_CARE_PLAN_REVIEW_DAYS, NOMINAL_QUERY, NO_CARE_PLAN_YET, PSY_DETAIL_KEY, RESPONSIBLE_OUT,
  carePlanInput, carePlanOverdue, carePlanProblems, carePlanTitle, intensityLabel, isStale, psyError, psyRefusals, type CarePlanDraft
} from "../../lib/psychosocial";
import type { Problem } from "../../lib/pharmacy";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { KeyValue } from "../../components/KeyValue";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, form, grid, legend, list, muted, okText, row } from "../exams/styles";

const MAX_GOALS = 20;

export function CarePlans({ enrollment: e, unit, options, today, onSaved, onStale }: {
  enrollment: PsyEnrollment; unit: PsyUnit; options: PsyOptions; today: string; onSaved(plan: PsyCarePlan): void; onStale(text: string): void;
}) {
  const queryClient = useQueryClient();
  const key = [ PSY_DETAIL_KEY, unit.id, "care_plans", e.id ];
  const plans = useQuery({ queryKey: key, queryFn: () => listPsyCarePlans(e.id), ...NOMINAL_QUERY });
  const [ editing, setEditing ] = useState(false);
  const [ done, setDone ] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);

  const versions = [ ...(plans.data ?? []) ].sort((a, b) => b.version - a.version);
  const latest = versions[0] ?? null;
  const nameOf = (userId: string) => options.team.find((p) => p.user_id === userId)?.name ?? RESPONSIBLE_OUT;
  const saved = (plan: PsyCarePlan) => {
    queryClient.setQueryData<PsyCarePlan[]>(key, (old) => [ plan, ...(old ?? []).filter((p) => p.id !== plan.id) ]);
    setEditing(false);
    setDone(CARE_PLAN_SAVED);
    onSaved(plan);
  };

  if (plans.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (plans.isError) return <p role="alert" style={alert}>{psyError(plans.error)}</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
      {e.status === "open" && !editing && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => { setDone(null); setEditing(true); }}>
            {latest ? "Revisar PTS (nova versão)" : "Criar o PTS"}
          </button>
        </div>
      )}
      {editing && (
        <CarePlanForm enrollmentId={e.id} latest={latest} options={options} today={today} onSaved={saved} onCancel={() => setEditing(false)}
          onStale={onStale} />
      )}
      {versions.length === 0 && <p style={muted}>{NO_CARE_PLAN_YET}</p>}
      {versions.map((p, i) => {
        const overdue = i === 0 && e.status === "open" && carePlanOverdue(p.review_on, today);
        return (
          <Panel key={p.id} title={carePlanTitle(p.version, p.review_on, overdue)} right={overdue ? <Tag tone="warn">{CARE_PLAN_OVERDUE_TAG}</Tag> : undefined}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={muted}>Problemas e necessidades</span>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.needs}</p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={muted}>Objetivos</span>
                <ul style={list}>
                  {p.goals.map((g, gi) => (
                    <li key={gi} style={{ overflowWrap: "anywhere" }}>
                      {g.text}
                      <span style={muted}>{` · ${nameOf(g.responsible_user_id)}${g.due_on ? ` · prazo ${fmtDay(g.due_on)}` : ""}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div style={grid}>
                <KeyValue k="Frequência proposta" v={intensityLabel(p.intensity)} mono={false} />
                <KeyValue k="Revisão" v={fmtDay(p.review_on)} />
                <KeyValue k="Registrada por" v={`${p.created_by.name} · ${fmtDateTime(p.created_at)}`} mono={false} />
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

function draftFrom(latest: PsyCarePlan | null, options: PsyOptions, today: string): CarePlanDraft {
  const team = new Set(options.team.map((p) => p.user_id));
  const intensity = latest && (options.intensities as string[]).includes(latest.intensity) ? latest.intensity as CareIntensity : "";
  return {
    needs: latest?.needs ?? "",
    goals: latest && latest.goals.length > 0
      ? latest.goals.map((g) => ({ text: g.text, responsibleUserId: team.has(g.responsible_user_id) ? g.responsible_user_id : "", dueOn: g.due_on ?? "" }))
      : [ { text: "", responsibleUserId: "", dueOn: "" } ],
    intensity, reviewOn: addDays(today, DEFAULT_CARE_PLAN_REVIEW_DAYS)
  };
}

function CarePlanForm({ enrollmentId, latest, options, today, onSaved, onCancel, onStale }: {
  enrollmentId: string; latest: PsyCarePlan | null; options: PsyOptions; today: string; onSaved(plan: PsyCarePlan): void; onCancel(): void;
  onStale(text: string): void;
}) {
  const uid = useId();
  const [ d, setD ] = useState<CarePlanDraft>(() => draftFrom(latest, options, today));
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ busy, setBusy ] = useState(false);
  const sending = useRef(false);
  const alive = useRef(true);
  const focusNext = useRef(false);
  const ref = useRef<HTMLFormElement | null>(null);
  const title = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => {
    alive.current = true;
    title.current?.focus();
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    ref.current?.querySelector<HTMLElement>("[aria-invalid='true'], [data-general='true']")?.focus();
  }, [ problems ]);

  const show = (list: Problem[]) => { focusNext.current = true; setProblems(list); };
  const clear = (...paths: string[]) => setProblems((ps) => ps.filter((p) => !paths.includes(p.path)));
  const setGoal = (i: number, patch: Partial<CarePlanDraft["goals"][number]>, path: string) => {
    clear(`goals[${i}].${path}`, "goals");
    setD((x) => ({ ...x, goals: x.goals.map((g, gi) => (gi === i ? { ...g, ...patch } : g)) }));
  };
  // Tirar ou acrescentar objetivo muda os índices: as marcas dos objetivos saem.
  const setGoals = (goals: CarePlanDraft["goals"]) => {
    setProblems((ps) => ps.filter((p) => !p.path.startsWith("goals")));
    setD((x) => ({ ...x, goals }));
  };

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (sending.current) return;
    const local = carePlanProblems(d, today);
    if (local.length > 0) { show(local); return; }
    sending.current = true;
    setBusy(true);
    setProblems([]);
    try {
      const plan = await createPsyCarePlan(enrollmentId, carePlanInput(d));
      if (alive.current) onSaved(plan);
    } catch (err) {
      if (!alive.current) return;
      const refusals = psyRefusals(err);
      if (isStale(err) || errorCode(err) === "already_closed") { onStale(refusals[0].text); return; }
      show(refusals.map((r) => ({ path: r.path, text: r.text })));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const textOf = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const fid = (path: string) => `${uid}-${path}`;
  const aria = (path: string) => (textOf(path) ? { "aria-invalid": true as const, "aria-describedby": `${fid(path)}-err` } : {});
  const errNode = (path: string) => {
    const t = textOf(path);
    return t ? <p id={`${fid(path)}-err`} role="alert" style={alert}>{t}</p> : null;
  };
  const own = (path: string) => [ "needs", "goals", "intensity", "review_on" ].includes(path) || /^goals\[\d+\]\./.test(path);
  const top = [ ...new Set(problems.filter((p) => !own(p.path)).map((p) => p.text)) ];

  return (
    <form ref={ref} aria-label="Nova versão do PTS" style={form} onSubmit={(ev) => { void submit(ev); }} noValidate>
      <p ref={title} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
        {latest ? `Nova versão do PTS (versão ${latest.version + 1})` : "Primeiro PTS"}
      </p>
      {top.map((t) => <p key={t} role="alert" tabIndex={-1} data-general="true" style={alert}>{t}</p>)}

      <label style={fieldLabel}>
        Problemas e necessidades
        <textarea value={d.needs} rows={4} style={inputStyle} {...aria("needs")}
          onChange={(ev) => { clear("needs"); setD((x) => ({ ...x, needs: ev.target.value })); }} />
      </label>
      {errNode("needs")}

      <fieldset style={fieldset}>
        <legend style={legend}>Objetivos</legend>
        {d.goals.map((g, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={fieldLabel}>
              {`Objetivo ${i + 1}`}
              <input value={g.text} style={inputStyle} autoComplete="off" {...aria(`goals[${i}].text`)}
                onChange={(ev) => setGoal(i, { text: ev.target.value }, "text")} />
            </label>
            {errNode(`goals[${i}].text`)}
            <div style={row}>
              <label style={fieldLabel}>
                {`Responsável pelo objetivo ${i + 1}`}
                <select value={g.responsibleUserId} style={inputStyle} {...aria(`goals[${i}].responsible_user_id`)}
                  onChange={(ev) => setGoal(i, { responsibleUserId: ev.target.value }, "responsible_user_id")}>
                  <option value="">Escolha o responsável</option>
                  {options.team.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                {`Prazo do objetivo ${i + 1} (opcional)`}
                <input type="date" value={g.dueOn} style={inputStyle} {...aria(`goals[${i}].due_on`)}
                  onChange={(ev) => setGoal(i, { dueOn: ev.target.value }, "due_on")} />
              </label>
              {d.goals.length > 1 && (
                <button type="button" style={secondaryButtonStyle} aria-label={`Tirar o objetivo ${i + 1}`}
                  onClick={() => setGoals(d.goals.filter((_, gi) => gi !== i))}>Tirar</button>
              )}
            </div>
            {errNode(`goals[${i}].responsible_user_id`)}{errNode(`goals[${i}].due_on`)}
          </div>
        ))}
        {d.goals.length < MAX_GOALS && (
          <div style={row}>
            <button type="button" style={secondaryButtonStyle}
              onClick={() => setGoals([ ...d.goals, { text: "", responsibleUserId: "", dueOn: "" } ])}>Acrescentar objetivo</button>
          </div>
        )}
      </fieldset>
      {errNode("goals")}

      <div style={row}>
        <label style={fieldLabel}>
          Frequência proposta
          <select value={d.intensity} style={inputStyle} {...aria("intensity")}
            onChange={(ev) => { clear("intensity"); setD((x) => ({ ...x, intensity: ev.target.value as CarePlanDraft["intensity"] })); }}>
            <option value="">Escolha a frequência</option>
            {options.intensities.map((v) => <option key={v} value={v}>{intensityLabel(v)}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Próxima revisão
          <input type="date" value={d.reviewOn} min={addDays(today, 1)} max={addDays(today, 365)} style={inputStyle} {...aria("review_on")}
            onChange={(ev) => { clear("review_on"); setD((x) => ({ ...x, reviewOn: ev.target.value })); }} />
        </label>
      </div>
      {errNode("intensity")}{errNode("review_on")}

      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Salvar nova versão</button>
        <button type="button" style={busy ? disabledButtonStyle : secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
