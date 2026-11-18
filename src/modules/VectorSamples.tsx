// src/modules/VectorSamples.tsx
// "Amostras de larvas" da coordenação de endemias e do laboratório de entomologia (módulo 35a, F-35.8; contrato §9, §17; Q9, Q23,
// Q27, Q32). Papel: coordenação e laboratório (SamplesController#reader!; os dois lançam, RecordSampleResult). Duas abas, cada uma
// com o próprio cursor (Q27: o cursor codifica a aba; o de uma na outra → 422 invalid_cursor):
//   - "Sem resultado" (GET /samples?state=pending): por dia da visita, a mais antiga primeiro, na ordem do api;
//   - "Com resultado" (GET /samples?state=done): por result_at decrescente, o lançado ou corrigido por último primeiro.
// A fila não traz imóvel nem pessoa (etiqueta, dia, grupo, larvas e quarteirão) e não grava trilha: STATIC_QUERY. Cada aba lê ao
// ser aberta pela primeira vez e depois fica montada e escondida (voltar a ela não relê). O grupo do depósito sai do GET /domains
// (Q32); código cru só se ele falhar.
// "Lançar resultado" / "Corrigir resultado" abrem o formulário: examinadas, Ae. aegypti, Ae. albopictus e, só na correção, a nota
// (record_sample_result.rb: o primeiro resultado com nota → 422 result_note; a correção exige nota de 10–500 e muda algum número).
// Depois de gravar, a aba aberta é relida UMA vez; depois de lançar, "Com resultado" fica velha e relê UMA vez quando estiver (ou
// ficar) à vista, mesmo se foi aberta com o envio em voo (a correção não muda "Sem resultado").
// Tela velha (relê UMA vez, sem reenvio): 404, o primeiro resultado recusado em result_note (outra pessoa lançou antes) e rede/5xx
// (sem client_uuid: não se sabe se gravou).
// Q36: a correção leva `expected_version` (a version da amostra que a tela mostra; o primeiro resultado nunca). 409 sample_changed
// (outra pessoa corrigiu no meio): a frase no formulário, a fila relida UMA vez e o digitado fica; o formulário recebe a amostra
// relida, e o envio seguinte leva a version nova. A correção recusada em examined_larvae (os mesmos números) vai ao campo.
// Frases de sucesso (Q36(1)): "resultado lançado" / "resultado corrigido"; a frase do LIRAa sai, porque a amostra da fila não
// diz se veio de levantamento do LIRAa (Json.samples não tem origem nem levantamento).
// A nota nunca sai do campo. Nada em URL ou storage; nenhum polling.
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, getVectorDomains, listVectorSamples, recordSampleResult, type ApiError, type VectorControlDomains, type VectorSample
} from "../lib/api";
import { fmtDateTime, fmtNumber } from "../lib/format";
import { fmtDay, isNetworkOrServer } from "../lib/homeVisits";
import {
  SAMPLE_SAME_NUMBERS, STATIC_QUERY, VC_DOMAINS_KEY, VC_SAMPLES_KEY, domainLabel, isVectorStale, optionalNote, sampleResultProblems, vectorError,
  vectorRefusals
} from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { VectorGate } from "./vectorControl/VectorGate";
import { usePaged } from "./homeVisits/usePaged";
import { VectorListBody } from "./vectorControl/VectorListBody";
import { useFormProblems } from "./psychosocial/useFormProblems";
import { SegmentedControl } from "../shell/SegmentedControl";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { FrozenTextNotice } from "../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, form, muted, okText, row, stack } from "./exams/styles";

// Q36(1), na convenção das frases do 35a (minúscula, sem ponto final; revisão final M1).
export const RESULT_SAVED = "resultado lançado";
export const RESULT_CORRECTED = "resultado corrigido";
export const PENDING_EMPTY = "nenhuma amostra sem resultado";
export const DONE_EMPTY = "nenhuma amostra com resultado";
export const SAMPLE_STALE_REREAD = "a fila foi relida";
export const SAMPLE_RACED = "esta amostra já tem resultado — a fila foi relida; para mudar, abra a aba Com resultado e use Corrigir resultado";
export const SAMPLE_UNCERTAIN = "não foi possível confirmar o resultado — a fila foi relida; confira a amostra antes de lançar de novo";
export const SAMPLE_CORRECTION_UNCERTAIN = "não foi possível confirmar a correção — a fila foi relida; confira a amostra antes de corrigir de novo";
export const SAMPLE_NOTE_REPEATED = "a nota é igual à da correção anterior — escreva o que mudou nesta correção";

