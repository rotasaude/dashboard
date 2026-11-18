// src/modules/vectorControl/BlockDetail.tsx
// Detalhe do bloqueio de transmissão (módulo 35a, F-35.7; contrato §8, §11, §17; Q8, Q9, Q13(6)(9), Q26, Q28). Só a coordenação
// (TransmissionBlocksController: coordinator!). GET /transmission_blocks/:id sem pessoa e sem trilha: STATIC_QUERY, relido só depois
// de ação. O caso só como "caso N · doença · data" (e "sem quarteirão" quando !has_place); nunca paciente, notificação ou coordenada.
//   - proposto: quarteirão do caso (`<select>`; o centro, pré-escolhido quando o api o achou) e a área (os da sugestão de anéis
//     pré-marcados; outros quarteirões de um bairro, GET /blocks?neighborhood_id=); "Confirmar bloqueio" com step-up manda
//     { center_block_id, block_ids, seen_case_ids } (Q26(4): os casos que a tela mostra); "Descartar" com motivo 10–500;
//   - ativo: "Fechar bloqueio" (ConfirmButton) e os ciclos de UBV ("Novo ciclo", Blocks::AddCycle pelas regras de ubvCycleProblems);
//   - proposto ou ativo: por caso, "Juntar a outro bloqueio" (destino proposto/ativo, nunca o próprio) e, no caso sem quarteirão,
//     "Ver endereço do caso" (CaseAddressDialog: step-up, só no estado do diálogo);
//   - o mapa da área (camada transmission: só "área", Q28) só por clique (grava a trilha territory_map).
// A resposta de cada escrita vai à tela (setQueryData do bloqueio) e as listas são relidas UMA vez. Tela velha (409 invalid_transition,
// 409 proposal_changed, 422 seen_case_ids, 404): a frase e UMA releitura do detalhe e das listas, sem reenvio; o escolhido fica.
// Nada em URL ou storage; nenhum polling.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addTransmissionCycle, closeTransmissionBlock, confirmTransmissionBlock, dismissTransmissionBlock, getTransmissionBlock, getVectorParameters,
  listCityBlocks, listPanelNeighborhoods, listTransmissionBlocks, moveTransmissionCase, type TransmissionBlock, type TransmissionCase
} from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import { fmtDay } from "../../lib/homeVisits";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { sortByName } from "../../lib/territory";
import { useActionMessage } from "../../lib/useActionMessage";
import {
  STATIC_QUERY, VC_BLOCKS_KEY, VC_BLOCKS_TB_KEY, VC_BLOCK_TB_KEY, VC_PARAMS_KEY, blockStatusLabel, caseLabel, isVectorStale, noteProblem,
  ubvCycleProblems, vectorError, vectorRefusals
} from "../../lib/vectorControl";
import { usePaged } from "../homeVisits/usePaged";
import { CaseAddressDialog } from "./CaseAddressDialog";
import { VectorMapPanel } from "./VectorMapPanel";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { ActionMessage } from "../../components/ActionMessage";
import { ConfirmButton } from "../../components/ConfirmButton";
import { SensitiveAction } from "../../components/SensitiveAction";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, legend, list, muted, row, stack } from "../exams/styles";

