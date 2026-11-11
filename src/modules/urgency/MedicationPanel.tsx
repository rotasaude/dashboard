// Aprazamento e checagem da medicação (módulo 32b, F-32.8; ADR 0050; api-shapes §3–§5): o painel da enfermagem, do técnico 3222 e do
// médico, aberto pela fila, pelo mapa da observação ou pelo atendimento. Não lê o detalhe do encontro.
// - A leitura do aprazamento grava trilha (recurso `medication_schedule`): só ao abrir, depois de uma checagem ou em "Atualizar";
//   sem polling, sem releitura por foco ou reconexão (NOMINAL_QUERY), e sai do cache ao fechar.
// - Horários por texto (nunca só cor): feito, "pendente desde", "agora" e "a seguir"; "Checar" só até 60 min à frente (canCheck).
// - "Se necessário" não tem horário: mostra quantas doses ainda cabem nas últimas 24 h.
// - Escape fora dos campos fecha; o foco vai ao título ao abrir e volta a quem abriu ao fechar.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMedicationSchedule, type ScheduleItem, type UrgencyAdministration, type UrgencyAdministrationResult } from "../../lib/api";
import { ROUTE_LABEL } from "../../lib/clinicalDocuments";
import { fmtHourMinute } from "../../lib/format";
import { NOMINAL_QUERY, URGENCY_ERRORS, urgencyError } from "../../lib/urgency";
import {
  MEDICATION_SCHEDULE_KEY, adminStatusLabel, canCheck, frequencyText, shortfallCauseLabel, slotState, CHECK_IMMUTABLE
} from "../../lib/urgencyObservation";
import { useReveal } from "../../lib/useReveal";
import { ActionButton } from "../../components/ActionButton";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { AdministrationForm } from "./AdministrationForm";
import type { MedicationTarget } from "./ObservationMap";
import { controlledText } from "./PrescriptionItemFields";

export const NO_ACTIVE_SCHEDULE = "Sem prescrição ativa — a prescrição é do médico";
export const CHECK_RECORDED = "Checagem registrada.";
export const UNNAMED_CHECKER = "profissional sem nome registrado";
export const shortfallNotice = (cause: string): string =>
  `${CHECK_RECORDED} O estoque ficou com pendência para a farmácia (${shortfallCauseLabel(cause)}).`;

export interface MedicationPanelProps {
  target: MedicationTarget;
  // O relógio da tela (testes); sem ele, o momento de cada desenho.
  now?: Date;
  onClose(): void;
  // 409 encounter_closed: quem monta fecha o painel e relê a fila e o mapa.
  onEncounterClosed(): void;
}

// Escape dentro de um campo não fecha nada.
const inField = (el: EventTarget) => el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
const DAY_MS = 24 * 60 * 60_000;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const when = (a: UrgencyAdministration) => a.administered_at ?? a.recorded_at;
const who = (a: UrgencyAdministration) => a.by.name ?? UNNAMED_CHECKER;

type Open = { itemId: string; slot: string | null };
type Notice = { kind: "status" | "alert"; text: string };