type State = "pending" | "done";
const TABS: { key: State; label: string }[] = [ { key: "pending", label: "Sem resultado" }, { key: "done", label: "Com resultado" } ];
const LIST_LABEL: Record<State, string> = { pending: "Amostras sem resultado", done: "Amostras com resultado" };
const OWN = [ "examined_larvae", "aegypti_larvae", "albopictus_larvae", "result_note" ];
const samplesKey = (state: State) => [ VC_SAMPLES_KEY, state ];

export function VectorSamples() {
  return (
    <VectorGate title="Amostras de larvas" sub="endemias · amostras do boletim e resultado" allow={(r) => r.coordinator || r.lab}>
      {() => <SamplesScreen />}
    </VectorGate>
  );
}

function SamplesScreen() {
  const queryClient = useQueryClient();
  const [ tab, setTab ] = useState<State>("pending");
  const [ visited, setVisited ] = useState<ReadonlySet<State>>(() => new Set<State>([ "pending" ]));
  // Refs, não estado: a resposta de um envio chega com o closure do clique, e a aba pode ter mudado (ou montado) enquanto ele voava.
  const tabRef = useRef<State>("pending");
  const mounted = useRef<Set<State>>(new Set<State>([ "pending" ]));
  // "Com resultado" velha por um lançamento: relê UMA vez quando estiver (ou ficar) à vista; se ainda não montou, a montagem já lê.
  const dirty = useRef<Set<State>>(new Set<State>());
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, ...STATIC_QUERY });
  const refresh = (t: State) => {
    if (!dirty.current.delete(t)) return;
    if (mounted.current.has(t)) void queryClient.invalidateQueries({ queryKey: samplesKey(t) });
  };
  const open = (t: State) => {
    tabRef.current = t;
    setTab(t);
    refresh(t);
    mounted.current.add(t);
    setVisited((v) => (v.has(t) ? v : new Set([ ...v, t ])));
  };
  // Gravou em `from`: a aba aberta relê (o SamplesList). O lançamento (ou a corrida) muda "Com resultado", vista ou não, montada ou
  // não; a correção não mexe em "Sem resultado" (a amostra já saiu dela).
  const saved = (from: State) => {
    if (from !== "pending") return;
    dirty.current.add("done");
    if (tabRef.current === "done") refresh("done");
  };
  return (
    <div style={stack}>
      <div><SegmentedControl options={TABS} value={tab} onChange={open} /></div>
      {TABS.map(({ key, label }) => visited.has(key) && (
        <div key={key} role="tabpanel" aria-label={label} style={{ ...stack, display: tab === key ? "flex" : "none" }}>
          <SamplesList state={key} domains={domains.data} onSaved={() => saved(key)} />
        </div>
      ))}
    </div>
  );
}

const groupText = (domains: VectorControlDomains | undefined, code: string): string => domainLabel(domains?.deposit_groups ?? [], code);
const resultText = (s: VectorSample): string =>
  s.result ? `${fmtNumber(s.result.examined_larvae)} examinadas · ${fmtNumber(s.result.aegypti_larvae)} Ae. aegypti · ${fmtNumber(s.result.albopictus_larvae)} Ae. albopictus` : "—";

