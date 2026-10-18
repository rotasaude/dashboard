// Lotes e movimentos (spec §6.2–§6.5; contrato §5): entrada (lote vencido
// recusado), saldo por lote, movimentos e o formulário de abertura, perda,
// vencimento e ajuste (só admin, com sinal). Saída maior que o saldo é
// recusada antes; se o api recusar (saldo mudou), relê e mantém o formulário.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listSupplies, listSupplyLots, listSupplyMovements, receiveSupplyLot, recordSupplyMovement, type LabSupplyLot, type LabSupplyMovement } from "../../lib/api";
import {
  EMPTY_LOT_ENTRY, EMPTY_MOVEMENT, INV_LOTS_KEY, INV_MOVEMENTS_KEY, INV_SUPPLIES_KEY, SUPPLY_ORIGIN_LABEL, inventoryError, fmtMovementQuantity, lotEntryBody,
  lotEntryProblem, movementBody, movementLabel, movementProblem, originLabel, refreshInventory, type LotEntryDraft, type MovementDraft
} from "../../lib/inventory";
import { todayInCity } from "../../lib/campaigns";
import { fmtDay } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { ActionButton } from "../../components/ActionButton";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, muted, okText, row, stack } from "../exams/styles";

export function SupplyLotsPanel({ providerId, admin, onGoToSecurity }: { providerId: string; admin: boolean; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const today = todayInCity();
  const supplies = useQuery({ queryKey: [ INV_SUPPLIES_KEY, providerId ], queryFn: () => listSupplies(providerId), retry: false });
  const [ supplyId, setSupplyId ] = useState("");
  const lots = useQuery({ queryKey: [ INV_LOTS_KEY, supplyId ], queryFn: () => listSupplyLots({ supplyId }), enabled: supplyId !== "", retry: false });
  const [ entry, setEntry ] = useState<LotEntryDraft>(EMPTY_LOT_ENTRY);
  const [ entryError, setEntryError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ lotId, setLotId ] = useState<string | null>(null);
  const lot = (lots.data ?? []).find((l) => l.id === lotId) ?? null;
  const supply = (supplies.data ?? []).find((s) => s.id === supplyId);

  async function receive() {
    const draft = { ...entry, supplyId };
    const problem = lotEntryProblem(draft, today);
    if (problem) { setEntryError(problem); return; }
    setEntryError(null);
    try {
      await receiveSupplyLot(lotEntryBody(draft));
      setEntry(EMPTY_LOT_ENTRY);
      setNotice("Entrada registrada.");
      void refreshInventory(queryClient).catch(() => undefined);
    } catch (err) {
      if (errorCode(err) === "not_found") void refreshInventory(queryClient).catch(() => undefined);
      setEntryError(inventoryError(err));
    }
  }

  const setE = (patch: Partial<LotEntryDraft>) => setEntry((d) => ({ ...d, ...patch }));

  return (
    <Panel title="Lotes e movimentos" sub="saldo = soma dos movimentos; nada é baixado sozinho">
      <div style={stack}>
        <label style={fieldLabel}>Item
          <select value={supplyId} style={inputStyle} onChange={(e) => { setSupplyId(e.target.value); setLotId(null); setNotice(null); setEntry(EMPTY_LOT_ENTRY); setEntryError(null); }}>
            <option value="">—</option>
            {(supplies.data ?? []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {supplyId && (lots.isError ? <p role="alert" style={alert}>{inventoryError(lots.error)}</p> : (
          <DataTable<LabSupplyLot>
            cols={[
              { label: "Lote", w: "1fr", card: "title", render: (l) => <span className="mono">{l.lot_number}</span> },
              { label: "Validade", w: "1fr", render: (l) => <>{fmtDay(l.expires_on)}{l.expires_on < today && <> <Tag tone="down">vencido</Tag></>}{l.balance === 0 && <> <Tag>esgotado</Tag></>}</> },
              { label: "Fornecedor · origem", w: "1.4fr", render: (l) => `${l.supplier} · ${originLabel(l.origin)}` },
              { label: "Saldo", w: "0.7fr", align: "right", render: (l) => `${l.balance}${supply ? ` ${supply.unit}` : ""}` },
              { label: "", w: "auto", card: "actions", render: (l) => (
                <button type="button" style={secondaryButtonStyle} aria-pressed={lotId === l.id} onClick={() => setLotId(l.id)}>Movimentos</button>
              ) }
            ]}
            rows={lots.data ?? []} rowKey={(l) => l.id} empty={lots.isPending ? "carregando…" : "nenhum lote cadastrado"}
          />
        ))}
        {supplyId && (
          <fieldset role="group" aria-label="Entrada de lote" style={fieldset}>
            <legend style={legend}>Entrada de lote</legend>
            <div style={row}>
              <label style={fieldLabel}>Número do lote<input value={entry.lotNumber} style={inputStyle} onChange={(e) => setE({ lotNumber: e.target.value })} /></label>
              <label style={fieldLabel}>Validade<input type="date" value={entry.expiresOn} style={inputStyle} onChange={(e) => setE({ expiresOn: e.target.value })} /></label>
              <label style={fieldLabel}>Fornecedor<input value={entry.supplier} style={inputStyle} onChange={(e) => setE({ supplier: e.target.value })} /></label>
              <label style={fieldLabel}>Origem
                <select value={entry.origin} style={inputStyle} onChange={(e) => setE({ origin: e.target.value as LotEntryDraft["origin"] })}>
                  <option value="">—</option>
                  {Object.entries(SUPPLY_ORIGIN_LABEL).map(([ k, v ]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>Quantidade<input value={entry.quantity} inputMode="numeric" style={inputStyle} onChange={(e) => setE({ quantity: e.target.value })} /></label>
              <label style={fieldLabel}>Documento (opcional)<input value={entry.document} style={inputStyle} onChange={(e) => setE({ document: e.target.value })} /></label>
            </div>
            {entryError && <p role="alert" style={alert}>{entryError}</p>}
            <div><ActionButton onClick={receive}>Registrar entrada</ActionButton></div>
          </fieldset>
        )}
        {lot && <LotMovements key={lot.id} lot={lot} admin={admin} onGoToSecurity={onGoToSecurity} onChanged={() => void refreshInventory(queryClient).catch(() => undefined)}
          onStale={() => void lots.refetch()} />}
        {!supplyId && <p style={muted}>escolha o item para ver os lotes e registrar entradas</p>}
      </div>
    </Panel>
  );
}

function LotMovements({ lot, admin, onChanged, onStale, onGoToSecurity }: {
  lot: LabSupplyLot; admin: boolean; onChanged(): void; onStale(): void; onGoToSecurity?(): void
}) {
  const movements = useQuery({ queryKey: [ INV_MOVEMENTS_KEY, lot.id ], queryFn: () => listSupplyMovements(lot.id), retry: false });
  const [ draft, setDraft ] = useState<MovementDraft>(EMPTY_MOVEMENT);
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const set = (patch: Partial<MovementDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const adjustment = draft.kind === "adjustment";

  // Saldo velho ou registro de outro laboratório: a frase diz que releu, então relê.
  const failed = (err: unknown) => {
    const code = errorCode(err);
    if (code === "insufficient_balance" || code === "not_found") onStale();
    return inventoryError(err);
  };

  function check(): boolean {
    const problem = movementProblem(draft, lot.balance, admin);
    setError(problem);
    return problem === null;
  }

  function done() {
    setDraft(EMPTY_MOVEMENT);
    setConfirming(false);
    setNotice(adjustment ? "Ajuste registrado." : "Movimento registrado.");
    onChanged();
  }

  async function save() {
    if (!check()) return;
    try {
      await recordSupplyMovement(movementBody(draft, lot.id));
      done();
    } catch (err) {
      setError(failed(err));
    }
  }

  return (
    <fieldset role="group" aria-label={`Movimentos do lote ${lot.lot_number}`} style={fieldset}>
      <legend style={legend}>{`Movimentos do lote ${lot.lot_number} · saldo ${lot.balance}`}</legend>
      {movements.isError ? <p role="alert" style={alert}>{inventoryError(movements.error)}</p> : (
        <DataTable<LabSupplyMovement>
          cols={[
            { label: "Quando", w: "1fr", card: "title", render: (m) => fmtDateTime(m.recorded_at) },
            { label: "Movimento", w: "0.8fr", render: (m) => movementLabel(m.kind) },
            { label: "Quantidade", w: "0.7fr", align: "right", render: (m) => fmtMovementQuantity(m.quantity) },
            { label: "Motivo · documento", w: "1.6fr", render: (m) => [ m.reason, m.document ].filter(Boolean).join(" · ") || "—" },
            { label: "Por", w: "1fr", render: (m) => m.recorded_by ?? "—" }
          ]}
          rows={movements.data ?? []} rowKey={(m) => m.id} empty={movements.isPending ? "carregando…" : "nenhum movimento"}
        />
      )}
      {notice && <p role="status" style={okText}>{notice}</p>}
      <div style={row}>
        <label style={fieldLabel}>Movimento
          <select value={draft.kind} style={inputStyle} disabled={confirming} onChange={(e) => { set({ kind: e.target.value as MovementDraft["kind"], reason: "" }); setConfirming(false); setError(null); }}>
            <option value="">—</option>
            <option value="opening">abertura</option>
            <option value="loss">perda</option>
            <option value="expiry">vencimento</option>
            {admin && <option value="adjustment">ajuste (com sinal)</option>}
          </select>
        </label>
        <label style={fieldLabel}>Quantidade<input value={draft.quantity} inputMode="numeric" style={inputStyle} disabled={confirming} onChange={(e) => set({ quantity: e.target.value })} /></label>
        {draft.kind !== "" && draft.kind !== "opening" && (
          <label style={fieldLabel}>Motivo<input value={draft.reason} style={inputStyle} disabled={confirming} onChange={(e) => set({ reason: e.target.value })} /></label>
        )}
      </div>
      {error && <p role="alert" style={alert}>{error}</p>}
      {!adjustment && <div><ActionButton onClick={save}>Registrar movimento</ActionButton></div>}
      {adjustment && !confirming && (
        <div><button type="button" style={buttonStyle} onClick={() => { if (check()) setConfirming(true); }}>Revisar e registrar ajuste</button></div>
      )}
      {adjustment && confirming && (
        <SensitiveAction title="Registrar ajuste" description={`O saldo do lote ${lot.lot_number} muda em ${fmtMovementQuantity(Number(draft.quantity))}; o ajuste fica no histórico com o motivo.`}
          requiresStepUp confirmLabel="Registrar ajuste"
          run={async () => { await recordSupplyMovement(movementBody(draft, lot.id)); }}
          onDone={done} onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={failed} />
      )}
    </fieldset>
  );
}
