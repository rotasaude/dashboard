// Lote de reagente em uso por aparelho e exame (spec §6.3; contrato §5 e §7):
// é o lote que o api grava em cada resultado e valor de controle. Pôr um novo
// em uso encerra o anterior do mesmo aparelho e exame (o api faz); o mesmo
// lote de novo devolve o registro atual e nada muda (C-E6). Rotina: sem
// step-up (C-E39). Só lote de reagente ligado ao exame e dentro da validade
// é oferecido; aparelho inativo não.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listInUse, listLabInstruments, listSupplies, listSupplyLots, setInUse, type LabExamRef, type LabSupplyInUse } from "../../lib/api";
import { INV_IN_USE_KEY, INV_LOTS_KEY, INV_SUPPLIES_KEY, inventoryError, refreshInventory } from "../../lib/inventory";
import { QC_INSTRUMENTS_KEY } from "../../lib/qc";
import { todayInCity } from "../../lib/campaigns";
import { fmtDay } from "../../lib/exams";
import { fmtDateTime } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, muted, okText, row, stack } from "../exams/styles";

export function InUsePanel({ providerId, exams }: { providerId: string; exams: LabExamRef[] }) {
  const queryClient = useQueryClient();
  const today = todayInCity();
  const instruments = useQuery({ queryKey: [ QC_INSTRUMENTS_KEY, providerId, "lab" ], queryFn: () => listLabInstruments(providerId), retry: false });
  const supplies = useQuery({ queryKey: [ INV_SUPPLIES_KEY, providerId ], queryFn: () => listSupplies(providerId), retry: false });
  const lots = useQuery({ queryKey: [ INV_LOTS_KEY, "provider", providerId ], queryFn: () => listSupplyLots({ providerId }), retry: false });
  const active = (instruments.data ?? []).filter((i) => i.active);
  const [ picked, setPicked ] = useState("");
  const instrumentId = picked || (active.length === 1 ? active[0].id : "");
  const inUse = useQuery({ queryKey: [ INV_IN_USE_KEY, instrumentId ], queryFn: () => listInUse(instrumentId), enabled: instrumentId !== "", retry: false });
  const [ examId, setExamId ] = useState("");
  const [ lotId, setLotId ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const reagentIds = (supplies.data ?? []).filter((s) => s.kind === "reagent" && s.active && s.lab_exam_ids.includes(examId)).map((s) => s.id);
  const options = (lots.data ?? []).filter((l) => reagentIds.includes(l.supply_id) && l.expires_on >= today && l.balance > 0);

  async function save() {
    if (!instrumentId) { setError("escolha o aparelho"); return; }
    if (!examId) { setError("escolha o exame"); return; }
    if (!lotId) { setError("escolha o lote do reagente"); return; }
    setError(null);
    setNotice(null);
    // Antes da chamada: o api responde 200 com o registro atual quando o lote já era o corrente (C-E6).
    const before = (inUse.data ?? []).find((u) => u.lab_exam_id === examId);
    try {
      const saved = await setInUse({ lot_id: lotId, instrument_id: instrumentId, lab_exam_id: examId });
      setLotId("");
      setNotice(before && before.lot_id === saved.lot_id
        ? "Este lote já estava em uso neste aparelho e exame — nada mudou."
        : before ? "Lote em uso trocado — o anterior deste aparelho e exame foi encerrado." : "Lote posto em uso.");
      void refreshInventory(queryClient).catch(() => undefined);
    } catch (err) {
      if (errorCode(err) === "not_found") void refreshInventory(queryClient).catch(() => undefined);
      setError(inventoryError(err));
    }
  }

  return (
    <Panel title="Lote em uso por aparelho" sub="o lote que vai em cada resultado e valor de controle; sem lote em uso, o resultado sai sem rastreio">
      <div style={stack}>
        <label style={fieldLabel}>Aparelho
          <select value={instrumentId} style={inputStyle} onChange={(e) => { setPicked(e.target.value); setNotice(null); setError(null); }}>
            <option value="">—</option>
            {active.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </label>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {instrumentId ? (inUse.isError ? <p role="alert" style={alert}>{inventoryError(inUse.error)}</p> : (
          <DataTable<LabSupplyInUse>
            cols={[
              { label: "Exame", w: "1fr", card: "title", render: (u) => u.exam_name },
              { label: "Lote · item", w: "1.6fr", render: (u) => `${u.lot_number} · ${u.supply_name}` },
              { label: "Desde", w: "1fr", render: (u) => fmtDateTime(u.started_at) }
            ]}
            rows={inUse.data ?? []} rowKey={(u) => u.id} empty={inUse.isPending ? "carregando…" : "nenhum lote em uso neste aparelho"}
          />
        )) : <p style={muted}>escolha o aparelho</p>}
        {instrumentId && (
          <div style={{ ...row, alignItems: "flex-end" }}>
            <label style={fieldLabel}>Exame
              <select value={examId} style={inputStyle} onChange={(e) => { setExamId(e.target.value); setLotId(""); setNotice(null); }}>
                <option value="">—</option>
                {exams.filter((e) => e.id).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label style={fieldLabel}>Lote do reagente
              <select value={lotId} style={inputStyle} onChange={(e) => setLotId(e.target.value)}>
                <option value="">—</option>
                {options.map((l) => <option key={l.id} value={l.id}>{`${l.lot_number} · ${l.supply_name} · validade ${fmtDay(l.expires_on)}`}</option>)}
              </select>
            </label>
            <ActionButton onClick={save}>Pôr em uso</ActionButton>
          </div>
        )}
        {examId && options.length === 0 && <p style={muted}>nenhum lote de reagente ligado a este exame, com saldo e dentro da validade</p>}
        {error && <p role="alert" style={alert}>{error}</p>}
      </div>
    </Panel>
  );
}
