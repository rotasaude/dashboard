// Aba "Ações" da matrícula (F-31.4): a lista (`GET /psychosocial/actions?enrollment_id`, 200 por página, "Carregar mais" pelo
// `next_before`, R13) nunca traz evolução: cada linha é lida campo a campo antes de ir ao cache, mesmo que o api mande outro campo
// por engano. Situação pelo `cancelled` (o api não diz se o mês está fechado: decide no cancelamento). O detalhe só no clique
// (`ActionDetail`, com `NOMINAL_QUERY` e o id do CAPS na chave) e sai do cache ao fechar. "Registrar ação" só com a matrícula aberta.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listPsyActions, type PsyActionRow, type PsyEnrollment, type PsyOptions, type PsyPage, type PsyUnit } from "../../lib/api";
import { fmtDateTime } from "../../lib/format";
import {
  ACTION_SAVED, NOMINAL_QUERY, NO_ACTIONS, PSY_ACTIONS_KEY, PSY_DETAIL_KEY, TRAIL_NOTE, instrumentLabel, placeLabel, psyError, type PsyRoles
} from "../../lib/psychosocial";
import { DataTable, type Column } from "../../components/DataTable";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, okText, row } from "../exams/styles";
import { ActionDetail, actionStatusTag } from "./ActionDetail";
import { ActionForm } from "./ActionForm";

export type ActionsPanelProps = { enrollment: PsyEnrollment; unit: PsyUnit; options: PsyOptions; roles: PsyRoles; now: Date };

// Só os campos da linha (sem `notes`, sem nada clínico).
const actionRowOf = (r: PsyActionRow): PsyActionRow => ({
  id: r.id, sigtap: { code: r.sigtap.code, name: r.sigtap.name, instrument: r.sigtap.instrument }, instrument: r.instrument,
  performed_at: r.performed_at, place: r.place, quantity: r.quantity,
  professional: { user_id: r.professional.user_id, name: r.professional.name, cbo_code: r.professional.cbo_code ?? null },
  group_id: r.group_id ?? null, participants_count: r.participants_count, cancelled: r.cancelled === true
});
const struck: CSSProperties = { textDecoration: "line-through" };

export function ActionsPanel({ enrollment: e, unit, options, roles, now }: ActionsPanelProps) {
  const queryClient = useQueryClient();
  const listKey = [ PSY_ACTIONS_KEY, unit.id, e.id ];
  const actions = useInfiniteQuery({
    queryKey: listKey,
    queryFn: async ({ pageParam }): Promise<PsyPage<PsyActionRow>> => {
      const page = await listPsyActions(e.id, pageParam);
      return { items: page.items.map(actionRowOf), next_before: page.next_before };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const [ creating, setCreating ] = useState(false);
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  // "Fechar ação" devolve o foco ao "Abrir" de origem; sem ele, à lista.
  const opener = useRef<HTMLElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [ refocus, setRefocus ] = useState(0);
  useEffect(() => {
    if (refocus === 0) return;
    const el = opener.current;
    (el && el.isConnected ? el : listRef.current)?.focus();
  }, [ refocus ]);
  // A lista mudou enquanto se rolava: a frase, e relê do começo.
  useEffect(() => {
    if (!actions.isFetchNextPageError || errorCode(actions.error) !== "invalid_cursor") return;
    setNotice(psyError(actions.error));
    void queryClient.resetQueries({ queryKey: listKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ actions.isFetchNextPageError, actions.error ]);

  const reload = () => { void queryClient.resetQueries({ queryKey: listKey }); };
  const closeDetail = () => {
    setOpenId(null);
    queryClient.removeQueries({ queryKey: [ PSY_DETAIL_KEY, unit.id, "action" ] });
  };
  const open = (id: string, from: HTMLElement) => { setDone(null); setNotice(null); closeDetail(); opener.current = from; setOpenId(id); };
  const close = () => { closeDetail(); setRefocus((n) => n + 1); };
  const stale = (text: string) => { closeDetail(); setNotice(text); reload(); };

  const rows = (actions.data?.pages.flatMap((p) => p.items) ?? []).filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
  const when = (r: PsyActionRow) => fmtDateTime(r.performed_at);
  const cols: Column<PsyActionRow>[] = [
    { label: "Data e hora", w: "auto", card: "title", render: when },
    { label: "Procedimento", w: "1.6fr", render: (r) => <span title={r.sigtap.code}>{r.sigtap.name || r.sigtap.code}</span> },
    { label: "Instrumento", w: "auto", render: (r) => instrumentLabel(r.instrument) },
    { label: "Local", w: "auto", render: (r) => placeLabel(r.place) },
    { label: "Qtd.", w: "auto", render: (r) => String(r.quantity) },
    { label: "Profissional", w: "1fr", render: (r) => r.professional.name },
    { label: "Participantes", w: "auto", render: (r) => String(r.participants_count) },
    { label: "Situação", w: "auto", render: (r) => actionStatusTag(r.cancelled) },
    { label: "Ações", w: "auto", card: "actions", render: (r) => (
      <button type="button" style={secondaryButtonStyle} aria-label={`Abrir ação de ${when(r)}`} onClick={(ev) => open(r.id, ev.currentTarget)}>Abrir</button>
    ) }
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {notice && <p ref={noticeRef} tabIndex={-1} role="alert" style={alert}>{notice}</p>}
      {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
      {e.status === "open" && !creating && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => { setDone(null); setNotice(null); setCreating(true); }}>Registrar ação</button>
        </div>
      )}
      {creating && (
        <ActionForm unit={unit} options={options} enrollment={{ id: e.id, name: e.patient.name, startedOn: e.started_on }} now={now}
          onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); setDone(ACTION_SAVED); reload(); }} />
      )}
      {openId && (
        <ActionDetail key={openId} actionId={openId} roles={roles} unit={unit} onClose={close} onChanged={reload} onStale={stale} />
      )}
      <p style={muted}>{TRAIL_NOTE}</p>
      {actions.isPending && <p className="mono" style={muted}>carregando…</p>}
      {actions.isError && <p role="alert" style={alert}>{psyError(actions.error)}</p>}
      {/* Uma página seguinte que falha deixa a consulta em erro, mas as linhas já lidas ficam. */}
      {actions.data && (
        <div ref={listRef} tabIndex={-1} aria-label="Ações da matrícula">
          <DataTable<PsyActionRow> cols={cols} rows={rows} rowKey={(r) => r.id} empty={NO_ACTIONS} rowStyle={(r) => (r.cancelled ? struck : undefined)} />
        </div>
      )}
      {actions.hasNextPage && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} disabled={actions.isFetchingNextPage} onClick={() => void actions.fetchNextPage()}>
            Carregar mais
          </button>
        </div>
      )}
    </div>
  );
}