export const BLOCK_CONFIRMED = "bloqueio confirmado";
export const PROPOSAL_DISMISSED = "proposta descartada";
export const BLOCK_CLOSED = "bloqueio fechado";
export const CYCLE_SAVED = (n: number) => `ciclo ${n} de UBV gravado`;
export const CASE_MOVED = (n: number) => `caso ${n} juntado ao outro bloqueio`;
export const NEED_CENTER = "escolha o quarteirão do caso";
export const NEED_AREA = "marque ao menos um quarteirão da área";
// Blocks::Confirm::AREA_MAX e CASES_MAX.
export const AREA_MAX = 500;
export const CASES_MAX = 500;
export const AREA_TOO_BIG = `a área tem no máximo ${AREA_MAX} quarteirões`;
export const TOO_MANY_CASES = `a proposta tem mais de ${CASES_MAX} casos — a confirmação aceita até ${CASES_MAX}`;
export const CENTER_IN_AREA = "o quarteirão do caso entra sempre na área";
export const CLOSE_QUESTION = "Fechar o bloqueio? Ele deixa de receber ciclos e casos.";
export const NO_TARGET = "nenhum outro bloqueio proposto ou ativo";
// 422 invalid_request path seen_case_ids (Q26(4)): a lista mostrada não confere com a proposta (caso que saiu ou de outra proposta).
export const CASES_REREAD = "os casos da proposta mudaram enquanto a tela estava aberta — os dados foram relidos";
const staleText = (err: unknown) => {
  const r = vectorRefusals(err)[0];
  return r.code === "invalid_request" && r.path === "seen_case_ids" ? CASES_REREAD : r.text;
};
// O api aceita confirmar a proposta sem caso (seen_case_ids: [], confirm.rb:40-61; o último caso foi juntado a outro bloqueio):
// a tela pede que a coordenação diga isso de propósito.
export const NO_CASE = "a proposta não tem caso — descarte-a, ou marque que o bloqueio segue sem caso";
export const NO_CASE_ACK = "o bloqueio segue sem caso";
// Json.transmission_blocks tira o quarteirão inativo da sugestão, o centro incluído (json.rb:343-353): centro fora da área = inativo,
// e o confirm o recusaria (422 center_block_id).
export const CENTER_INACTIVE = (n: string) => `o quarteirão ${n} do caso está inativo — escolha outro quarteirão`;
const CONFIRM_DESCRIPTION = (cases: number, area: number) =>
  `Confirma o bloqueio ${cases === 0 ? "sem caso" : `com ${cases === 1 ? "o caso mostrado" : `os ${cases} casos mostrados`}`} e ${area === 1 ? "1 quarteirão" : `${area} quarteirões`} na área. Se entrou caso novo, a tela relê a proposta.`;

const OPEN = [ "proposed", "active" ];
const STATUS_TONE: Record<string, string> = { proposed: "warn", active: "info", closed: "ok", dismissed: "neutral" };
const blockKey = (id: string) => [ VC_BLOCK_TB_KEY, id ];
export const caseText = (c: TransmissionCase) => `${caseLabel(c)} · ${c.disease} · ${fmtDay(c.case_on)}`;
export const centerText = (b: Pick<TransmissionBlock, "center_block">) => (b.center_block ? `quarteirão ${b.center_block.number}` : "sem quarteirão");
const casesCount = (n: number) => (n === 1 ? "1 caso" : `${n} casos`);
// O destino no `<select>` do mover: status, quarteirão do caso, casos e quando nasceu (nunca pessoa).
const targetText = (b: TransmissionBlock) =>
  `${blockStatusLabel(b.status)} · ${centerText(b)} · ${casesCount(b.cases.length)} · criado em ${fmtDateTime(b.created_at)}`;

type Msg = ReturnType<typeof useActionMessage>;
type Ctx = { block: TransmissionBlock; msg: Msg; changed(b: TransmissionBlock): Promise<void>; stale(err: unknown): Promise<void> };

