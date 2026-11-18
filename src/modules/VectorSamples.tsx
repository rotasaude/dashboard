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
// Depois de gravar, a aba aberta é relida UMA vez; depois de lançar, "Com resultado", se já foi aberta, relê uma vez quando for
// aberta de novo (a correção não muda "Sem resultado").
// Tela velha (relê UMA vez, sem reenvio): 404, o primeiro resultado recusado em result_note (outra pessoa lançou antes), a correção
// recusada em examined_larvae (os números já são esses: outra pessoa corrigiu) e rede/5xx (sem client_uuid: não se sabe se gravou).
// A nota nunca sai do campo. Nada em URL ou storage; nenhum polling.
import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  errorCode, getVectorDomains, listVectorSamples, recordSampleResult, type ApiError, type VectorControlDomains, type VectorSample
} from "../lib/api";
import { fmtDateTime, fmtNumber } from "../lib/format";
import { fmtDay, isNetworkOrServer } from "../lib/homeVisits";
import {
  STATIC_QUERY, VC_DOMAINS_KEY, VC_SAMPLES_KEY, domainLabel, isVectorStale, optionalNote, sampleResultProblems, vectorError, vectorRefusals
} from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
import { usePaged, type Paged } from "./homeVisits/usePaged";
import { useFormProblems } from "./psychosocial/useFormProblems";
import { SegmentedControl } from "../shell/SegmentedControl";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { FrozenTextNotice } from "../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, form, muted, okText, row, stack } from "./exams/styles";

export const RESULT_SAVED = "Resultado lançado. O índice do LIRAa usa o resultado novo.";
export const PENDING_EMPTY = "nenhuma amostra sem resultado";
export const DONE_EMPTY = "nenhuma amostra com resultado";
export const SAMPLE_STALE_REREAD = "a fila foi relida";
export const SAMPLE_RACED = "esta amostra já tem resultado — a fila foi relida; para mudar, use Corrigir resultado";
export const SAMPLE_CHANGED = "o resultado desta amostra mudou — a fila foi relida; confira antes de corrigir";
export const SAMPLE_UNCERTAIN = "não foi possível confirmar o resultado — a fila foi relida; confira a amostra antes de lançar de novo";
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
  // A aba escondida que ficou velha com uma gravação na outra: relê uma vez, quando for aberta.
  const [ dirty, setDirty ] = useState<ReadonlySet<State>>(() => new Set<State>());
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, ...STATIC_QUERY });
  const open = (t: State) => {
    setTab(t);
    setVisited((v) => (v.has(t) ? v : new Set([ ...v, t ])));
    if (dirty.has(t)) {
      setDirty((d) => new Set([ ...d ].filter((x) => x !== t)));
      void queryClient.invalidateQueries({ queryKey: samplesKey(t) });
    }
  };
  // Gravou em `from`: a aba aberta relê (o SamplesList). O resultado novo (ou a corrida) muda "Com resultado": se montada, ela
  // relê quando for aberta. A correção não mexe em "Sem resultado" (a amostra já saiu dela).
  const saved = (from: State) => {
    if (from === "pending" && visited.has("done")) setDirty((d) => new Set([ ...d, "done" as const ]));
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
            <SampleResultForm sample={open} corrected={corrected} group={groupText(domains, open.deposit_group)}
              onDone={() => finish(RESULT_SAVED, null, true)} onStale={(text) => finish(null, text, true)} onCancel={() => finish(null, null, false)} />
          </div>
        </Panel>
      )}
      {/* A lista fica montada enquanto o formulário está aberto: fechar não a lê de novo. */}
      <div style={{ ...stack, display: open ? "none" : "flex" }}>
        {done && <p role="status" style={okText}>{done}</p>}
        {note && <p role="alert" style={alert}>{note}</p>}
        <Panel title={label}>
          <div style={{ padding: 16 }}>
            <ListBody list={list}>
              {(items) => <DataTable<VectorSample> label={label} cols={cols} rows={items} rowKey={(s) => s.id} empty={corrected ? DONE_EMPTY : PENDING_EMPTY} />}
            </ListBody>
          </div>
        </Panel>
      </div>
    </>
  );
}

// O corpo da lista paginada: a recusa pela tabela do 35a (nunca o código cru), carregando, itens e "Carregar mais".
function ListBody<T>({ list, children }: { list: Paged<T>; children(items: T[]): ReactNode }) {
  if (list.error) return <p role="alert" style={alert}>{vectorError(list.error)}</p>;
  if (!list.items) return <p role="status" style={muted}>Carregando…</p>;
  return (
    <div style={stack}>
      {list.note && <p role="status" style={muted}>{list.note}</p>}
      {children(list.items)}
      {list.hasMore && (
        <div>
          <button type="button" style={secondaryButtonStyle} disabled={list.loadingMore} onClick={() => void list.more()}>
            {list.loadingMore ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Formulário do resultado ────────────────────────────────────────────────
const invalidAt = (err: unknown, path: string): boolean =>
  errorCode(err) === "invalid_request" && ((err as ApiError).body as { path?: string } | null)?.path === path;
// O primeiro resultado recusado em result_note: a tela nunca manda nota nele, então outra pessoa lançou antes (virou correção).
const raced = (err: unknown, corrected: boolean): boolean => !corrected && invalidAt(err, "result_note");
// A correção recusada em examined_larvae: a tela já recusa os mesmos números do resultado que mostrou, então ele mudou do outro lado.
const changed = (err: unknown, corrected: boolean): boolean => corrected && invalidAt(err, "examined_larvae");

function SampleResultForm({ sample, corrected, group, onDone, onStale, onCancel }: {
  sample: VectorSample; corrected: boolean; group: string; onDone(s: VectorSample): void; onStale(text: string): void; onCancel(): void;
}) {
  const f = useFormProblems({
    refusals: (err) => vectorRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isVectorStale(err) || raced(err, corrected) || changed(err, corrected) || isNetworkOrServer(err)
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
        ...(corrected ? optionalNote("result_note", note) : {})
      }),
      ok: onDone,
      stale: (text, err) => {
        if (isNetworkOrServer(err)) onStale(SAMPLE_UNCERTAIN);
        else if (raced(err, corrected)) onStale(SAMPLE_RACED);
        else if (changed(err, corrected)) onStale(SAMPLE_CHANGED);
        else onStale(`${text} — ${SAMPLE_STALE_REREAD}`);
      },
      // A mesma nota da correção anterior (a nota nunca sai no JSON: só o api confere).
      refused: (rs) => rs.map((r) => ({ path: r.path, text: corrected && r.code === "invalid_request" && r.path === "result_note" ? SAMPLE_NOTE_REPEATED : r.text }))
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