export function MedicationPanel({ target, now: nowProp, onClose, onEncounterClosed }: MedicationPanelProps) {
  const queryClient = useQueryClient();
  const ref = useReveal<HTMLDivElement>(true);
  // Quem abriu (lido antes de o foco ir ao título): recebe o foco de volta ao fechar.
  const [ opener ] = useState<Element | null>(() => document.activeElement);
  const key = [ MEDICATION_SCHEDULE_KEY, target.encounterId ];
  const query = useQuery({ queryKey: key, queryFn: () => getMedicationSchedule(target.encounterId), ...NOMINAL_QUERY });
  // Sai do cache ao fechar (o aprazamento é nominal).
  useEffect(() => () => { queryClient.removeQueries({ queryKey: [ MEDICATION_SCHEDULE_KEY, target.encounterId ] }); }, [ queryClient, target.encounterId ]);
  const [ open, setOpen ] = useState<Open | null>(null);
  const [ notice, setNotice ] = useState<Notice | null>(null);
  // Checagens desta sessão que ficaram com falta de estoque (o aprazamento relido não diz isso).
  const [ pending, setPending ] = useState<ReadonlySet<string>>(new Set());
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  useEffect(() => { if (notice) noticeRef.current?.focus(); }, [ notice ]);

  const close = () => {
    onClose();
    if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
  };
  const reload = () => { void query.refetch(); };
  const recorded = (r: UrgencyAdministrationResult) => {
    setOpen(null);
    if (r.shortfall) {
      setPending((p) => new Set(p).add(r.administration.id));
      setNotice({ kind: "status", text: shortfallNotice(r.shortfall.cause) });
    } else setNotice({ kind: "status", text: CHECK_RECORDED });
    reload();
  };
  const stale = (text: string) => { setNotice({ kind: "alert", text }); reload(); };

  const data = query.data;
  const now = nowProp ?? new Date();
  const read = query.dataUpdatedAt > 0 ? fmtHourMinute(new Date(query.dataUpdatedAt).toISOString()) : null;

  // O formulário aberto só vale enquanto o horário (ou a dose avulsa) ainda puder ser checado na tela relida.
  const openItem = open && data ? data.items.find((i) => i.item_id === open.itemId) : undefined;
  const openValid = !!open && !!openItem && (open.slot === null
    ? openItem.frequency.kind === "if_needed" && openItem.remaining !== 0
    : openItem.slots.some((s) => s.scheduled_at === open.slot && canCheck(s, now)));

  // O horário que deixou de poder ser checado (outra pessoa checou, a versão mudou) fecha o formulário de vez.
  useEffect(() => { if (open && data && !openValid) setOpen(null); }, [ open, data, openValid ]);

  return (
    <div ref={ref} onKeyDown={(e) => { if (e.key === "Escape" && !inField(e.target)) { e.stopPropagation(); close(); } }}>
      <Panel title={`Medicação — ${target.ticket ?? "sem senha"}`} sub="aprazamento das próximas 24 h · a checagem não pode ser alterada"
        right={<button type="button" style={secondaryButtonStyle} onClick={close}>Fechar</button>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={muted}>{target.patientName}</p>
          {notice && <p ref={noticeRef} tabIndex={-1} role={notice.kind} style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: notice.kind === "alert" ? "var(--down)" : undefined }}>{notice.text}</p>}
          {query.isPending && <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>}
          {query.isError && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{urgencyError(query.error)}</p>}
          {data && data.prescription_id === null && <p style={muted}>{NO_ACTIVE_SCHEDULE}</p>}
          {data && data.items.map((it) => (
            <ItemSection key={it.item_id} item={it} now={now} pending={pending} stockDeduction={data.stock_deduction}
              open={openValid && open?.itemId === it.item_id ? open : null}
              onOpen={(slot) => { setNotice(null); setOpen({ itemId: it.item_id, slot }); }}
              onCancel={() => setOpen(null)} onRecorded={recorded} onStale={stale} onEncounterClosed={onEncounterClosed} />
          ))}
          {data && <p style={muted}>{CHECK_IMMUTABLE}</p>}
          <footer style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            {read && <span className="mono" style={{ fontSize: 10.5, color: "var(--ink3)" }}>{`lido às ${read}`}</span>}
            <ActionButton variant="secondary" busy={query.isFetching} onClick={() => { setNotice(null); return query.refetch().then(() => undefined); }}>Atualizar</ActionButton>
          </footer>
        </div>
      </Panel>
    </div>
  );
}

interface ItemProps {
  item: ScheduleItem; now: Date; pending: ReadonlySet<string>; stockDeduction: boolean; open: Open | null;
  onOpen(slot: string | null): void; onCancel(): void; onRecorded(r: UrgencyAdministrationResult): void;
  onStale(text: string): void; onEncounterClosed(): void;
}

