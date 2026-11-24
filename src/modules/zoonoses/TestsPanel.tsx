// src/modules/zoonoses/TestsPanel.tsx
// Coleta e sorologia de leishmaniose (módulo 35b, F-35.15) e o "Desfecho pendente" dos cães reagentes. A etiqueta, a prevalência e
// quem é reagente são do api; a tela só não envia o que sabe que será recusado: ELISA só depois de TR-DPP reagente, resultado e data
// juntos, datas entre a coleta e hoje, exame com desfecho sem correção, eutanásia só com a eutanásia gravada do animal (lida do
// histórico, só quando escolhida) e tratamento ou recusa só com tutor. 409 (exame mudou, desfecho repetido): a frase e UMA releitura.
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  collectLeishTest, errorCode, getAnimal, listLeishTests, recordLeishOutcome, updateLeishTest,
  type Animal, type DppResult, type ElisaResult, type LeishDecision, type LeishSurvey, type LeishTest
} from "../../lib/api";
import { fmtDay, textProblem } from "../../lib/homeVisits";
import {
  NOMINAL_QUERY, STATIC_QUERY, ZOO_ANIMAL_KEY, ZOO_TESTS_KEY, elisaAllowed, isReactiveDog, isZoonosesStale, leishOutcomeProblems, zooLabel,
  zoonosesError, zoonosesRefusals
} from "../../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../../lib/zoonosesErrors";
import type { Problem } from "../../lib/pharmacy";
import type { PsyRefusal } from "../../lib/psychosocial";
import { ActionButton } from "../../components/ActionButton";
import { DataTable, type Column } from "../../components/DataTable";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row, stack } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { AnimalSearch } from "./AnimalSearch";
import { useZooDomains } from "./useZooDomains";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
export const minusDays = (iso: string, n: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
const validDay = (raw: string): boolean => DATE.test(raw) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw;
const NO_DOG = "escolha o cão";
const NOTHING_CHANGED = "nada mudou";
const OUT_OF_RANGE = ZOONOSES_ERRORS.date_out_of_range;
const NEEDS_EUTHANASIA = "registre antes a eutanásia do animal";
const NEEDS_TUTOR = "o animal precisa de tutor para esta ação";

const zooFormOptions = (stale: (err: unknown) => boolean = (err) => isZoonosesStale(err)) => ({
  refusals: (err: unknown): PsyRefusal[] => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null })),
  isStale: stale
});
// Animal recusado (não é cão, não está ativo) é do campo, não corrida: fica no formulário.
export const animalRefusal = (rs: PsyRefusal[]): Problem[] =>
  rs.map((r) => ({ path: r.code === "animal_not_dog" || r.code === "animal_not_active" ? "animal_id" : r.path, text: r.text }));
export const staleButAnimal = (err: unknown): boolean => isZoonosesStale(err) && errorCode(err) !== "animal_not_active";
// O cão escolhido: só cão ativo (o api confere de novo).
export function dogProblems(a: Animal | null): Problem[] {
  if (!a) return [ { path: "animal_id", text: NO_DOG } ];
  if (a.species !== "dog") return [ { path: "animal_id", text: ZOONOSES_ERRORS.animal_not_dog } ];
  if (a.status !== "active") return [ { path: "animal_id", text: ZOONOSES_ERRORS.animal_not_active } ];
  return [];
}
const pairProblem = (result: string, on: string, path: string, name: string): Problem | null =>
  (result === "") !== (on === "") ? { path, text: `o resultado e a data do ${name} vão juntos` } : null;
const rangeProblem = (on: string, from: string, today: string, path: string): Problem | null => {
  if (on === "") return null;
  if (!validDay(on)) return { path, text: "informe uma data válida" };
  return on < from || on > today ? { path, text: OUT_OF_RANGE } : null;
};

