// Frascos abertos da sala, abertura e descarte (módulo 29; F-29.5; contrato §3; §15 V14, V22). Lista os frascos da sala (abertos, vencidos e
// descartados) com as doses que restam e o tempo restante; "Abrir frasco" oferece só lotes multidose da posição que podem ser abertos (a
// única regra de abertura é a do estoque: lote da sala, não vencido, não bloqueado, com saldo — NT 236; o api confere de novo). O
// descarte é só do `room_lead`: motivo (10–500) e confirmação em dois passos. Depois de cada escrita, relê frascos e posição. O foco vai à
// frase de sucesso. O relógio é lido a cada render (a prop `now` é só dos testes); sem polling; nada em URL, log ou storage.
import { useEffect, useId, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { getVaccinationCatalog, listPositions, listVials, closeOutVial, openVial, type LotBalance, type Vial, type VaccineLocation } from "../../lib/api";
import { cityIsoDate, fmtDateTime } from "../../lib/format";
import { fmtDay } from "../../lib/exams";
import { PH_POSITIONS_KEY } from "../../lib/pharmacy";
import { STATIC_QUERY, VAC_CATALOG_KEY, VAC_VIALS_KEY, reasonProblem, vaccinationError, vialRemaining, vialStatusLabel } from "../../lib/vaccination";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, muted, okText, panel, row, title } from "../exams/styles";

export const VIAL_LOSS_NOTE = "As doses que sobram no frasco vencido ou descartado entram como perda técnica no resumo do mês.";

const expiredNow = (v: Vial, now: Date): boolean => v.status === "expired" || (v.status === "open" && vialRemaining(v, now) === "vencido");

export function VialsPanel({ room, now, lead }: { room: VaccineLocation; now?: Date; lead: boolean }) {
  const roomId = room.room_id as string;
  const clock = () => now ?? new Date();
  const client = useQueryClient();
  const vials = useQuery({ queryKey: [ VAC_VIALS_KEY, roomId, "all" ], queryFn: () => listVials(roomId, null), ...STATIC_QUERY });
  const catalog = useQuery({ queryKey: [ VAC_CATALOG_KEY ], queryFn: getVaccinationCatalog, ...STATIC_QUERY });
  const positions = useInfiniteQuery({
    queryKey: [ PH_POSITIONS_KEY, room.id, "vaccine" ],
    queryFn: ({ pageParam }) => listPositions({ locationId: room.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ discarding, setDiscarding ] = useState<Vial | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const reload = () => Promise.all([
    client.invalidateQueries({ queryKey: [ VAC_VIALS_KEY, roomId ] }), client.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] })
  ]);
  const nameOf = (code: string) => catalog.data?.immunobiologicals.find((i) => i.code === code)?.name ?? code;
  const at = clock();
  const list = vials.data ?? [];

  // Lotes multidose da posição que dá para abrir agora: saldo para um frasco inteiro, não vencido, não bloqueado.
  const today = cityIsoDate(at);
  const offered: LotBalance[] = (positions.data?.pages ?? []).flatMap((p) => p.positions).flatMap((p) => p.lots).filter((b) => {
    const imm = catalog.data?.immunobiologicals.find((i) => i.code === b.lot.item.immunobiological_code);
    return !!imm?.multidose && !b.blocked && !b.expired && b.lot.expires_on >= today && Number(b.balance) >= imm.doses_per_vial;
  });

  return (
    <section aria-label="Frascos abertos" style={panel}>
      <h3 style={title}>Frascos abertos</h3>
      <p style={muted}>{VIAL_LOSS_NOTE}</p>
      {notice && <Notice text={notice} />}
      {vials.isPending && <p className="mono" style={muted}>carregando…</p>}
      {vials.isError && !vials.data && <p role="alert" style={alert}>{vaccinationError(vials.error)}</p>}
      {vials.data && (
        <DataTable<Vial>
          cols={[
            { label: "Vacina", w: "1.2fr", card: "title", render: (v) => nameOf(v.lot.immunobiological_code) },
            { label: "Lote", w: "1fr", render: (v) => <span className="mono">{v.lot.number}</span> },
            { label: "Aberto em", w: "1.2fr", render: (v) => <span className="mono">{fmtDateTime(v.opened_at)}</span> },
            { label: "Doses", w: "1.2fr", render: (v) => (
              v.status === "open" ? `restam ${v.doses_left} de ${v.doses_per_vial} doses` : `sobraram ${v.doses_left} de ${v.doses_per_vial} doses`
            ) },
            { label: "Tempo restante", w: "1.2fr", render: (v) => <span className="mono">{v.status === "open" && !expiredNow(v, at) ? vialRemaining(v, at) : "—"}</span> },
            { label: "Situação", w: "1fr", card: "pair", render: (v) => (
              expiredNow(v, at) ? <Tag tone="down">vencido</Tag> : v.status === "closed_out" ? <Tag tone="warn">{vialStatusLabel(v.status)}</Tag> : <Tag tone="ok">{vialStatusLabel(v.status)}</Tag>
            ) },
            { label: "", w: "auto", card: "actions", render: (v) => (
              lead && v.status === "open" && !expiredNow(v, at) ? (
                <button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); setDiscarding(v); }}>{`Descartar — ${v.lot.number}`}</button>
              ) : null
            ) }
          ]}
          rows={list} rowKey={(v) => v.id} empty="nenhum frasco aberto nesta sala"
        />
      )}
      {discarding && (
        <DiscardForm key={discarding.id} vial={discarding} alive={alive} onCancel={() => setDiscarding(null)}
          onDone={() => { setDiscarding(null); setNotice("Frasco descartado: as doses que sobraram entram como perda técnica."); }} reload={reload} />
      )}
      <OpenForm roomId={roomId} lots={offered} alive={alive} reload={reload}
        loading={positions.isPending || catalog.isPending}
        onDone={(lot) => setNotice(`Frasco aberto: lote ${lot.lot.lot_number}.`)} onStart={() => setNotice(null)} />
    </section>
  );
}

