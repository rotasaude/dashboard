// Módulo 31 — F-31.7: matriciamento e casos compartilhados (Task 12; §7, P4, P12, P44, R8, R13). A lista (`GET
// /psychosocial/matrix_supports`, 200 por página, `{items, next_before}`, a mais nova primeiro, "Carregar mais") não traz o tema nem
// o texto compartilhado: só data, equipe da UBS ("equipe · unidade", a unidade vem de `options.health_teams`), profissionais, o
// procedimento, a contagem de casos e a situação (cancelado quando a ação do BPA-C foi cancelada). Cada linha é copiada campo a
// campo, de modo que um campo clínico enviado por engano nem chega ao cache. O detalhe (tema e casos com nome e texto) só abre no
// clique, com `NOMINAL_QUERY` e o id do CAPS na chave, e sai do cache ao fechar (o api grava a trilha `matrix_support` por paciente).
// "Adicionar caso" não aparece no matriciamento cancelado (409 `already_cancelled`, P44). O nome do CAPS não é citado nas frases.
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getPsyMatrixSupport, getPsyOptions, listPsyMatrixSupports, type PsyMatrixSupportRow, type PsyOptions, type PsyPage, type PsyUnit } from "../lib/api";
import { fmtDay } from "../lib/careLines";
import { fmtDateTime } from "../lib/format";
import {
  CASE_SAVED, MATRIX_CANCELLED_NOTE, MATRIX_LIST_NOTE, MATRIX_READ_NOTE, MATRIX_SAVED, NOMINAL_QUERY, NO_MATRIX_CASES, NO_MATRIX_SUPPORTS, PSY_DETAIL_KEY,
  PSY_MATRIX_KEY, PSY_OPTIONS_KEY, STATIC_QUERY, TRAIL_NOTE, isStale, matrixTeamLabel, psyError
} from "../lib/psychosocial";
import { DataTable, type Column } from "../components/DataTable";
import { KeyValue } from "../components/KeyValue";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, grid, muted, okText, row, stack } from "./exams/styles";
import { MatrixCaseForm } from "./psychosocial/MatrixCaseForm";
import { MatrixForm } from "./psychosocial/MatrixForm";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsMatrixProps = { today?: string; now?: Date };

export function CapsMatrix(props: CapsMatrixProps) {
  return (
    <PsychosocialGate title="Matriciamento" sub="Apoio às equipes da UBS e casos compartilhados" allow={(r) => r.staff}>
      {({ unit }) => (unit ? <Matrix unit={unit} {...props} /> : null)}
    </PsychosocialGate>
  );
}

// Só os campos da linha (sem tema, sem texto compartilhado, sem nada clínico).
const rowOf = (r: PsyMatrixSupportRow): PsyMatrixSupportRow => ({
  id: r.id, health_unit_id: r.health_unit_id,
  health_team: { id: r.health_team.id, name: r.health_team.name, ine: r.health_team.ine ?? null, health_unit_id: r.health_team.health_unit_id },
  held_on: r.held_on,
  participants: r.participants.map((p) => ({ user_id: p.user_id, name: p.name, cbo_code: p.cbo_code ?? null })),
  sigtap: { code: r.sigtap.code, name: r.sigtap.name, instrument: r.sigtap.instrument },
  action_id: r.action_id ?? null, action_cancelled_at: r.action_cancelled_at ?? null, cases_count: r.cases_count, created_at: r.created_at
});

const statusTag = (cancelled: boolean) => (cancelled ? <Tag tone="down">cancelado</Tag> : <Tag tone="ok">registrado</Tag>);

