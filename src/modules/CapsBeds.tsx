// Módulo 31 — F-31.5: mapa dos leitos, entrada, saída, limite e reavaliação (Task 10; §5, P41). Só CAPS III, AD III e AD IV (portão
// "beds", `night_capable`). O mapa (`GET /beds/board`, no dia escolhido; padrão hoje na cidade) é um cartão por leito ativo: rótulo e
// "livre", ou "<nome> · N de M noites em <janela> dias" (no CAPS III, as intercaladas), com entrada e saída prevista. Só `<patient-ref>`
// e datas, campo a campo: nada clínico, nada de trilha. O mapa traz nomes: sem cache (`NOMINAL_QUERY`), relido depois de cada escrita e
// quando o api diz que estava velho (`bed_taken`, `already_staying`, `already_closed`). O detalhe da permanência (com trilha
// `night_stay`) só no clique "Ver permanência", com o id do CAPS na chave. Nada daqui avisa o usuário (decisão 4).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPsyBedBoard, getPsyNightStay, type PsyBoardItem, type PsyUnit } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtDay } from "../lib/careLines";
import { fmtDateTime } from "../lib/format";
import {
  BED_FREE, INACTIVE_BEDS_NOTE, NIGHT_STAY_CLOSED, NIGHT_STAY_STARTED, NOMINAL_QUERY, NO_ACTIVE_BEDS, NO_CLINICAL_IN_LIST, NO_REASSESSMENT, PSY_BEDS_KEY,
  PSY_DETAIL_KEY, REASSESSMENT_NOT_NEEDED, TRAIL_NOTE, bedNearLimit, bedStayText, psyError, type PsyRoles
} from "../lib/psychosocial";
import { EmptyState } from "../components/EmptyState";
import { KeyValue } from "../components/KeyValue";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, muted, okText, row, stack, title } from "./exams/styles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";
import { NightStayForm } from "./psychosocial/NightStayForm";
import { CloseNightStay } from "./psychosocial/CloseNightStay";

export type CapsBedsProps = { today?: string; now?: Date };

export function CapsBeds(props: CapsBedsProps) {
  return (
    <PsychosocialGate title="Leitos" sub="Acolhimento noturno: leitos, entrada e saída" unit="beds" allow={(r) => r.staff}>
      {({ roles, unit }) => (unit ? <Beds unit={unit} roles={roles} {...props} /> : null)}
    </PsychosocialGate>
  );
}

type Occupied = PsyBoardItem & { stay: NonNullable<PsyBoardItem["stay"]> };
type Open = { kind: "enter"; item: PsyBoardItem } | { kind: "close"; item: Occupied } | { kind: "detail"; item: Occupied };
type Notice = { text: string; ok: boolean };

const cards = { display: "flex", flexWrap: "wrap", gap: 12 } as const;
const card = { ...box, flex: "1 1 240px", minWidth: 0 } as const;

function Beds({ unit, roles, today, now }: CapsBedsProps & { unit: PsyUnit; roles: PsyRoles }) {
  const queryClient = useQueryClient();
  const [ date, setDate ] = useState(() => today ?? todayInCity(now ?? new Date()));
  const [ open, setOpen ] = useState<Open | null>(null);
  const [ notice, setNotice ] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);

  const board = useQuery({ queryKey: [ PSY_BEDS_KEY, unit.id, date ], queryFn: () => getPsyBedBoard(unit.id, date), ...NOMINAL_QUERY });
  const reload = () => { void queryClient.invalidateQueries({ queryKey: [ PSY_BEDS_KEY, unit.id ] }); };
  const finish = (text: string, ok: boolean) => { setOpen(null); setNotice({ text, ok }); reload(); };
  const start = (o: Open) => { setNotice(null); setOpen(o); };

  const items = board.data?.items ?? [];
  const active = items.filter((i) => i.bed.active);
  const inactive = items.filter((i) => !i.bed.active);
  const staying = new Set(items.flatMap((i) => (i.stay ? [ i.stay.patient.patient_id ] : [])));
  const windowDays = board.data?.window_days ?? 30;

  return (
    <div style={stack}>
      {notice && <p ref={noticeRef} tabIndex={-1} role={notice.ok ? "status" : "alert"} style={notice.ok ? okText : alert}>{notice.text}</p>}
      <div style={row}>
        <label style={fieldLabel}>
          Data do mapa
          <input type="date" value={date} style={inputStyle} onChange={(ev) => { if (ev.target.value) setDate(ev.target.value); }} />
        </label>
      </div>
      {open?.kind === "enter" && (
        <div style={box}>
          <NightStayForm unit={unit} bed={open.item.bed} roles={roles} now={now} staying={staying} onConflict={reload}
            onSaved={(_s, ignored) => finish(ignored ? `${NIGHT_STAY_STARTED} ${REASSESSMENT_NOT_NEEDED}` : NIGHT_STAY_STARTED, true)}
            onCancel={() => setOpen(null)} />
        </div>
      )}
      {open?.kind === "close" && (
        <div style={box}>
          <CloseNightStay stay={open.item.stay} bedLabel={open.item.bed.label} roles={roles} now={now}
            onSaved={(_s, ignored) => finish(ignored ? `${NIGHT_STAY_CLOSED} ${REASSESSMENT_NOT_NEEDED}` : NIGHT_STAY_CLOSED, true)}
            onStale={(text) => finish(text, false)} onCancel={() => setOpen(null)} />
        </div>
      )}
      {open?.kind === "detail" && <StayDetail unit={unit} item={open.item} onClose={() => setOpen(null)} />}
      {board.isPending ? <p className="mono" style={muted}>carregando…</p>
        : board.isError ? <p role="alert" style={alert}>{psyError(board.error)}</p>
        : (
          <>
            <Panel title="Leitos" sub={`Noites contadas em qualquer janela de ${windowDays} dias`}>
              <div style={stack}>
                <p style={muted}>{NO_CLINICAL_IN_LIST}</p>
                {active.length === 0 ? <EmptyState title={NO_ACTIVE_BEDS} /> : (
                  <div style={cards}>
                    {active.map((item) => (
                      <BedCard key={item.bed.id} item={item} unit={unit} windowDays={windowDays}
                        onEnter={() => start({ kind: "enter", item })}
                        onClose={(o) => start({ kind: "close", item: o })}
                        onDetail={(o) => start({ kind: "detail", item: o })} />
                    ))}
                  </div>
                )}
              </div>
            </Panel>
            {inactive.length > 0 && (
              <Panel title="Leitos inativos">
                <div style={stack}>
                  <p style={muted}>{INACTIVE_BEDS_NOTE}</p>
                  <div style={cards}>
                    {inactive.map((item) => (
                      <section key={item.bed.id} aria-label={item.bed.label} style={card}>
                        <p style={title}>{item.bed.label}</p>
                        <div style={row}><Tag tone="neutral">inativo</Tag></div>
                      </section>
                    ))}
                  </div>
                </div>
              </Panel>
            )}
          </>
        )}
    </div>
  );
}