// Regra de teclado: depois de uma escrita, o foco vai à frase de sucesso.
function Notice({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, [ text ]);
  return <p ref={ref} tabIndex={-1} role="status" style={okText}>{text}</p>;
}

function OpenForm({ roomId, lots, loading, alive, reload, onStart, onDone }: {
  roomId: string; lots: LotBalance[]; loading: boolean; alive: { current: boolean }; reload(): Promise<unknown>; onStart(): void; onDone(lot: LotBalance): void;
}) {
  const uid = useId();
  const [ lotId, setLotId ] = useState("");
  const [ err, setErr ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const select = useRef<HTMLSelectElement>(null);

  async function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const lot = lots.find((b) => b.lot.id === lotId);
    if (!lot) { setErr("escolha o lote"); select.current?.focus(); return; }
    setErr(null); setBusy(true); onStart();
    try {
      await openVial(roomId, lot.lot.id);
      if (!alive.current) return;
      setLotId("");
      onDone(lot);
    } catch (error) {
      if (alive.current) setErr(vaccinationError(error));
    } finally {
      if (alive.current) setBusy(false);
    }
    // Recusada ou não, a tela relê: o saldo, o bloqueio e os frascos podem ter mudado.
    await reload();
  }

  return (
    <form aria-label="Abrir frasco" style={form} onSubmit={(e) => void submit(e)} noValidate>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-lot`}>Lote</label>
        <select ref={select} id={`${uid}-lot`} style={inputStyle} value={lotId} onChange={(e) => { setLotId(e.target.value); setErr(null); }}
          {...(err ? { "aria-invalid": true, "aria-describedby": `${uid}-err` } : {})}>
          <option value="">{loading ? "carregando…" : lots.length === 0 ? "nenhum lote multidose disponível" : "escolha o lote"}</option>
          {lots.map((b) => <option key={b.lot.id} value={b.lot.id}>{`${b.lot.item.name} — ${b.lot.lot_number} · vence ${fmtDay(b.lot.expires_on)}`}</option>)}
        </select>
      </div>
      {err && <p id={`${uid}-err`} role="alert" style={alert}>{err}</p>}
      <div style={row}><button type="submit" style={buttonStyle} disabled={busy}>Abrir frasco</button></div>
    </form>
  );
}

function DiscardForm({ vial, alive, reload, onCancel, onDone }: {
  vial: Vial; alive: { current: boolean }; reload(): Promise<unknown>; onCancel(): void; onDone(): void;
}) {
  const uid = useId();
  const [ reason, setReason ] = useState("");
  const [ err, setErr ] = useState<string | null>(null);
  const [ confirm, setConfirm ] = useState(false);
  const [ busy, setBusy ] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  function review(e: { preventDefault(): void }) {
    e.preventDefault();
    const problem = reasonProblem(reason, "o motivo");
    setErr(problem);
    if (problem) { field.current?.focus(); return; }
    setConfirm(true);
  }

  async function run() {
    setBusy(true); setErr(null);
    try {
      await closeOutVial(vial.id, reason.trim());
      await reload();
      if (alive.current) onDone();
    } catch (error) {
      if (alive.current) { setErr(vaccinationError(error)); setConfirm(false); setBusy(false); }
      await reload();
    }
  }

  if (confirm) {
    return (
      <section aria-label="Confirmar o descarte" style={panel}>
        <p style={{ margin: 0 }}>{`Descartar o frasco do lote ${vial.lot.number}? As ${vial.doses_left} doses que sobram viram perda técnica e o frasco não pode ser reaberto.`}</p>
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void run()}>Sim, descartar</button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => setConfirm(false)}>Voltar</button>
        </div>
      </section>
    );
  }
  return (
    <form aria-label="Descartar frasco" style={form} onSubmit={review} noValidate>
      <div style={fieldLabel}>
        <label htmlFor={`${uid}-reason`}>Motivo do descarte</label>
        <textarea ref={field} id={`${uid}-reason`} style={inputStyle} rows={2} value={reason}
          {...(err ? { "aria-invalid": true, "aria-describedby": `${uid}-err` } : {})}
          onChange={(e) => { setReason(e.target.value); setErr(null); }} />
      </div>
      {err && <p id={`${uid}-err`} role="alert" style={alert}>{err}</p>}
      <div style={row}>
        <button type="submit" style={buttonStyle}>Descartar frasco</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
