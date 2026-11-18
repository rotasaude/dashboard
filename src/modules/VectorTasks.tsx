// src/modules/VectorTasks.tsx
// "Tarefas de endemias" da coordenação (módulo 35a; contrato §6, §8, §17; Q9). Papel: só a coordenação (TasksController:
// coordinator!; os outros recebem 403 missing_role e o portão nem lê). O api abre três tipos (Catalog::TASK_KINDS):
//   - ovitrap_intensification: a contagem passou do alerta; o cartão mostra a ovitrampa e os quarteirões sugeridos;
//   - case_resident_elsewhere: caso de residente de outro município; o cartão mostra a doença e a data do caso;
//   - block_case_without_place: o bloqueio nasceu sem quarteirão; "Abrir o bloqueio" vai à tela do bloqueio.
// Duas abas, cada uma com o próprio cursor (GET /tasks?state=open|closed, created_at decrescente nas duas): "Abertas" e
// "Encerradas" (concluídas e descartadas). Sem pessoa nem trilha (Json.tasks): STATIC_QUERY. Cada aba lê ao ser aberta pela
// primeira vez e depois fica montada e escondida (voltar a ela não relê).
// "Concluir" e "Dispensar" pedem nota de 10–500 (CloseTask; a nota nunca sai do api) → POST /tasks/:id/close { state, note }.
// Depois de encerrar, "Abertas" é relida UMA vez e "Encerradas" fica velha (relê UMA vez quando estiver, ou ficar, à vista).
// Tela velha (relê UMA vez, sem reenvio): 409 invalid_transition (outra pessoa encerrou antes), 404 e rede/5xx (não se sabe se
// gravou; reenviar daria 409, mas a tela relê para mostrar o que vale).
// Nunca paciente: a tarefa não traz número do caso nem pessoa; a doença sai em código (sem fonte de rótulo para a coordenação até
// a Q38). Nada em URL ou storage; nenhum polling.
import { useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { closeVectorTask, errorCode, listVectorTasks, type VectorTask } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { fmtDay, isNetworkOrServer } from "../lib/homeVisits";
import { VC_TASKS_KEY, isVectorStale, noteProblem, taskKindLabel, taskStateLabel, vectorError, vectorRefusals } from "../lib/vectorControl";
import { VECTOR_ERRORS } from "../lib/vectorErrors";
import { VectorGate } from "./vectorControl/VectorGate";
import { VectorListBody } from "./vectorControl/VectorListBody";
import { usePaged } from "./homeVisits/usePaged";
import { useFormProblems } from "./psychosocial/useFormProblems";
import { SegmentedControl } from "../shell/SegmentedControl";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { FrozenTextNotice } from "../components/FrozenTextNotice";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, form, muted, okText, row, stack } from "./exams/styles";

export const TASK_DONE = "Tarefa concluída.";
export const TASK_DISMISSED = "Tarefa dispensada.";
export const OPEN_EMPTY = "nenhuma tarefa aberta";
export const CLOSED_EMPTY = "nenhuma tarefa encerrada";
export const TASK_GONE = "esta tarefa não existe mais — a lista foi relida";
export const TASK_UNCERTAIN = "não foi possível confirmar o encerramento — a lista foi relida; confira a tarefa antes de tentar de novo";
export const NO_PLACE_TEXT = "o caso não tem quarteirão conhecido — escolha o centro e a área no bloqueio proposto";

type Tab = "open" | "closed";
type CloseState = "done" | "dismissed";
const TABS: { key: Tab; label: string }[] = [ { key: "open", label: "Abertas" }, { key: "closed", label: "Encerradas" } ];
const LIST_LABEL: Record<Tab, string> = { open: "Tarefas abertas", closed: "Tarefas encerradas" };
const tasksKey = (t: Tab) => [ VC_TASKS_KEY, t ];

export function VectorTasks({ onOpenTransmission }: { onOpenTransmission?: () => void } = {}) {
  return (
    <VectorGate title="Tarefas de endemias" sub="endemias · tarefas da coordenação" allow={(r) => r.coordinator}>
      {() => <TasksScreen onOpenTransmission={onOpenTransmission} />}
    </VectorGate>
  );
}