function Matrix({ unit, today, now }: CapsMatrixProps & { unit: PsyUnit }) {
  const queryClient = useQueryClient();
  const listKey = [ PSY_MATRIX_KEY, unit.id ];
  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: async ({ pageParam }): Promise<PsyPage<PsyMatrixSupportRow>> => {
      const page = await listPsyMatrixSupports(unit.id, pageParam);
      return { items: page.items.map(rowOf), next_before: page.next_before };
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const options = useQuery({ queryKey: [ PSY_OPTIONS_KEY, unit.id ], queryFn: () => getPsyOptions(unit.id), ...STATIC_QUERY });
  const [ creating, setCreating ] = useState(false);
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ done, setDone ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  // "Fechar" devolve o foco ao "Abrir" de origem; sem ele, à lista.
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
    if (!list.isFetchNextPageError || errorCode(list.error) !== "invalid_cursor") return;
    setNotice(psyError(list.error));
    void queryClient.resetQueries({ queryKey: listKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ list.isFetchNextPageError, list.error ]);

  const reload = () => { void queryClient.resetQueries({ queryKey: listKey }); };
  const closeDetail = () => {
    setOpenId(null);
    queryClient.removeQueries({ queryKey: [ PSY_DETAIL_KEY, unit.id, "matrix" ] });
  };
  const begin = () => { setDone(null); setNotice(null); };
  const open = (id: string, from: HTMLElement) => { begin(); closeDetail(); opener.current = from; setOpenId(id); };
  const close = () => { closeDetail(); setRefocus((n) => n + 1); };
  const stale = (text: string) => { closeDetail(); setNotice(text); reload(); };

  const rows = (list.data?.pages.flatMap((p) => p.items) ?? []).filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);
  const teams = options.data?.health_teams ?? [];
  const when = (r: PsyMatrixSupportRow) => fmtDay(r.held_on);
  const cols: Column<PsyMatrixSupportRow>[] = [
    { label: "Data", w: "auto", card: "title", render: when },
    { label: "Equipe da UBS", w: "1.4fr", render: (r) => matrixTeamLabel(r.health_team, teams) },
    { label: "Profissionais do CAPS", w: "1.4fr", render: (r) => r.participants.map((p) => p.name).join(", ") },
    { label: "Procedimento", w: "1.4fr", render: (r) => <span title={r.sigtap.code}>{r.sigtap.name || r.sigtap.code}</span> },
    { label: "Casos", w: "auto", render: (r) => String(r.cases_count) },
    { label: "Situação", w: "auto", render: (r) => statusTag(r.action_cancelled_at !== null) },
    { label: "Ações", w: "auto", card: "actions", render: (r) => (
      <button type="button" style={secondaryButtonStyle} aria-label={`Abrir matriciamento de ${when(r)}`} onClick={(ev) => open(r.id, ev.currentTarget)}>Abrir</button>
    ) }
  ];

  return (
    <div style={stack}>
      {notice && <p ref={noticeRef} tabIndex={-1} role="alert" style={alert}>{notice}</p>}
      {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
      {options.isError && <p role="alert" style={alert}>{psyError(options.error)}</p>}

      {creating ? (
        <Panel title="Registrar matriciamento">
          {!options.data ? (options.isPending && <p className="mono" style={muted}>carregando…</p>) : (
            <MatrixForm unit={unit} options={options.data} today={today} now={now} onCancel={() => setCreating(false)}
              onSaved={() => { setCreating(false); setDone(MATRIX_SAVED); reload(); }} />
          )}
        </Panel>
      ) : (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => { begin(); setCreating(true); }}>Registrar matriciamento</button>
        </div>
      )}

      {openId && <MatrixDetail key={openId} unit={unit} id={openId} options={options.data} onClose={close} onChanged={reload} onStale={stale} />}

      <Panel title="Matriciamentos">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={muted}>{MATRIX_LIST_NOTE}</p>
          <p style={muted}>{TRAIL_NOTE}</p>
          {list.isPending && <p className="mono" style={muted}>carregando…</p>}
          {list.isError && <p role="alert" style={alert}>{psyError(list.error)}</p>}
          {/* Uma página seguinte que falha deixa a consulta em erro, mas as linhas já lidas ficam. */}
          {list.data && (
            <div ref={listRef} tabIndex={-1} role="region" aria-label="Lista de matriciamentos">
              <DataTable<PsyMatrixSupportRow> cols={cols} rows={rows} rowKey={(r) => r.id} empty={NO_MATRIX_SUPPORTS} />
            </div>
          )}
          {list.hasNextPage && (
            <div style={row}>
              <button type="button" style={list.isFetchingNextPage ? disabledButtonStyle : secondaryButtonStyle} disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
              </button>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

// O detalhe nominal: só montado depois do clique; sem cache (`NOMINAL_QUERY`) e com o id do CAPS na chave.
function MatrixDetail({ unit, id, options, onClose, onChanged, onStale }: {
  unit: PsyUnit; id: string; options: PsyOptions | undefined; onClose(): void; onChanged(): void; onStale(text: string): void;
}) {
  const queryClient = useQueryClient();
  const key = [ PSY_DETAIL_KEY, unit.id, "matrix", id ];
  const detail = useQuery({ queryKey: key, queryFn: () => getPsyMatrixSupport(id), ...NOMINAL_QUERY });
  const [ adding, setAdding ] = useState(false);
  const [ done, setDone ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const heading = useRef<HTMLParagraphElement | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  const focused = useRef(false);
  const s = detail.data;

  useEffect(() => {
    if (!s || focused.current) return;
    focused.current = true;
    heading.current?.focus();
  }, [ s ]);
  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);
  useEffect(() => {
    if (detail.isError && isStale(detail.error)) onStale(psyError(detail.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ detail.isError, detail.error ]);

  const refresh = () => { void queryClient.invalidateQueries({ queryKey: key }); onChanged(); };
  const cancelled = s ? s.action_cancelled_at !== null : false;

  return (
    <Panel title="Matriciamento">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {detail.isPending && <p className="mono" style={muted}>carregando…</p>}
        {detail.isError && <p role="alert" style={alert}>{psyError(detail.error)}</p>}
        {notice && <p ref={noticeRef} tabIndex={-1} role="alert" style={alert}>{notice}</p>}
        {done && <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done}</p>}
        {s && (
          <>
            <div style={row}>
              <p ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{`Matriciamento de ${fmtDay(s.held_on)}`}</p>
              {statusTag(cancelled)}
            </div>
            <div style={grid}>
              <KeyValue k="Equipe da UBS" v={matrixTeamLabel(s.health_team, options?.health_teams ?? [])} mono={false} />
              <KeyValue k="Procedimento" v={s.sigtap.name ? `${s.sigtap.code} · ${s.sigtap.name}` : s.sigtap.code} mono={false} />
              <KeyValue k="Profissionais do CAPS" v={s.participants.map((p) => p.name).join(", ")} mono={false} />
              <KeyValue k="Registrado em" v={fmtDateTime(s.created_at)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>Tema</span>
              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.topic}</p>
            </div>
            {cancelled && <p role="status" style={muted}>{MATRIX_CANCELLED_NOTE}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={muted}>Casos compartilhados</span>
              <p style={muted}>{MATRIX_READ_NOTE}</p>
              {s.cases.length === 0 ? <p style={muted}>{NO_MATRIX_CASES}</p> : s.cases.map((c) => (
                <div key={c.id} style={box}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{c.patient.name}</span>
                  <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.shared_text}</p>
                </div>
              ))}
            </div>
            {adding && (
              <MatrixCaseForm support={s}
                onCancel={() => setAdding(false)}
                onSaved={() => { setAdding(false); setNotice(null); setDone(CASE_SAVED); refresh(); }}
                onCancelled={() => { setAdding(false); setDone(null); setNotice(MATRIX_CANCELLED_NOTE); refresh(); }}
                onStale={onStale} />
            )}
            {!adding && !cancelled && (
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={() => { setDone(null); setNotice(null); setAdding(true); }}>Adicionar caso</button>
              </div>
            )}
          </>
        )}
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button></div>
      </div>
    </Panel>
  );
}