function ItemSection({ item, now, pending, stockDeduction, open, onOpen, onCancel, onRecorded, onStale, onEncounterClosed }: ItemProps) {
  const label = item.catalog_item?.name ?? "medicamento fora do catálogo";
  const marks = item.controlled ? controlledText(item.controlled_list) : null;
  const route = Object.prototype.hasOwnProperty.call(ROUTE_LABEL, item.route) ? ROUTE_LABEL[item.route] : item.route;
  const asNeeded = item.frequency.kind === "if_needed";
  const last = item.last_administration;
  // A última dose de outra versão da prescrição: não está entre os horários nem entre as recentes desta.
  const known = new Set([ ...item.slots.flatMap((s) => (s.administration ? [ s.administration.id ] : [])), ...(item.recent ?? []).map((a) => a.id) ]);
  const previous = last && last.status === "administered" && !known.has(last.id) ? last : null;
  const recent = (item.recent ?? []).filter((a) => now.getTime() - Date.parse(when(a)) <= DAY_MS);
  const detail = (a: UrgencyAdministration) => [
    `${adminStatusLabel(a.status)} por ${who(a)} às ${fmtHourMinute(when(a))}`,
    a.stock_lot && `lote ${a.stock_lot.lot_number}`, pending.has(a.id) && "pendência para a farmácia", a.reason && `motivo: ${a.reason}`
  ].filter(Boolean).join(" · ");

  return (
    <section aria-label={label} style={section}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{label}</strong>
        {marks && <Tag tone="warn" mono={false}>{marks}</Tag>}
      </div>
      <span style={{ fontSize: 12.5 }}>{item.dose} {item.dose_unit} · {route} · {frequencyText(item.frequency)}</span>
      {item.instructions && <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{item.instructions}</span>}
      {previous && <span style={muted}>{`última dose: ${fmtHourMinute(when(previous))} (versão anterior)`}</span>}

      {asNeeded ? (
        <>
          <span style={{ fontSize: 12.5 }}>
            {[ capital(frequencyText(item.frequency)), item.remaining !== null && item.remaining > 0
              && `${item.remaining === 1 ? "ainda cabe 1" : `ainda cabem ${item.remaining}`} nas últimas 24 h` ].filter(Boolean).join(" · ")}
          </span>
          {item.remaining === 0 && <span style={{ fontSize: 12.5 }}>{URGENCY_ERRORS.max_per_day_reached}</span>}
          {item.remaining !== 0 && !open && (
            <div><button type="button" style={secondaryButtonStyle} aria-label={`Registrar dose — ${label}`} onClick={() => onOpen(null)}>Registrar dose</button></div>
          )}
          {recent.length > 0 && (
            <ul aria-label="últimas 24 h" style={list}>
              {recent.map((a) => <li key={a.id} style={{ fontSize: 12.5 }}>{`${fmtHourMinute(when(a))} · ${detail(a)}`}</li>)}
            </ul>
          )}
          {open && open.slot === null && (
            <AdministrationForm item={item} slot={null} stockDeduction={stockDeduction} now={now} onRecorded={onRecorded}
              onStale={onStale} onCancel={onCancel} onEncounterClosed={onEncounterClosed} />
          )}
        </>
      ) : (
        <ul aria-label="horários" style={list}>
          {item.slots.map((s) => {
            const hhmm = fmtHourMinute(s.scheduled_at);
            const state = slotState(s, now);
            return (
              <li key={s.scheduled_at} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
                <span style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  {state === "done" && s.administration ? <span>{`${hhmm} · ${detail(s.administration)}`}</span>
                    : state === "late" ? <><span>{`${hhmm} ·`}</span><Tag tone="warn" mono={false}>{`pendente desde ${hhmm}`}</Tag></>
                      : <span>{`${hhmm} · ${state === "due" ? "agora" : "a seguir"}`}</span>}
                  {canCheck(s, now) && !(open && open.slot === s.scheduled_at) && (
                    <button type="button" style={secondaryButtonStyle} aria-label={`Checar ${hhmm} — ${label}`} onClick={() => onOpen(s.scheduled_at)}>Checar</button>
                  )}
                </span>
                {open && open.slot === s.scheduled_at && (
                  <AdministrationForm item={item} slot={s.scheduled_at} stockDeduction={stockDeduction} now={now} onRecorded={onRecorded}
                    onStale={onStale} onCancel={onCancel} onEncounterClosed={onEncounterClosed} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const section: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: 12, border: "1px solid var(--rule2)", borderRadius: 8 };
const list: CSSProperties = { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