function TasksScreen({ onOpenTransmission }: { onOpenTransmission?: () => void }) {
  const queryClient = useQueryClient();
  const [ tab, setTab ] = useState<Tab>("open");
  const [ visited, setVisited ] = useState<ReadonlySet<Tab>>(() => new Set<Tab>([ "open" ]));
  // Refs: a resposta do envio chega com o closure do clique, e a aba pode ter mudado (ou montado) enquanto ele voava.
  const tabRef = useRef<Tab>("open");
  const mounted = useRef<Set<Tab>>(new Set<Tab>([ "open" ]));
  const dirty = useRef<Set<Tab>>(new Set<Tab>());
  const refresh = (t: Tab) => {
    if (!dirty.current.delete(t)) return;
    if (mounted.current.has(t)) void queryClient.invalidateQueries({ queryKey: tasksKey(t) });
  };
  const open = (t: Tab) => {
    tabRef.current = t;
    setTab(t);
    refresh(t);
    mounted.current.add(t);
    setVisited((v) => (v.has(t) ? v : new Set([ ...v, t ])));
  };
  // Encerrou (ou a tela estava velha): "Encerradas" mudou, vista ou não, montada ou não.
  const changed = () => {
    dirty.current.add("closed");
    if (tabRef.current === "closed") refresh("closed");
  };
  return (
    <div style={stack}>
      <div><SegmentedControl options={TABS} value={tab} onChange={open} /></div>
      {TABS.map(({ key, label }) => visited.has(key) && (
        <div key={key} role="tabpanel" aria-label={label} style={{ ...stack, display: tab === key ? "flex" : "none" }}>
          <TasksList state={key} onChanged={changed} onOpenTransmission={onOpenTransmission} />
        </div>
      ))}
    </div>
  );
}

// "Quarteirões 12, 13 e 14" / "Quarteirão 12".
function blocksText(blocks: { number: string }[]): string | null {
  const n = blocks.map((b) => b.number);
  if (n.length === 0) return null;
  if (n.length === 1) return `Quarteirão ${n[0]}`;
  return `Quarteirões ${n.slice(0, -1).join(", ")} e ${n[n.length - 1]}`;
}

function TasksList({ state, onChanged, onOpenTransmission }: { state: Tab; onChanged(): void; onOpenTransmission?: () => void }) {
  const queryClient = useQueryClient();
  const key = tasksKey(state);
  const list = usePaged<VectorTask>(key, (before) => listVectorTasks({ state, ...(before ? { before } : {}) }), false, true, vectorError);
  const [ closing, setClosing ] = useState<{ id: string; to: CloseState } | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ note, setNote ] = useState<string | null>(null);
  const label = LIST_LABEL[state];

  // Uma releitura por ação: refaz as páginas já mostradas desta aba.
  const finish = (doneText: string | null, noteText: string | null) => {
    setClosing(null); setDone(doneText); setNote(noteText);
    void queryClient.invalidateQueries({ queryKey: key });
    onChanged();
  };
  const start = (id: string, to: CloseState) => { setDone(null); setNote(null); setClosing({ id, to }); };

  return (
    <div style={stack}>
      {done && <p role="status" style={okText}>{done}</p>}
      {note && <p role="alert" style={alert}>{note}</p>}
      <Panel title={label}>
        <div style={{ padding: 16 }}>
          <VectorListBody list={list}>
            {(items) => items.length === 0 ? <p role="status" style={muted}>{state === "open" ? OPEN_EMPTY : CLOSED_EMPTY}</p> : (
              <ul aria-label={label} style={{ ...stack, gap: 12, listStyle: "none", margin: 0, padding: 0 }}>
                {items.map((t) => (
                  <li key={t.id}>
                    <TaskCard task={t} onOpenTransmission={onOpenTransmission}
                      closing={closing?.id === t.id ? closing.to : null} onStart={(to) => start(t.id, to)}
                      onDone={(to) => finish(to === "done" ? TASK_DONE : TASK_DISMISSED, null)} onStale={(text) => finish(null, text)}
                      onCancel={() => setClosing(null)} />
                  </li>
                ))}
              </ul>
            )}
          </VectorListBody>
        </div>
      </Panel>
    </div>
  );
}

