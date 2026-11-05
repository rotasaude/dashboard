// Módulo 31 — F-31.2: "Acolhimento". A fila de encaminhamentos da UBS (`GET /psychosocial/referrals`, 100 por página, `{items,
// next_before}` com "Carregar mais") nunca traz o motivo: paciente, UBS de origem, prioridade e quando. O motivo só aparece no detalhe,
// lido no clique (`GET /psychosocial/referrals/:id`, o api grava a trilha), com `NOMINAL_QUERY` e o id do CAPS na chave; "Fechar"
// desmonta e apaga a chave. Encaminhamento anonimizado não vem na lista e dá 404 no detalhe (P54): fecha e relê a fila. "Acolher"
// abre o acolhimento com ou sem matrícula; "Acolher demanda espontânea" busca a pessoa por CPF, CNS ou duplicados (POST). Depois de
// acolher, a fila é relida; com matrícula, "Abrir matrícula" leva a "Usuários do CAPS".
import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { getPsyOptions, getPsyReferral, listPsyReferrals, type PsyReceptionResult, type PsyReferralRow, type PsyUnit } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDateTime } from "../lib/format";
import {
  NOMINAL_QUERY, NO_CLINICAL_IN_LIST, PSY_DETAIL_KEY, PSY_OPTIONS_KEY, PSY_REFERRALS_KEY, RECEPTION_DONE, RECEPTION_ENROLLED, STATIC_QUERY,
  TRAIL_NOTE, isStale, priorityLabel, psyError
} from "../lib/psychosocial";
import { DataTable, type Column } from "../components/DataTable";
import { KeyValue } from "../components/KeyValue";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, disabledButtonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, grid, muted, okText, row, stack } from "./exams/styles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";
import { PsyPersonPick } from "./psychosocial/PsyPersonPick";
import { ReceptionForm } from "./psychosocial/ReceptionForm";

export type CapsReceptionProps = { today?: string; now?: Date; onGoToSecurity?: () => void; onOpenEnrollment?(id: string): void };

export function CapsReception(props: CapsReceptionProps) {
  return (
    <PsychosocialGate title="Acolhimento" sub="Encaminhamentos da UBS e demanda espontânea" allow={(r) => r.staff}>
      {({ unit }) => (unit ? <Reception unit={unit} {...props} /> : null)}
    </PsychosocialGate>
  );
}

type Target = { patientId: string; name: string; referralId: string | null };