function SamplesList({ state, domains, onSaved }: { state: State; domains: VectorControlDomains | undefined; onSaved(): void }) {
  const queryClient = useQueryClient();
  const key = samplesKey(state);
  // O cursor é o desta aba (usePaged por chave): nunca vai à outra.
  const list = usePaged<VectorSample>(key, (before) => listVectorSamples({ state, ...(before ? { before } : {}) }), false, true, vectorError);
  const [ open, setOpen ] = useState<VectorSample | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ note, setNote ] = useState<string | null>(null);
  const corrected = state === "done";
  // Q36: depois do 409 sample_changed a fila é relida com o formulário aberto; ele recebe a amostra relida (version nova).
  const current = open ? list.items?.find((s) => s.id === open.id) ?? open : null;

  // Uma releitura por ação: refaz as páginas já mostradas desta aba.
  const finish = (doneText: string | null, noteText: string | null, again: boolean) => {
    setOpen(null); setDone(doneText); setNote(noteText);
    if (again) { void queryClient.invalidateQueries({ queryKey: key }); onSaved(); }
  };
  const start = (s: VectorSample) => { setDone(null); setNote(null); setOpen(s); };
  const action = corrected ? "Corrigir resultado" : "Lançar resultado";

  const cols: Column<VectorSample>[] = [
    { label: "Etiqueta", w: "1.1fr", card: "title", render: (s) => <strong className="mono">{s.label}</strong> },
    { label: "Data da visita", w: "0.9fr", render: (s) => fmtDay(s.visit_on) },
    { label: "Grupo", w: "1.8fr", render: (s) => groupText(domains, s.deposit_group) },
    { label: "Larvas coletadas", w: "0.7fr", align: "right", render: (s) => fmtNumber(s.larvae_collected) },
    { label: "Quarteirão", w: "0.7fr", render: (s) => s.city_block?.number ?? "—" },
    ...(corrected ? [
      { label: "Resultado", w: "2fr", render: (s: VectorSample) => resultText(s) },
      {
        label: "Lançado em", w: "1.2fr", render: (s: VectorSample) => (
          <span style={row}>{fmtDateTime(s.result?.result_at)}{s.result?.corrected && <Tag tone="neutral">corrigido</Tag>}</span>
        )
      }
    ] : []),
    {
      label: "Ação", w: "170px", card: "actions", render: (s) => (
        <button type="button" style={secondaryButtonStyle} aria-label={`${action} — amostra ${s.label}`} onClick={() => start(s)}>{action}</button>
      )
    }
  ];

  const label = LIST_LABEL[state];
  return (
    <>
      {open && (
        <Panel title={action}>
          <div style={{ padding: 16 }}>
            <SampleResultForm sample={current ?? open} corrected={corrected} group={groupText(domains, open.deposit_group)}
              onDone={() => finish(corrected ? RESULT_CORRECTED : RESULT_SAVED, null, true)} onStale={(text) => finish(null, text, true)}
              onReread={() => void queryClient.invalidateQueries({ queryKey: key })} onCancel={() => finish(null, null, false)} />
          </div>
        </Panel>
      )}
      {/* A lista fica montada enquanto o formulário está aberto: fechar não a lê de novo. */}
      <div style={{ ...stack, display: open ? "none" : "flex" }}>
        {done && <p role="status" style={okText}>{done}</p>}
        {note && <p role="alert" style={alert}>{note}</p>}
        <Panel title={label}>
          <div style={{ padding: 16 }}>
            <VectorListBody list={list}>
              {(items) => <DataTable<VectorSample> label={label} cols={cols} rows={items} rowKey={(s) => s.id} empty={corrected ? DONE_EMPTY : PENDING_EMPTY} />}
            </VectorListBody>
          </div>
        </Panel>
      </div>
    </>
  );
}

// ─── Formulário do resultado ────────────────────────────────────────────────
const invalidAt = (err: unknown, path: string): boolean =>
  errorCode(err) === "invalid_request" && ((err as ApiError).body as { path?: string } | null)?.path === path;
// O primeiro resultado recusado em result_note: a tela nunca manda nota nele, então outra pessoa lançou antes (virou correção).
// Desde a Q36 o api confere a versão antes da nota e responde 422 expected_version_required (record_sample_result.rb:70-72); o 422
// result_note antigo fica de reserva (a tela nunca manda nota nem versão no primeiro resultado).
const raced = (err: unknown, corrected: boolean): boolean =>
  !corrected && (errorCode(err) === "expected_version_required" || invalidAt(err, "result_note"));