// ─── Exames ──────────────────────────────────────────────────────────────────
export function TestsPanel({ today, surveys }: { today: string; surveys: LeishSurvey[] }) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const [ filter, setFilter ] = useState("");
  const [ collecting, setCollecting ] = useState(false);
  const [ label, setLabel ] = useState<string | null>(null);
  const [ picked, setPicked ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: [ ZOO_TESTS_KEY, "list", filter || "all" ], ...STATIC_QUERY, initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listLeishTests({ surveyId: filter || undefined, before: pageParam }),
    getNextPageParam: (last) => last.next_before ?? undefined
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_TESTS_KEY ] });
  const listed = surveys.filter((s) => s.stage !== "draft");
  const open = surveys.filter((s) => s.stage === "open");
  const editing = rows.find((t) => t.id === picked && t.outcome === null);

  const cols: Column<LeishTest>[] = [
    { label: "Etiqueta", w: "1.4fr", card: "title", render: (t) => t.label },
    { label: "Coleta", w: "0.8fr", render: (t) => fmtDay(t.collected_on) },
    { label: "TR-DPP", w: "1fr", render: (t) => (t.dpp_result ? `${zooLabel(domains?.dpp_results, t.dpp_result)} · ${fmtDay(t.dpp_on)}` : "—") },
    { label: "ELISA", w: "1fr", render: (t) => (t.elisa_result ? `${zooLabel(domains?.elisa_results, t.elisa_result)} · ${fmtDay(t.elisa_on)}` : "—") },
    { label: "Desfecho", w: "1fr", render: (t) => (t.outcome ? zooLabel(domains?.leish_decisions, t.outcome.decision) : "—") },
    {
      label: "Ações", w: "1fr", card: "actions", render: (t) => (t.outcome === null
        ? <ActionButton variant="secondary" onClick={() => { setNotice(null); setPicked(t.id); }}>Lançar resultado</ActionButton> : null)
    }
  ];

  return (
    <div style={stack}>
      {label && <p role="status" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Etiqueta: {label}</p>}
      {!collecting && <div style={row}><ActionButton onClick={() => { setLabel(null); setNotice(null); setCollecting(true); }}>Nova coleta</ActionButton></div>}
      {collecting && (
        <CollectForm today={today} surveys={open} onCancel={() => setCollecting(false)}
          onStale={(text) => { setNotice(text); setCollecting(false); void reread(); }}
          onCollected={(t) => { setLabel(t.label); setCollecting(false); void reread(); }} />
      )}
      {notice && <p role="status" style={muted}>{notice}</p>}
      <label style={fieldLabel}>
        Filtrar por inquérito
        <select value={filter} style={inputStyle} onChange={(e) => { setFilter(e.target.value); setPicked(null); }}>
          <option value="">todos os exames</option>
          {listed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <p role="alert" style={alert}>{zoonosesError(q.error)}</p>}
      {q.data && <DataTable<LeishTest> label="Exames" cols={cols} rows={rows} rowKey={(t) => t.id} empty="nenhum exame" />}
      {q.hasNextPage && <div style={row}><ActionButton variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</ActionButton></div>}
      {editing && (
        <ResultForm key={`${editing.id}-${editing.version}`} test={editing} today={today} onCancel={() => setPicked(null)}
          onStale={(text) => { setNotice(text); setPicked(null); void reread(); }}
          onSaved={() => { setNotice("Resultado salvo."); setPicked(null); void reread(); }} />
      )}
    </div>
  );
}