function BedCard({ item, unit, windowDays, onEnter, onClose, onDetail }: {
  item: PsyBoardItem; unit: PsyUnit; windowDays: number; onEnter(): void; onClose(o: Occupied): void; onDetail(o: Occupied): void;
}) {
  const { bed, stay } = item;
  return (
    <section aria-label={bed.label} style={card}>
      <p style={title}>{bed.label}</p>
      {!stay ? (
        <>
          <div style={row}><Tag tone="ok">{BED_FREE}</Tag></div>
          <div style={row}>
            <button type="button" style={buttonStyle} aria-label={`Registrar entrada no ${bed.label}`} onClick={onEnter}>Registrar entrada</button>
          </div>
        </>
      ) : (
        <>
          <div style={row}>
            <Tag tone={bedNearLimit(item.nights_used, item.limit) ? "warn" : "info"}>
              {bedStayText(stay.patient.name, item.nights_used, item.limit, windowDays, unit.caps_modality)}
            </Tag>
          </div>
          <p style={muted}>{`Entrada ${fmtDateTime(stay.started_at)} · saída prevista ${fmtDateTime(stay.expected_end_at)}`}</p>
          <div style={row}>
            <button type="button" style={buttonStyle} aria-label={`Registrar saída de ${stay.patient.name}`}
              onClick={() => onClose({ ...item, stay })}>Registrar saída</button>
            <button type="button" style={secondaryButtonStyle} aria-label={`Ver permanência de ${stay.patient.name}`}
              onClick={() => onDetail({ ...item, stay })}>Ver permanência</button>
          </div>
        </>
      )}
    </section>
  );
}

// Detalhe nominal (trilha `night_stay` no api): só depois do clique, sem cache, com o id do CAPS na chave.
function StayDetail({ unit, item, onClose }: { unit: PsyUnit; item: Occupied; onClose(): void }) {
  const detail = useQuery({
    queryKey: [ PSY_DETAIL_KEY, unit.id, "nightStay", item.stay.id ], queryFn: () => getPsyNightStay(item.stay.id), ...NOMINAL_QUERY
  });
  const titleRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const s = detail.data;
  const nights = s ? `${s.nights.length} ${s.nights.length === 1 ? "noite" : "noites"}` : "";
  return (
    <section aria-label={`Permanência de ${item.stay.patient.name}`} style={box}>
      <p ref={titleRef} tabIndex={-1} style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{`Permanência de ${item.stay.patient.name} · ${item.bed.label}`}</p>
      <p style={muted}>{TRAIL_NOTE}</p>
      {detail.isPending ? <p className="mono" style={muted}>carregando…</p>
        : detail.isError ? <p role="alert" style={alert}>{psyError(detail.error)}</p>
        : s && (
          <div style={stack}>
            <div style={{ ...row, gap: 24, alignItems: "flex-start" }}>
              <KeyValue k="Usuário" v={s.patient.name} mono={false} />
              {s.patient.cns_masked && <KeyValue k="CNS" v={s.patient.cns_masked} />}
              <KeyValue k="Leito" v={s.bed.label} mono={false} />
              <KeyValue k="Entrada" v={fmtDateTime(s.started_at)} />
              <KeyValue k="Saída prevista" v={fmtDateTime(s.expected_end_at)} />
              {s.ended_at && <KeyValue k="Saída" v={fmtDateTime(s.ended_at)} />}
              <KeyValue k="Registrou a entrada" v={s.started_by.name} mono={false} />
            </div>
            <div style={stack}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>Noites</p>
              <p style={muted}>{nights}</p>
              {s.nights.length > 0 && <p style={muted}>{s.nights.map((n) => fmtDay(n)).join(" · ")}</p>}
            </div>
            <div style={stack}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>Reavaliação do limite</p>
              {s.reassessment ? (
                <>
                  <p style={{ margin: 0, fontSize: 12.5, whiteSpace: "pre-wrap" }}>{s.reassessment.reason}</p>
                  <p style={muted}>{s.reassessment.by.name}</p>
                </>
              ) : <p style={muted}>{NO_REASSESSMENT}</p>}
            </div>
          </div>
        )}
      <div style={row}>
        <button type="button" style={secondaryButtonStyle} aria-label="Fechar detalhe" onClick={onClose}>Fechar</button>
      </div>
    </section>
  );
}