function TaskCard({ task, closing, onStart, onDone, onStale, onCancel, onOpenTransmission }: {
  task: VectorTask; closing: CloseState | null; onStart(to: CloseState): void; onDone(to: CloseState): void; onStale(text: string): void;
  onCancel(): void; onOpenTransmission?: () => void;
}) {
  const isOpen = task.state === "open";
  const blocks = task.kind === "ovitrap_intensification" ? blocksText(task.suggested_blocks) : null;
  return (
    <article style={box} aria-label={`${taskKindLabel(task.kind)} — criada em ${fmtDateTime(task.created_at)}`}>
      <div style={row}>
        <strong>{taskKindLabel(task.kind)}</strong>
        {!isOpen && <Tag tone={task.state === "done" ? "ok" : "neutral"} mono={false}>{taskStateLabel(task.state)}</Tag>}
      </div>
      <span style={muted}>criada em {fmtDateTime(task.created_at)}</span>
      {!isOpen && <span style={muted}>encerrada em {fmtDateTime(task.closed_at)}</span>}

      {task.ovitrap && (
        <span style={row}><span style={muted}>Ovitrampa</span><strong className="mono">{task.ovitrap.number}</strong></span>
      )}
      {task.kind === "ovitrap_intensification" && <span>{blocks ?? "sem quarteirão sugerido"}</span>}
      {task.kind === "case_resident_elsewhere" && (
        <>
          <span style={row}><span style={muted}>Doença</span><strong className="mono">{task.disease ?? "—"}</strong></span>
          <span style={row}><span style={muted}>Data do caso</span><span>{task.case_on ? fmtDay(task.case_on) : "—"}</span></span>
        </>
      )}
      {task.kind === "block_case_without_place" && isOpen && (
        <>
          <span style={muted}>{NO_PLACE_TEXT}</span>
          {onOpenTransmission && (
            <div><button type="button" style={secondaryButtonStyle} onClick={() => onOpenTransmission()}>Abrir o bloqueio</button></div>
          )}
        </>
      )}

      {isOpen && (closing ? (
        <CloseForm task={task} to={closing} onDone={() => onDone(closing)} onStale={onStale} onCancel={onCancel} />
      ) : (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} onClick={() => onStart("done")}>Concluir</button>
          <button type="button" style={secondaryButtonStyle} onClick={() => onStart("dismissed")}>Dispensar</button>
        </div>
      ))}
    </article>
  );
}

// ─── Encerrar ───────────────────────────────────────────────────────────────
function CloseForm({ task, to, onDone, onStale, onCancel }: {
  task: VectorTask; to: CloseState; onDone(): void; onStale(text: string): void; onCancel(): void;
}) {
  const f = useFormProblems({
    refusals: (err) => vectorRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isVectorStale(err) || isNetworkOrServer(err)
  });
  const [ text, setText ] = useState("");
  const noteId = `task-note-notice-${task.id}`;
  const verb = to === "done" ? "Concluir" : "Dispensar";

  function submit(ev: FormEvent) {
    void f.submit(ev, {
      check: () => { const p = noteProblem(text, "note"); return p ? [ p ] : []; },
      call: () => closeVectorTask(task.id, { state: to, note: text.trim() }),
      ok: onDone,
      stale: (_text, err) => {
        if (isNetworkOrServer(err)) onStale(TASK_UNCERTAIN);
        else if (errorCode(err) === "invalid_transition") onStale(VECTOR_ERRORS.invalid_transition);
        else onStale(TASK_GONE);
      }
    });
  }

  const busy = f.busy;
  return (
    <form ref={f.formRef} noValidate style={form} aria-label={`${verb} — ${taskKindLabel(task.kind)}`} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>{verb} a tarefa</p>
      <label style={fieldLabel}>
        Nota
        <textarea value={text} disabled={busy} style={{ ...inputStyle, minHeight: 56 }} {...f.aria("note")}
          aria-describedby={[ f.aria("note")["aria-describedby"], noteId ].filter(Boolean).join(" ")}
          onChange={(e) => { setText(e.target.value); f.clear("note"); }} />
      </label>
      <FrozenTextNotice id={noteId} />
      {f.errNode("note")}
      {f.top((p) => p === "note")}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>{verb} tarefa</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