// Coleta: no inquérito aberto (data a partir do início dele) ou avulsa (até 30 dias antes de hoje); DPP opcional, com a data.
function CollectForm({ today, surveys, onCollected, onStale, onCancel }: {
  today: string; surveys: LeishSurvey[]; onCollected(t: LeishTest): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems(zooFormOptions(staleButAnimal));
  const [ surveyId, setSurveyId ] = useState("");
  const [ dog, setDog ] = useState<Animal | null>(null);
  const [ collectedOn, setCollectedOn ] = useState(today);
  const [ dpp, setDpp ] = useState("");
  const [ dppOn, setDppOn ] = useState("");
  const busy = f.busy;
  const chosen = surveys.find((s) => s.id === surveyId) ?? null;

  function check(): Problem[] {
    const out = dogProblems(dog);
    const from = chosen ? chosen.starts_on : minusDays(today, 30);
    if (!validDay(collectedOn)) out.push({ path: "collected_on", text: "informe a data da coleta" });
    else if (collectedOn < from || collectedOn > today) out.push({ path: "collected_on", text: OUT_OF_RANGE });
    const pair = pairProblem(dpp, dppOn, "dpp_result", "TR-DPP");
    if (pair) out.push(pair);
    const range = validDay(collectedOn) ? rangeProblem(dppOn, collectedOn, today, "dpp_on") : null;
    if (range) out.push(range);
    return out;
  }
  const submit = (ev: React.FormEvent) => void f.submit(ev, {
    check,
    call: () => collectLeishTest({
      animal_id: dog!.id, collected_on: collectedOn, ...(chosen ? { leish_survey_id: chosen.id } : {}),
      ...(dpp ? { dpp_result: dpp as DppResult, dpp_on: dppOn } : {})
    }),
    ok: onCollected,
    stale: onStale,
    refused: (rs) => rs.map((r) => (r.code === "survey_not_open" ? { path: "leish_survey_id", text: r.text } : animalRefusal([ r ])[0]))
  });

  return (
    <div style={form}>
      {!dog && <div style={box}><AnimalSearch onOpen={(_id, a) => { setDog(a); f.clear("animal_id"); }} /></div>}
      <form ref={f.formRef} noValidate style={form} aria-label="Nova coleta" onSubmit={submit}>
        <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Nova coleta</p>
        <label style={fieldLabel}>
          Inquérito
          <select value={surveyId} disabled={busy} style={inputStyle} {...f.aria("leish_survey_id")}
            onChange={(e) => { setSurveyId(e.target.value); f.clear("leish_survey_id", "collected_on"); }}>
            <option value="">avulsa (sem inquérito)</option>
            {surveys.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {f.errNode("leish_survey_id")}
        {dog ? (
          <div style={row}>
            <span>{dog.name ?? "sem nome"} · {zooLabel(domains?.species, dog.species)}</span>
            <ActionButton variant="secondary" onClick={() => { if (!busy) { setDog(null); f.clear("animal_id"); } }}>Trocar animal</ActionButton>
          </div>
        ) : <p style={muted}>busque o cão acima</p>}
        {f.errNode("animal_id")}
        <label style={fieldLabel}>
          Data da coleta
          <input type="date" value={collectedOn} disabled={busy} style={inputStyle} {...f.aria("collected_on")}
            onChange={(e) => { setCollectedOn(e.target.value); f.clear("collected_on"); }} />
        </label>
        {f.errNode("collected_on")}
        <DppFields f={f} busy={busy} dpp={dpp} setDpp={setDpp} dppOn={dppOn} setDppOn={setDppOn} />
        {f.top((p) => [ "leish_survey_id", "animal_id", "collected_on", "dpp_result", "dpp_on" ].includes(p))}
        <div style={row}>
          <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Registrar coleta</button>
          <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

type Form = ReturnType<typeof useFormProblems>;
function DppFields({ f, busy, dpp, setDpp, dppOn, setDppOn }: {
  f: Form; busy: boolean; dpp: string; setDpp(v: string): void; dppOn: string; setDppOn(v: string): void;
}) {
  const domains = useZooDomains().data;
  return (
    <>
      <label style={fieldLabel}>
        Resultado do TR-DPP
        <select value={dpp} disabled={busy} style={inputStyle} {...f.aria("dpp_result")} onChange={(e) => { setDpp(e.target.value); f.clear("dpp_result"); }}>
          <option value="">sem resultado</option>
          {(domains?.dpp_results ?? []).map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
      </label>
      {f.errNode("dpp_result")}
      <label style={fieldLabel}>
        Data do TR-DPP
        <input type="date" value={dppOn} disabled={busy} style={inputStyle} {...f.aria("dpp_on")} onChange={(e) => { setDppOn(e.target.value); f.clear("dpp_on", "dpp_result"); }} />
      </label>
      {f.errNode("dpp_on")}
    </>
  );
}

// Correção do resultado (só sem desfecho): manda só o que mudou (vazio apaga) com `expected_version`.
type TestPatch = Partial<Pick<LeishTest, "dpp_result" | "dpp_on" | "elisa_result" | "elisa_on" | "elisa_request">> & { expected_version: number };
function ResultForm({ test, today, onSaved, onStale, onCancel }: {
  test: LeishTest; today: string; onSaved(t: LeishTest): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems(zooFormOptions());
  const [ dpp, setDpp ] = useState<string>(test.dpp_result ?? "");
  const [ dppOn, setDppOn ] = useState(test.dpp_on ?? "");
  const [ elisa, setElisa ] = useState<string>(test.elisa_result ?? "");
  const [ elisaOn, setElisaOn ] = useState(test.elisa_on ?? "");
  const [ request, setRequest ] = useState(test.elisa_request ?? "");
  const busy = f.busy;
  const showElisa = elisaAllowed({ dpp_result: (dpp || null) as DppResult | null });

  function patch(): TestPatch {
    const p: TestPatch = { expected_version: test.version };
    const orNull = (v: string) => (v === "" ? null : v);
    if (orNull(dpp) !== test.dpp_result) p.dpp_result = orNull(dpp) as DppResult | null;
    if (orNull(dppOn) !== test.dpp_on) p.dpp_on = orNull(dppOn);
    if (showElisa) {
      if (orNull(elisa) !== test.elisa_result) p.elisa_result = orNull(elisa) as ElisaResult | null;
      if (orNull(elisaOn) !== test.elisa_on) p.elisa_on = orNull(elisaOn);
      const req = orNull(request.trim());
      if (req !== test.elisa_request) p.elisa_request = req;
    }
    return p;
  }
  function check(): Problem[] {
    const out: Problem[] = [];
    const push = (p: Problem | null) => { if (p) out.push(p); };
    push(pairProblem(dpp, dppOn, "dpp_result", "TR-DPP"));
    push(rangeProblem(dppOn, test.collected_on, today, "dpp_on"));
    if (showElisa) {
      push(pairProblem(elisa, elisaOn, "elisa_result", "ELISA"));
      push(rangeProblem(elisaOn, test.collected_on, today, "elisa_on"));
      if (request.trim() !== "") push(textProblem(request, { min: 1, max: 30, path: "elisa_request" }));
    }
    if (out.length === 0 && Object.keys(patch()).length === 1) out.push({ path: "", text: NOTHING_CHANGED });
    return out;
  }
  const submit = (ev: React.FormEvent) => void f.submit(ev, { check, call: () => updateLeishTest(test.id, patch()), ok: onSaved, stale: onStale });

  return (
    <form ref={f.formRef} noValidate style={{ ...form, ...box }} aria-label={`Resultado ${test.label}`} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Resultado {test.label}</p>
      <DppFields f={f} busy={busy} dpp={dpp} setDpp={setDpp} dppOn={dppOn} setDppOn={setDppOn} />
      {showElisa ? (
        <>
          <label style={fieldLabel}>
            Resultado do ELISA
            <select value={elisa} disabled={busy} style={inputStyle} {...f.aria("elisa_result")} onChange={(e) => { setElisa(e.target.value); f.clear("elisa_result"); }}>
              <option value="">sem resultado</option>
              {(domains?.elisa_results ?? []).map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
            </select>
          </label>
          {f.errNode("elisa_result")}
          <label style={fieldLabel}>
            Data do ELISA
            <input type="date" value={elisaOn} disabled={busy} style={inputStyle} {...f.aria("elisa_on")}
              onChange={(e) => { setElisaOn(e.target.value); f.clear("elisa_on", "elisa_result"); }} />
          </label>
          {f.errNode("elisa_on")}
          <label style={fieldLabel}>
            Requisição do GAL
            <input value={request} autoComplete="off" disabled={busy} style={inputStyle} {...f.aria("elisa_request")}
              onChange={(e) => { setRequest(e.target.value); f.clear("elisa_request"); }} />
          </label>
          {f.errNode("elisa_request")}
        </>
      ) : <p style={muted}>{ZOONOSES_ERRORS.elisa_without_reactive_dpp}</p>}
      {/* Sem os campos do ELISA na tela, a recusa do api neles (ELISA gravado e DPP corrigido) sobe ao topo em vez de sumir. */}
      {f.top((p) => [ "dpp_result", "dpp_on", ...(showElisa ? [ "elisa_result", "elisa_on", "elisa_request" ] : []) ].includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Salvar resultado</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}

// ─── Desfecho pendente ──────────────────────────────────────────────────────
export function PendingOutcomes({ today, onGoToShelter }: { today: string; onGoToShelter?(): void }) {
  const client = useQueryClient();
  const [ picked, setPicked ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: [ ZOO_TESTS_KEY, "outcome" ], ...STATIC_QUERY, initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listLeishTests({ pending: "outcome", before: pageParam }),
    getNextPageParam: (last) => last.next_before ?? undefined
  });
  // O api já filtra; a tela confere de novo: só o cão reagente nos dois exames.
  const rows = (q.data?.pages.flatMap((p) => p.items) ?? []).filter((t) => isReactiveDog(t) && t.outcome === null);
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_TESTS_KEY ] });
  const current = rows.find((t) => t.id === picked);

  const cols: Column<LeishTest>[] = [
    { label: "Etiqueta", w: "1.4fr", card: "title", render: (t) => t.label },
    { label: "Coleta", w: "0.8fr", render: (t) => fmtDay(t.collected_on) },
    { label: "TR-DPP", w: "0.8fr", render: (t) => fmtDay(t.dpp_on) },
    { label: "ELISA", w: "0.8fr", render: (t) => fmtDay(t.elisa_on) },
    { label: "Ações", w: "1fr", card: "actions", render: (t) => <ActionButton variant="secondary" onClick={() => { setNotice(null); setPicked(t.id); }}>Registrar desfecho</ActionButton> }
  ];
  return (
    <div style={stack}>
      {notice && <p role="status" style={muted}>{notice}</p>}
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <p role="alert" style={alert}>{zoonosesError(q.error)}</p>}
      {q.data && <DataTable<LeishTest> label="Desfecho pendente" cols={cols} rows={rows} rowKey={(t) => t.id} empty="nenhum cão reagente sem desfecho" />}
      {q.hasNextPage && <div style={row}><ActionButton variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</ActionButton></div>}
      {current && (
        <OutcomeForm key={current.id} test={current} today={today} onGoToShelter={onGoToShelter} onCancel={() => setPicked(null)}
          onStale={(text) => { setNotice(text); setPicked(null); void reread(); }}
          onSaved={() => { setNotice("Desfecho registrado."); setPicked(null); void reread(); }} />
      )}
    </div>
  );
}

function OutcomeForm({ test, today, onGoToShelter, onSaved, onStale, onCancel }: {
  test: LeishTest; today: string; onGoToShelter?(): void; onSaved(): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems(zooFormOptions());
  const [ decision, setDecision ] = useState("");
  const [ decidedOn, setDecidedOn ] = useState(today);
  const [ note, setNote ] = useState("");
  const busy = f.busy;
  const euth = decision === "euthanasia";
  // O histórico grava trilha: lido só quando a eutanásia é escolhida, nunca guardado.
  const hist = useQuery({ queryKey: [ ZOO_ANIMAL_KEY, test.animal.id ], queryFn: () => getAnimal(test.animal.id), ...NOMINAL_QUERY, enabled: euth });
  const euthanasia = hist.data?.euthanasia ?? null;

  function check(): Problem[] {
    const out: Problem[] = leishOutcomeProblems({ decision: decision || null, euthanasiaId: euthanasia?.id ?? null }, { tutor: test.animal.has_tutor })
      .map((p) => ({ path: p.path, text: p.text }));
    if (!validDay(decidedOn)) out.push({ path: "decided_on", text: "informe a data da decisão" });
    else if (decidedOn < test.collected_on || decidedOn > today) out.push({ path: "decided_on", text: OUT_OF_RANGE });
    if (note.trim() !== "") {
      const n = textProblem(note, { min: 10, max: 500, path: "note" });
      if (n) out.push(n);
    }
    return out;
  }
  const submit = (ev: React.FormEvent) => void f.submit(ev, {
    check,
    call: () => recordLeishOutcome({
      leish_test_id: test.id, decision: decision as LeishDecision, decided_on: decidedOn, ...(note.trim() ? { note: note.trim() } : {}),
      ...(euth && euthanasia ? { euthanasia_id: euthanasia.id } : {})
    }),
    ok: () => onSaved(),
    stale: onStale,
    // O api não tem código próprio: `invalid_request` no path da eutanásia ou da decisão.
    refused: (rs) => rs.map((r) => (r.code === "invalid_request" && r.path === "euthanasia_id" ? { path: r.path, text: NEEDS_EUTHANASIA }
      : r.code === "invalid_request" && r.path === "decision" ? { path: r.path, text: NEEDS_TUTOR } : { path: r.path, text: r.text }))
  });

  return (
    <form ref={f.formRef} noValidate style={{ ...form, ...box }} aria-label={`Desfecho ${test.label}`} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Desfecho {test.label}</p>
      <label style={fieldLabel}>
        Decisão
        <select value={decision} disabled={busy} style={inputStyle} {...f.aria("decision")}
          onChange={(e) => { setDecision(e.target.value); f.clear("decision", "euthanasia_id"); }}>
          <option value="">escolha</option>
          {(domains?.leish_decisions ?? []).map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
        </select>
      </label>
      {f.errNode("decision")}
      {euth && hist.isLoading && <p style={muted}>lendo o histórico do animal…</p>}
      {euth && hist.isError && <p role="alert" style={alert}>{zoonosesError(hist.error)}</p>}
      {euth && euthanasia && <p style={muted}>eutanásia de {fmtDay(euthanasia.performed_on)}</p>}
      {euth && hist.isSuccess && !euthanasia && (
        <div style={row}>
          <span style={muted}>sem eutanásia gravada para este animal: a veterinária registra em Canil e gatil</span>
          {onGoToShelter && <ActionButton variant="secondary" onClick={onGoToShelter}>Ir para Canil e gatil</ActionButton>}
        </div>
      )}
      {f.errNode("euthanasia_id")}
      <label style={fieldLabel}>
        Data da decisão
        <input type="date" value={decidedOn} disabled={busy} style={inputStyle} {...f.aria("decided_on")}
          onChange={(e) => { setDecidedOn(e.target.value); f.clear("decided_on"); }} />
      </label>
      {f.errNode("decided_on")}
      <label style={fieldLabel}>
        Nota (opcional)
        <textarea value={note} rows={2} disabled={busy} style={inputStyle} {...f.aria("note")} onChange={(e) => { setNote(e.target.value); f.clear("note"); }} />
      </label>
      {f.errNode("note")}
      {f.top((p) => [ "decision", "euthanasia_id", "decided_on", "note" ].includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Salvar desfecho</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
