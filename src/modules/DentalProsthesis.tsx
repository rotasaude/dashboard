// Próteses (módulo 28; F-28.6; contrato §7, O10, O27). Fila nominal da unidade: começa sem unidade escolhida e não lê nada até a
// escolha; lida ao escolher/filtrar e depois de cada ação — nunca sozinha (sem polling). A instalação só pela consulta.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, changeProsthesisStage, listActiveUnits, listProsthesisOrders, type ProsthesisOrder } from "../lib/api";
import { STATIC_QUERY, dentalError, nextStages, prosthesisStageLabel, prosthesisStageTone, reasonProblem } from "../lib/dental";
import { fmtDay } from "../lib/exams";
import { DataTable } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { DentalGate } from "./dental/DentalGate";

const ACTION_LABEL = { sent: "Enviada ao laboratório", received: "Recebida", cancelled: "Cancelar pedido" } as const;
const STAGE_FILTER = [ "impression", "sent", "received" ];

export function DentalProsthesis() {
  return (
    <DentalGate title="Próteses" sub="pedidos ao laboratório, etapas e instalação" allow={(r) => r.professional}>
      {() => <Body />}
    </DentalGate>
  );
}

function Body() {
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits, ...STATIC_QUERY });
  const [ unit, setUnit ] = useState("");
  const [ stage, setStage ] = useState("");
  const [ orders, setOrders ] = useState<ProsthesisOrder[]>([]);
  const [ next, setNext ] = useState<string | null>(null);
  const [ loading, setLoading ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ cancelling, setCancelling ] = useState<ProsthesisOrder | null>(null);
  const [ reason, setReason ] = useState("");
  const [ busy, setBusy ] = useState(false);
  const seq = useRef(0);

  async function load(u: string, s: string, before: string | null = null, keepError = false) {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const page = await listProsthesisOrders({ healthUnitId: u, stage: s || null, before });
      if (mine !== seq.current) return;
      setOrders((prev) => (before ? [ ...prev, ...page.orders ] : page.orders));
      setNext(page.next_before);
      if (!keepError) setError(null);
    } catch (e) {
      if (mine === seq.current) setError(dentalError(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  // Lê ao escolher a unidade e ao filtrar; o recarregamento depois de uma ação é explícito (`reload`).
  useEffect(() => {
    if (!unit) { seq.current++; setOrders([]); setNext(null); return; }
    void load(unit, stage);
  }, [ unit, stage ]);

  // Depois de uma ação a frase da recusa sobrevive à releitura.
  const reload = () => load(unit, stage, null, true);

  async function change(order: ProsthesisOrder, input: { stage: "sent" | "received" | "cancelled"; reason?: string }) {
    setBusy(true); setError(null);
    try {
      await changeProsthesisStage(order.id, input);
      setCancelling(null); setReason("");
    } catch (e) {
      setError(dentalError(e));
      if (e instanceof ApiError && e.status === 409) setCancelling(null);
    } finally {
      setBusy(false);
    }
    await reload();
  }

  const who = (o: ProsthesisOrder) => o.patient.display_name ?? "paciente";
  const reasonError = reason.length > 0 ? reasonProblem(reason) : null;

  return (
    <div style={stack}>
      <div style={row}>
        <label style={fieldLabel}>
          Unidade
          <select value={unit} style={inputStyle} onChange={(e) => { setUnit(e.target.value); setCancelling(null); }}>
            <option value="">Escolha…</option>
            {(units.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
        <label style={fieldLabel}>
          Etapa
          <select value={stage} style={inputStyle} onChange={(e) => { setStage(e.target.value); setCancelling(null); }}>
            <option value="">Todas</option>
            {STAGE_FILTER.map((s) => <option key={s} value={s}>{prosthesisStageLabel(s)}</option>)}
          </select>
        </label>
      </div>
      {units.isError && <p role="alert" style={alert}>{dentalError(units.error)}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {!unit ? <p style={muted}>Escolha a unidade para ver os pedidos.</p> : (
        <Panel title="Pedidos de prótese" sub="lidos ao escolher a unidade e ao filtrar">
          <DataTable<ProsthesisOrder>
            rows={orders} rowKey={(o) => o.id} empty={loading ? "carregando…" : "nenhum pedido nesta unidade"}
            cols={[
              { label: "Paciente", w: "1.2fr", card: "title", render: who },
              { label: "Prótese", w: "1.6fr", render: (o) => o.name },
              { label: "Laboratório", w: "1fr", render: (o) => o.laboratory.name },
              { label: "Etapa", w: "1fr", render: (o) => <Tag tone={prosthesisStageTone(o.stage)}>{prosthesisStageLabel(o.stage)}</Tag> },
              { label: "Desde", w: "0.8fr", card: "hide", render: (o) => (o.stages[0] ? fmtDay(o.stages[0].at) : "—") },
              { label: "Ações", w: "1.6fr", card: "actions", render: (o) => (
                <span style={row}>
                  {nextStages(o.stage).map((s) => (
                    <button key={s} type="button" style={secondaryButtonStyle} disabled={busy} aria-label={`${ACTION_LABEL[s]} — ${who(o)}`}
                      onClick={() => (s === "cancelled" ? (setCancelling(o), setReason("")) : change(o, { stage: s }))}>{ACTION_LABEL[s]}</button>
                  ))}
                </span>
              ) }
            ]}
          />
          {next && <button type="button" style={secondaryButtonStyle} disabled={loading} onClick={() => load(unit, stage, next)}>Ver mais</button>}
        </Panel>
      )}
      {cancelling && (
        <Panel title="Cancelar pedido" sub={`${who(cancelling)} — ${cancelling.name}`}>
          <label style={fieldLabel}>
            Motivo do cancelamento
            <textarea rows={2} value={reason} style={inputStyle} onChange={(e) => setReason(e.target.value)} />
          </label>
          {reasonError && <p role="alert" style={alert}>{reasonError}</p>}
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={busy || reasonProblem(reason) !== null}
              onClick={() => change(cancelling, { stage: "cancelled", reason: reason.trim() })}>Confirmar cancelamento</button>
            <button type="button" style={secondaryButtonStyle} onClick={() => { setCancelling(null); setReason(""); }}>Voltar</button>
          </div>
        </Panel>
      )}
    </div>
  );
}