function SampleResultForm({ sample, corrected, group, onDone, onStale, onReread, onCancel }: {
  sample: VectorSample; corrected: boolean; group: string; onDone(s: VectorSample): void; onStale(text: string): void; onReread(): void;
  onCancel(): void;
}) {
  const f = useFormProblems({
    refusals: (err) => vectorRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isVectorStale(err) || raced(err, corrected) || isNetworkOrServer(err)
  });
  const [ examined, setExamined ] = useState("");
  const [ aegypti, setAegypti ] = useState("");
  const [ albopictus, setAlbopictus ] = useState("");
  const [ note, setNote ] = useState("");
  const noteId = `result-note-notice-${sample.id}`;

  function submit(ev: FormEvent) {
    void f.submit(ev, {
      check: () => sampleResultProblems({ examined, aegypti, albopictus, note: corrected ? note : "" }, sample, corrected),
      call: () => recordSampleResult(sample.id, {
        examined_larvae: Number(examined.trim()), aegypti_larvae: Number(aegypti.trim()), albopictus_larvae: Number(albopictus.trim()),
        ...(corrected ? { ...optionalNote("result_note", note), expected_version: sample.version } : {})
      }),
      ok: onDone,
      stale: (text, err) => {
        if (errorCode(err) === "sample_changed") { f.show([ { path: "", text: VECTOR_ERRORS.sample_changed } ]); onReread(); return; }
        if (isNetworkOrServer(err)) onStale(corrected ? SAMPLE_CORRECTION_UNCERTAIN : SAMPLE_UNCERTAIN);
        else if (raced(err, corrected)) onStale(SAMPLE_RACED);
        else onStale(`${text} — ${SAMPLE_STALE_REREAD}`);
      },
      // Na correção, a mesma nota da anterior (a nota nunca sai no JSON: só o api confere) e os mesmos números.
      refused: (rs) => rs.map((r) => ({ path: r.path, text: !corrected || r.code !== "invalid_request" ? r.text
        : r.path === "result_note" ? SAMPLE_NOTE_REPEATED : r.path === "examined_larvae" ? SAMPLE_SAME_NUMBERS : r.text }))
    });
  }

  const busy = f.busy;
  const title = `${corrected ? "Corrigir resultado" : "Lançar resultado"} — amostra ${sample.label}`;
  const number = (path: string, text: ReactNode, value: string, set: (v: string) => void) => (
    <>
      <label style={fieldLabel}>
        {text}
        <input value={value} inputMode="numeric" autoComplete="off" disabled={busy} style={inputStyle} {...f.aria(path)}
          onChange={(e) => { set(e.target.value); f.clear(...OWN.filter((p) => p !== "result_note")); }} />
      </label>
      {f.errNode(path)}
    </>
  );
  return (
    <form ref={f.formRef} noValidate style={form} aria-label={title} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}><span className="mono">{title}</span></p>
      <span style={muted}>
        {[ `visita de ${fmtDay(sample.visit_on)}`, group, `${fmtNumber(sample.larvae_collected)} ${sample.larvae_collected === 1 ? "larva coletada" : "larvas coletadas"}`,
          sample.city_block ? `quarteirão ${sample.city_block.number}` : "sem quarteirão",
          corrected && sample.result ? `resultado atual: ${resultText(sample)}` : null ].filter(Boolean).join(" · ")}
      </span>

      {number("examined_larvae", "Larvas examinadas", examined, setExamined)}
      {number("aegypti_larvae", <span><i>Ae. aegypti</i></span>, aegypti, setAegypti)}
      {number("albopictus_larvae", <span><i>Ae. albopictus</i></span>, albopictus, setAlbopictus)}

      {corrected && (
        <>
          <label style={fieldLabel}>
            Nota da correção
            <textarea value={note} disabled={busy} style={{ ...inputStyle, minHeight: 56 }} {...f.aria("result_note")}
              aria-describedby={[ f.aria("result_note")["aria-describedby"], noteId ].filter(Boolean).join(" ")}
              onChange={(e) => { setNote(e.target.value); f.clear("result_note", "examined_larvae"); }} />
          </label>
          <FrozenTextNotice id={noteId} />
          {f.errNode("result_note")}
        </>
      )}

      {f.top((p) => OWN.includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>
          {corrected ? "Registrar correção" : "Registrar resultado"}
        </button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