function Reception({ unit, today = todayInCity(), now = new Date(), onOpenEnrollment }: CapsReceptionProps & { unit: PsyUnit }) {
  const queryClient = useQueryClient();
  const [ openId, setOpenId ] = useState<string | null>(null);
  const [ picking, setPicking ] = useState(false);
  const [ target, setTarget ] = useState<Target | null>(null);
  const [ done, setDone ] = useState<{ text: string; enrollmentId: string | null } | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement | null>(null);

  const listKey = [ PSY_REFERRALS_KEY, unit.id ];
  const list = useInfiniteQuery({
    queryKey: listKey,
    queryFn: ({ pageParam }) => listPsyReferrals(unit.id, { before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const options = useQuery({ queryKey: [ PSY_OPTIONS_KEY, unit.id ], queryFn: () => getPsyOptions(unit.id), ...STATIC_QUERY });
  const reload = () => { void queryClient.resetQueries({ queryKey: listKey }); };

  useEffect(() => { if (done) doneRef.current?.focus(); }, [ done ]);

  const begin = () => { setDone(null); setNotice(null); };
  const closeDetail = () => {
    setOpenId(null);
    queryClient.removeQueries({ queryKey: [ PSY_DETAIL_KEY, unit.id, "referral" ] });
  };
  const open = (id: string) => { begin(); setTarget(null); setPicking(false); closeDetail(); setOpenId(id); };
  const receive = (t: Target) => { begin(); closeDetail(); setPicking(false); setTarget(t); };
  const stale = (text: string) => { setTarget(null); closeDetail(); setNotice(text); reload(); };
  const finished = (r: PsyReceptionResult) => {
    setTarget(null);
    setDone({ text: r.enrollment_id ? RECEPTION_ENROLLED : RECEPTION_DONE, enrollmentId: r.enrollment_id });
    reload();
  };

  const nameOf = (r: PsyReferralRow) => r.patient.name;
  const cols: Column<PsyReferralRow>[] = [
    { label: "Paciente", w: "1.4fr", card: "title", render: nameOf },
    { label: "De", w: "1fr", render: (r) => r.from_unit.name },
    { label: "Prioridade", w: "auto", render: (r) => <Tag tone={r.priority === "priority" ? "warn" : "neutral"}>{priorityLabel(r.priority)}</Tag> },
    { label: "Quando", w: "1fr", render: (r) => fmtDateTime(r.created_at) },
    {
      label: "Ações", w: "auto", card: "actions", render: (r) => (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} aria-label={`Abrir encaminhamento de ${nameOf(r)}`} onClick={() => open(r.id)}>
            Abrir
          </button>
          <button type="button" style={buttonStyle} aria-label={`Acolher ${nameOf(r)}`}
            onClick={() => receive({ patientId: r.patient.patient_id, name: nameOf(r), referralId: r.id })}>
            Acolher
          </button>
        </div>
      )
    }
  ];
  const rows = (list.data?.pages ?? []).flatMap((p) => p.items).filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i);

  return (
    <div style={stack}>
      {notice && <p role="alert" style={alert}>{notice}</p>}
      {done && (
        <div style={row}>
          <p ref={doneRef} tabIndex={-1} role="status" style={okText}>{done.text}</p>
          {done.enrollmentId && onOpenEnrollment && (
            <button type="button" style={secondaryButtonStyle} onClick={() => onOpenEnrollment(done.enrollmentId as string)}>Abrir matrícula</button>
          )}
        </div>
      )}
      {options.isError && <p role="alert" style={alert}>{psyError(options.error)}</p>}

      {target && (
        <Panel title="Acolhimento">
          {!options.data ? (options.isPending && <p style={muted}>carregando…</p>) : <ReceptionForm key={`${target.referralId ?? "spontaneous"}-${target.patientId}`} unit={unit}
            patient={{ patientId: target.patientId, name: target.name }} referralId={target.referralId} options={options.data} today={today} now={now}
            onDone={finished} onCancel={() => setTarget(null)} onStale={stale} />}
        </Panel>
      )}

      {openId && <ReferralDetail unitId={unit.id} id={openId} onClose={closeDetail} onStale={stale} />}

      {!target && (
        <Panel title="Demanda espontânea">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {picking ? (
              <PsyPersonPick onPick={(patientId, name) => receive({ patientId, name, referralId: null })} onCancel={() => setPicking(false)} />
            ) : (
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={() => { begin(); closeDetail(); setPicking(true); }}>
                  Acolher demanda espontânea
                </button>
              </div>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Fila de encaminhamentos">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={muted}>{NO_CLINICAL_IN_LIST}</p>
          <p style={muted}>{TRAIL_NOTE}</p>
          {list.isError ? <p role="alert" style={alert}>{psyError(list.error)}</p> : (
            <DataTable<PsyReferralRow> cols={cols} rows={rows} rowKey={(r) => r.id}
              empty={list.isPending ? "carregando…" : "nenhum encaminhamento aguardando acolhimento"} />
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

// O detalhe nominal: só montado depois do clique; sem cache (NOMINAL_QUERY) e com o id do CAPS na chave.
function ReferralDetail({ unitId, id, onClose, onStale }: { unitId: string; id: string; onClose(): void; onStale(text: string): void }) {
  const detail = useQuery({ queryKey: [ PSY_DETAIL_KEY, unitId, "referral", id ], queryFn: () => getPsyReferral(id), ...NOMINAL_QUERY });
  const heading = useRef<HTMLParagraphElement | null>(null);
  const r = detail.data;
  useEffect(() => { if (r) heading.current?.focus(); }, [ r ]);
  useEffect(() => {
    if (detail.isError && isStale(detail.error)) onStale(psyError(detail.error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ detail.isError, detail.error ]);

  return (
    <Panel title="Encaminhamento">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {detail.isPending && <p style={muted}>carregando…</p>}
        {detail.isError && <p role="alert" style={alert}>{psyError(detail.error)}</p>}
        {r && (
          <>
            <p ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{r.patient.name}</p>
            <div style={grid}>
              <KeyValue k="De" v={r.from_unit.name} mono={false} />
              <KeyValue k="Quem encaminhou" v={r.referred_by.name} mono={false} />
              <KeyValue k="Prioridade" v={priorityLabel(r.priority)} mono={false} />
              <KeyValue k="Quando" v={fmtDateTime(r.created_at)} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={muted}>Motivo</span>
              <p style={{ margin: 0, fontSize: 13, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.reason}</p>
            </div>
          </>
        )}
        <div style={row}><button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button></div>
      </div>
    </Panel>
  );
}