export function BlockDetail({ id, onGoToSecurity }: { id: string; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: blockKey(id), queryFn: () => getTransmissionBlock(id), ...STATIC_QUERY });
  const msg = useActionMessage();
  const lists = () => queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_TB_KEY ] });
  // A resposta já é o bloqueio novo: vai à tela, e as listas relidas uma vez.
  const changed = async (b: TransmissionBlock) => { queryClient.setQueryData(blockKey(b.id), b); await lists(); };
  // Tela velha: a frase e UMA releitura do que estava na tela.
  const stale = async (err: unknown) => {
    msg.fail(staleText(err));
    await Promise.all([ queryClient.invalidateQueries({ queryKey: blockKey(id) }), lists() ]);
  };

  if (q.isError && !q.data) {
    return (
      <Panel title="Bloqueio">
        <div style={row}>
          <p role="alert" style={alert}>{vectorError(q.error)}</p>
          <button type="button" style={secondaryButtonStyle} disabled={q.isFetching} onClick={() => void q.refetch()}>Tentar de novo</button>
        </div>
      </Panel>
    );
  }
  if (!q.data) return <p role="status" style={muted}>Carregando…</p>;
  const block = q.data;
  const ctx: Ctx = { block, msg, changed, stale };
  const open = OPEN.includes(block.status);
  return (
    <Panel title={`Bloqueio · ${centerText(block)}`} sub={`criado em ${fmtDateTime(block.created_at)}`}
      right={<Tag tone={STATUS_TONE[block.status] ?? "neutral"}>{blockStatusLabel(block.status)}</Tag>}>
      <div style={stack}>
        <ActionMessage message={msg.message} />
        <p style={muted}>
          {[ `doença do grupo ${block.disease_group}`, block.confirmed_at && `confirmado em ${fmtDateTime(block.confirmed_at)}`,
            block.closed_at && `fechado em ${fmtDateTime(block.closed_at)}` ].filter(Boolean).join(" · ")}
        </p>
        <div style={stack}>
          <strong>Casos</strong>
          {block.cases.length === 0 ? <p style={muted}>nenhum caso neste bloqueio</p> : (
            <ul aria-label="Casos do bloqueio" style={{ ...list, gap: 10 }}>
              {block.cases.map((c) => (
                <li key={c.id}>
                  <div style={stack}>
                    <span>{caseText(c)}{c.has_place ? "" : " · sem quarteirão"}</span>
                    {open && (
                      <div style={row}>
                        {!c.has_place && (
                          <CaseAddressDialog blockId={block.id} caseId={c.id} caseNumber={c.number} onGoToSecurity={onGoToSecurity}
                            onStale={(e) => void stale(e)} />
                        )}
                        <MoveCase ctx={ctx} c={c} />
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        {block.status === "proposed" ? <ProposalSection ctx={ctx} onGoToSecurity={onGoToSecurity} /> : (
          <p style={muted}>{`quarteirão do caso: ${block.center_block?.number ?? "—"} · quarteirões da área: ${block.area.map((a) => a.number).join(", ") || "—"}`}</p>
        )}
        <CyclesSection ctx={ctx} />
        {block.status === "active" && (
          <div style={row}>
            <ConfirmButton label="Fechar bloqueio" question={CLOSE_QUESTION} onConfirm={async () => {
              msg.start();
              try {
                const b = await closeTransmissionBlock(block.id);
                msg.ok(BLOCK_CLOSED);
                await changed(b);
              } catch (err) {
                if (isVectorStale(err)) await stale(err);
                else msg.fail(vectorError(err));
              }
            }} />
          </div>
        )}
        <AreaMap blockId={block.id} />
      </div>
    </Panel>
  );
}

// ── Proposta: quarteirão do caso, área, confirmar e descartar ──
type AreaRow = { id: string; label: string };
function ProposalSection({ ctx, onGoToSecurity }: { ctx: Ctx; onGoToSecurity?: () => void }) {
  const { block, msg, changed, stale } = ctx;
  const centerInactive = !!block.center_block && !block.area.some((a) => a.id === block.center_block?.id);
  const [ center, setCenter ] = useState(block.center_block && !centerInactive ? block.center_block.id : "");
  const [ noCaseAck, setNoCaseAck ] = useState(false);
  const [ checked, setChecked ] = useState<ReadonlySet<string>>(() => new Set(block.area.filter((a) => a.suggested).map((a) => a.id)));
  // Quarteirões de bairro já escolhidos (centro ou área): continuam à vista ao trocar de bairro.
  const [ extras, setExtras ] = useState<AreaRow[]>([]);
  const [ picking, setPicking ] = useState(block.area.length === 0 || centerInactive);
  const [ neighborhoodId, setNeighborhoodId ] = useState("");
  const [ confirming, setConfirming ] = useState(false);
  const confirmed = useRef<TransmissionBlock | null>(null);
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, enabled: picking, ...STATIC_QUERY });
  const cityBlocks = useQuery({ queryKey: [ VC_BLOCKS_KEY, neighborhoodId ], queryFn: () => listCityBlocks(neighborhoodId), enabled: !!neighborhoodId, ...STATIC_QUERY });

  const areaRows: AreaRow[] = block.area.map((a) => ({ id: a.id, label: `quarteirão ${a.number}${a.suggested ? " (sugerido)" : ""}` }));
  // Só os ativos: o confirm recusa quarteirão inativo.
  const nbRows: AreaRow[] = (cityBlocks.data ?? []).filter((b) => b.active).map((b) => ({ id: b.id, label: `quarteirão ${b.number} · ${b.neighborhood.name}` }));
  const seen = new Set<string>();
  const rows = [ ...areaRows, ...extras, ...nbRows ].filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  const keep = (id: string) => {
    const r = nbRows.find((x) => x.id === id);
    if (r && !extras.some((x) => x.id === id)) setExtras((e) => [ ...e, r ]);
  };
  const toggle = (id: string) => {
    msg.start();
    keep(id);
    setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const blockIds = rows.filter((r) => checked.has(r.id)).map((r) => r.id);
  const reason = !center || (centerInactive && center === block.center_block?.id) ? NEED_CENTER : blockIds.length === 0 ? NEED_AREA : blockIds.length > AREA_MAX ? AREA_TOO_BIG
    : block.cases.length > CASES_MAX ? TOO_MANY_CASES : block.cases.length === 0 && !noCaseAck ? NO_CASE : null;

  async function done() {
    setConfirming(false);
    const b = confirmed.current;
    confirmed.current = null;
    if (!b) return;
    msg.ok(BLOCK_CONFIRMED);
    await changed(b);
  }

  return (
    <div style={stack}>
      <fieldset style={fieldset}>
        <legend style={legend}>Área do bloqueio</legend>
        <label style={{ ...fieldLabel, maxWidth: 320 }}>
          Quarteirão do caso
          <select value={center} style={inputStyle} onChange={(e) => { msg.start(); keep(e.target.value); setCenter(e.target.value); }}>
            <option value="">escolha o quarteirão</option>
            {centerInactive && block.center_block && (
              <option value={block.center_block.id} disabled>{`quarteirão ${block.center_block.number} (inativo)`}</option>
            )}
            {rows.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        {centerInactive && block.center_block && <p role="status" style={alert}>{CENTER_INACTIVE(block.center_block.number)}</p>}
        <p style={muted}>{CENTER_IN_AREA}</p>
        {rows.length === 0 ? <p style={muted}>sem quarteirão sugerido — escolha um bairro</p> : rows.map((r) => (
          <label key={r.id} style={checkLabel}>
            <input type="checkbox" checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
            {r.label}
          </label>
        ))}
        {!picking ? (
          <div><button type="button" style={secondaryButtonStyle} onClick={() => setPicking(true)}>Escolher quarteirões de um bairro</button></div>
        ) : (
          <>
            <label style={{ ...fieldLabel, maxWidth: 320 }}>
              Bairro
              <select value={neighborhoodId} disabled={neighborhoods.isPending} style={inputStyle} onChange={(e) => setNeighborhoodId(e.target.value)}>
                <option value="">escolha o bairro</option>
                {sortByName(neighborhoods.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>)}
              </select>
            </label>
            {neighborhoods.isError && <p role="alert" style={alert}>não foi possível carregar os bairros</p>}
            {cityBlocks.isError && <p role="alert" style={alert}>{vectorError(cityBlocks.error)}</p>}
          </>
        )}
      </fieldset>
      {block.cases.length === 0 && (
        <label style={checkLabel}>
          <input type="checkbox" checked={noCaseAck} onChange={(e) => { msg.start(); setNoCaseAck(e.target.checked); }} />
          {NO_CASE_ACK}
        </label>
      )}
      {!confirming ? (
        <div style={row}>
          <ActionButton disabledReason={reason} onClick={() => { msg.start(); setConfirming(true); }}>Confirmar bloqueio</ActionButton>
        </div>
      ) : (
        <SensitiveAction
          title="Confirmar o bloqueio"
          description={CONFIRM_DESCRIPTION(block.cases.length, new Set([ ...blockIds, center ]).size)}
          requiresStepUp
          run={async () => {
            confirmed.current = await confirmTransmissionBlock(block.id, {
              center_block_id: center, block_ids: blockIds, seen_case_ids: block.cases.map((c) => c.id)
            });
          }}
          onDone={() => void done()}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(e) => {
            // O SensitiveAction fecha aqui: a frase vai à mensagem do detalhe (a mesma devolvida).
            setConfirming(false);
            if (isVectorStale(e)) { void stale(e); return staleText(e); }
            const text = vectorError(e);
            msg.fail(text);
            return text;
          }}
        />
      )}
      <DismissForm ctx={ctx} />
    </div>
  );
}

function DismissForm({ ctx }: { ctx: Ctx }) {
  const { block, msg, changed, stale } = ctx;
  const [ open, setOpen ] = useState(false);
  const [ reason, setReason ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const noticeId = `tb-dismiss-${block.id}`;
  const problemId = `tb-dismiss-problem-${block.id}`;
  if (!open) {
    return <div style={row}><ActionButton variant="secondary" onClick={() => { msg.start(); setOpen(true); }}>Descartar</ActionButton></div>;
  }
  async function dismiss() {
    msg.start();
    const p = noteProblem(reason, "reason");
    setProblem(p?.text ?? null);
    if (p) return;
    try {
      const b = await dismissTransmissionBlock(block.id, reason.trim());
      msg.ok(PROPOSAL_DISMISSED);
      await changed(b);
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      if (isVectorStale(err)) await stale(err);
      else if (refusal.path === "reason") setProblem(noteProblem("", "reason")?.text ?? null);
      else msg.fail(refusal.text);
    }
  }
  return (
    <div style={{ ...stack, gap: 8 }}>
      <label style={fieldLabel}>
        Motivo do descarte
        <textarea rows={3} value={reason} style={inputStyle} aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${problemId} ${noticeId}` : noticeId}
          onChange={(e) => { setReason(e.target.value); setProblem(null); msg.start(); }} />
      </label>
      <FrozenTextNotice id={noticeId} />
      {problem && <span id={problemId} style={alert}>{problem}</span>}
      <div style={row}>
        <ActionButton variant="danger" onClick={dismiss}>Descartar proposta</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={() => { setOpen(false); setProblem(null); }}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Ciclos de UBV (só o ativo recebe) ──
type CycleField = "starts_on" | "ends_on";
function CyclesSection({ ctx }: { ctx: Ctx }) {
  const { block, msg, changed, stale } = ctx;
  const [ open, setOpen ] = useState(false);
  const [ draft, setDraft ] = useState<Record<CycleField, string>>({ starts_on: "", ends_on: "" });
  const [ problems, setProblems ] = useState<Partial<Record<CycleField | "cycles", string>>>({});
  const active = block.status === "active";
  const params = useQuery({ queryKey: [ VC_PARAMS_KEY ], queryFn: getVectorParameters, enabled: open && active, ...STATIC_QUERY });
  const set = (k: CycleField, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setProblems((p) => { const { [k]: _, cycles: __, ...rest } = p; return rest; });
    msg.start();
  };
  const toProblems = (list: { path: string; text: string }[]) => {
    const out: Partial<Record<CycleField | "cycles", string>> = {};
    for (const p of list) {
      const k = (p.path === "starts_on" || p.path === "ends_on" ? p.path : "cycles") as CycleField | "cycles";
      if (!out[k]) out[k] = p.text;
    }
    return out;
  };

  async function save() {
    msg.start();
    if (!params.data) return;
    const found = ubvCycleProblems(block.cycles, draft, params.data.values);
    setProblems(toProblems(found));
    if (found.length > 0) return;
    try {
      const b = await addTransmissionCycle(block.id, { starts_on: draft.starts_on, ends_on: draft.ends_on });
      const n = b.cycles.length > 0 ? b.cycles[b.cycles.length - 1].number : block.cycles.length + 1;
      setOpen(false);
      setDraft({ starts_on: "", ends_on: "" });
      msg.ok(CYCLE_SAVED(n));
      await changed(b);
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      if (isVectorStale(err)) await stale(err);
      else if (refusal.code === "cycle_invalid" || [ "starts_on", "ends_on" ].includes(refusal.path)) setProblems(toProblems([ refusal ]));
      else msg.fail(refusal.text);
    }
  }

  const input = (key: CycleField, label: string) => {
    const id = `tb-cycle-${block.id}-${key}`;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ ...fieldLabel, minWidth: 160 }}>
          {label}
          <input type="date" value={draft[key]} style={inputStyle} aria-invalid={problems[key] ? true : undefined}
            aria-describedby={problems[key] ? id : undefined} onChange={(e) => set(key, e.target.value)} />
        </label>
        {problems[key] && <span id={id} style={alert}>{problems[key]}</span>}
      </div>
    );
  };

  return (
    <div style={stack}>
      <strong>Ciclos de UBV</strong>
      {block.cycles.length === 0 ? <p style={muted}>nenhum ciclo</p> : (
        <ul aria-label="Ciclos de UBV" style={list}>
          {block.cycles.map((c) => <li key={c.number}>{`ciclo ${c.number} · ${fmtDay(c.starts_on)} a ${fmtDay(c.ends_on)}`}</li>)}
        </ul>
      )}
      {active && !open && (
        <div><button type="button" style={secondaryButtonStyle} onClick={() => { msg.start(); setOpen(true); }}>Novo ciclo</button></div>
      )}
      {active && open && (
        params.isError ? (
          <div style={row}>
            <p role="alert" style={alert}>{vectorError(params.error)}</p>
            <button type="button" style={secondaryButtonStyle} disabled={params.isFetching} onClick={() => void params.refetch()}>Tentar de novo</button>
          </div>
        ) : !params.data ? <p role="status" style={muted}>Carregando…</p> : (
          <div style={stack}>
            <div style={{ ...row, alignItems: "flex-start" }}>
              {input("starts_on", "Início do ciclo")}
              {input("ends_on", "Fim do ciclo")}
            </div>
            {problems.cycles && <p role="alert" style={alert}>{problems.cycles}</p>}
            <div style={row}>
              <ActionButton onClick={save}>Gravar ciclo</ActionButton>
              <button type="button" style={secondaryButtonStyle} onClick={() => { setOpen(false); setProblems({}); }}>Cancelar</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── Juntar o caso a outro bloqueio (proposto/ativo; nunca o próprio) ──
function MoveCase({ ctx, c }: { ctx: Ctx; c: TransmissionCase }) {
  const [ open, setOpen ] = useState(false);
  if (!open) {
    return (
      <button type="button" style={secondaryButtonStyle} aria-label={`Juntar o ${caseLabel(c)} a outro bloqueio`}
        onClick={() => { ctx.msg.start(); setOpen(true); }}>Juntar a outro bloqueio</button>
    );
  }
  return <MoveCaseForm ctx={ctx} c={c} onCancel={() => setOpen(false)} />;
}

function MoveCaseForm({ ctx, c, onCancel }: { ctx: Ctx; c: TransmissionCase; onCancel(): void }) {
  const queryClient = useQueryClient();
  const { block, msg, stale } = ctx;
  const [ target, setTarget ] = useState("");
  const targets = usePaged<TransmissionBlock>([ VC_BLOCKS_TB_KEY, "open" ], (before) => listTransmissionBlocks({ status: [ "proposed", "active" ], before }),
    false, true, vectorError);
  const options = (targets.items ?? []).filter((b) => b.id !== block.id && OPEN.includes(b.status));

  async function move() {
    msg.start();
    if (!target) return;
    try {
      const to = await moveTransmissionCase(block.id, c.id, target);
      queryClient.setQueryData(blockKey(to.id), to);
      msg.ok(CASE_MOVED(c.number));
      // O caso saiu deste bloqueio: UMA releitura dele e das listas.
      await Promise.all([ queryClient.invalidateQueries({ queryKey: blockKey(block.id) }), queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_TB_KEY ] }) ]);
    } catch (err) {
      if (isVectorStale(err)) await stale(err);
      else msg.fail(vectorError(err));
    }
  }

  return (
    <div style={{ ...row, alignItems: "flex-end" }}>
      <label style={{ ...fieldLabel, minWidth: 280 }}>
        Bloqueio de destino
        <select value={target} disabled={!targets.items} style={inputStyle} onChange={(e) => { msg.start(); setTarget(e.target.value); }}>
          <option value="">escolha o bloqueio</option>
          {options.map((b) => <option key={b.id} value={b.id}>{targetText(b)}</option>)}
        </select>
      </label>
      <ActionButton disabledReason={!target ? (targets.items && options.length === 0 ? NO_TARGET : "escolha o bloqueio de destino") : null} onClick={move}>
        {`Juntar ${caseLabel(c)}`}
      </ActionButton>
      {targets.hasMore && (
        <button type="button" style={secondaryButtonStyle} disabled={targets.loadingMore} onClick={() => void targets.more()}>Carregar mais bloqueios</button>
      )}
      <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      {targets.error && <p role="alert" style={alert}>{vectorError(targets.error)}</p>}
    </div>
  );
}

// ── Mapa da área (só por clique: grava a trilha territory_map; montado depois, escondido sem reler) ──
function AreaMap({ blockId }: { blockId: string }) {
  const [ shown, setShown ] = useState(false);
  const [ mounted, setMounted ] = useState(false);
  return (
    <div style={stack}>
      <div>
        <button type="button" style={secondaryButtonStyle} onClick={() => { setShown(!shown); setMounted(true); }}>
          {shown ? "Esconder mapa" : "Ver mapa da área"}
        </button>
      </div>
      {mounted && (
        <div style={{ display: shown ? "block" : "none" }}>
          <VectorMapPanel query={{ layer: "transmission", transmissionBlockId: blockId }} title="Imóveis da área do bloqueio" />
        </div>
      )}
    </div>
  );
}
