// src/modules/LabInstruments.tsx
// Aparelhos do laboratório (contrato §2; spec §4 "Aparelhos"): o admin
// cadastra (step-up: /lab/admin); a equipe e os liberadores leem pela rota de
// membros. Aberta com o CIQ ou com o estoque ligado (Divergência C13).
// O aparelho é reconhecido na mensagem HL7 pelo componente 1 do OBX-18 (C-Q2).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createInstrument, listAdminInstruments, listLabInstruments, updateInstrument, type LabInstrument } from "../lib/api";
import { SECTOR_LABEL, sectorLabel } from "../lib/lab";
import {
  EMPTY_INSTRUMENT, INSTRUMENTS_DISABLED, QC_INSTRUMENTS_KEY, instrumentBody, instrumentDraft, instrumentProblem, qcError, staleAware, type InstrumentDraft
} from "../lib/qc";
import { Panel } from "../components/Panel";
import { DataTable, type Column } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { SensitiveAction } from "../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { alert, box, checkLabel, fieldLabel, form, okText, row, stack } from "./exams/styles";

export function LabInstruments({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <LabGate title="Aparelhos" sub="laboratório municipal · aparelhos, setor e identificação na HL7"
      allow={(r) => r.admin || r.staff || r.releaser} requires={[ "lab_quality_control", "lab_inventory" ]} disabledText={INSTRUMENTS_DISABLED}>
      {(roles) => <LabPick>{(lab) => <InstrumentsBody providerId={lab.id} admin={roles.admin} onGoToSecurity={onGoToSecurity} />}</LabPick>}
    </LabGate>
  );
}

function InstrumentsBody({ providerId, admin, onGoToSecurity }: { providerId: string; admin: boolean; onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: [ QC_INSTRUMENTS_KEY, providerId, admin ? "admin" : "lab" ],
    queryFn: () => (admin ? listAdminInstruments(providerId) : listLabInstruments(providerId)), retry: false
  });
  const [ editing, setEditing ] = useState<LabInstrument | "new" | null>(null);
  const [ draft, setDraft ] = useState<InstrumentDraft>(EMPTY_INSTRUMENT);
  const [ confirming, setConfirming ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const set = (patch: Partial<InstrumentDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function open(target: LabInstrument | "new") {
    setEditing(target);
    setDraft(target === "new" ? EMPTY_INSTRUMENT : instrumentDraft(target));
    setConfirming(false); setError(null); setNotice(null);
  }

  function review() {
    const problem = instrumentProblem(draft);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  const text = (label: string, value: string, onChange: (v: string) => void) => (
    <label style={fieldLabel}>{label}<input value={value} style={inputStyle} onChange={(e) => onChange(e.target.value)} /></label>
  );

  const cols: Column<LabInstrument>[] = [
    { label: "Aparelho", w: "1.4fr", card: "title", render: (i) => (i.model && i.model !== i.name ? `${i.name} · ${i.model}` : i.name) },
    { label: "Setor", w: "1fr", render: (i) => sectorLabel(i.sector) },
    { label: "Fabricante · série", w: "1.4fr", render: (i) => [ i.manufacturer, i.serial_number ].filter(Boolean).join(" · ") || "—" },
    { label: "HL7 (OBX-18)", w: "1fr", render: (i) => (i.hl7_equipment_id ? <span className="mono">{i.hl7_equipment_id}</span> : "—") },
    { label: "Situação", w: "0.8fr", render: (i) => <Tag tone={i.active ? "ok" : undefined}>{i.active ? "ativo" : "inativo"}</Tag> }
  ];
  if (admin) {
    cols.push({ label: "", w: "auto", card: "actions", render: (i) => <button type="button" style={secondaryButtonStyle} onClick={() => open(i)}>Editar</button> });
  }

  return (
    <Panel title="Aparelhos do laboratório" sub="o identificador HL7 liga o aparelho às mensagens do middleware (componente 1 do OBX-18)"
      right={admin ? <button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Novo aparelho</button> : undefined}>
      <div style={stack}>
        {notice && <p role="status" style={okText}>{notice}</p>}
        {list.isError ? <p role="alert" style={alert}>{qcError(list.error)}</p> : (
          <DataTable<LabInstrument> cols={cols} rows={list.data ?? []} rowKey={(i) => i.id} empty={list.isPending ? "carregando…" : "nenhum aparelho cadastrado"} />
        )}
        {admin && editing && (
          <section aria-label={editing === "new" ? "Novo aparelho" : `Editar ${editing.name}`} style={box}>
            <fieldset disabled={confirming} style={{ ...form, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              {text("Nome", draft.name, (v) => set({ name: v }))}
              {text("Fabricante", draft.manufacturer, (v) => set({ manufacturer: v }))}
              {text("Modelo", draft.model, (v) => set({ model: v }))}
              {text("Número de série", draft.serialNumber, (v) => set({ serialNumber: v }))}
              <label style={fieldLabel}>Setor
                <select value={draft.sector} style={inputStyle} onChange={(e) => set({ sector: e.target.value })}>
                  <option value="">—</option>
                  {Object.entries(SECTOR_LABEL).map(([ k, v ]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {text("Identificador na HL7 (OBX-18)", draft.hl7EquipmentId, (v) => set({ hl7EquipmentId: v }))}
              <label style={checkLabel}><input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />Ativo</label>
            </fieldset>
            {error && <p role="alert" style={alert}>{error}</p>}
            {!confirming && (
              <div style={row}>
                <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar aparelho</button>
                <button type="button" style={secondaryButtonStyle} onClick={() => setEditing(null)}>Cancelar</button>
              </div>
            )}
            {confirming && (
              <SensitiveAction title="Salvar aparelho" description="O aparelho fica disponível para o CIQ, o lote em uso e a identificação das mensagens HL7."
                requiresStepUp confirmLabel="Salvar aparelho"
                run={async () => {
                  const body = instrumentBody(draft, providerId);
                  if (editing === "new") await createInstrument(body); else await updateInstrument(editing.id, body);
                }}
                onDone={() => { setConfirming(false); setEditing(null); setNotice("Aparelho salvo."); void queryClient.invalidateQueries({ queryKey: [ QC_INSTRUMENTS_KEY ] }); }}
                onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity} translateError={staleAware([ "not_found", "invalid_transition" ], () => { void queryClient.invalidateQueries({ queryKey: [ QC_INSTRUMENTS_KEY ] }); })} />
            )}
          </section>
        )}
      </div>
    </Panel>
  );
}
