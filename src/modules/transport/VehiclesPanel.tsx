// Veículos da frota (módulo 30, F-30.1): lista, cadastro e edição pela central. Placa e RENAVAM repetidos voltam 409 sem caminho: viram recusa do campo.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createVehicle, listVehicles, updateVehicle, type TransportVehicle } from "../../lib/api";
import { STATIC_QUERY, TR_VEHICLES_KEY, normalizePlate, transportError, transportRefusals, vehicleBody, vehicleKindLabel, vehicleProblems, type VehicleDraft } from "../../lib/transport";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { DataTable, type Column } from "../../components/DataTable";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, stack } from "../exams/styles";
import { CheckField, FleetForm, SelectField, TextField, problemsToErrors, routeRefusals, type FieldErrors } from "./fleetForm";

const FIELDS = [ "plate", "renavam", "model", "kind", "renem_code", "seats", "wheelchair_spots", "cnes" ] as const;
const CODE_FIELD = { plate_taken: "plate", renavam_taken: "renavam" };
const KINDS: [ string, string ][] = [ "van", "minibus", "bus", "car", "ambulance_a" ].map((k) => [ k, vehicleKindLabel(k) ]);
const EMPTY: VehicleDraft = { plate: "", renavam: "", model: "", kind: "van", renem_code: "", seats: "", wheelchair_spots: "0", cnes: "", active: true };

const draftFrom = (v: TransportVehicle): VehicleDraft => ({
  plate: v.plate, renavam: v.renavam, model: v.model, kind: v.kind, renem_code: v.renem_code ?? "", seats: String(v.seats),
  wheelchair_spots: String(v.wheelchair_spots), cnes: v.cnes ?? "", active: v.active
});

export function VehiclesPanel() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [ TR_VEHICLES_KEY ], queryFn: () => listVehicles(), ...STATIC_QUERY });
  const [ editing, setEditing ] = useState<TransportVehicle | "new" | null>(null);
  const [ draft, setDraft ] = useState<VehicleDraft>(EMPTY);
  const [ errors, setErrors ] = useState<FieldErrors>({});
  const [ general, setGeneral ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const msg = useActionMessage();
  const set = (patch: Partial<VehicleDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function open(target: TransportVehicle | "new") {
    setEditing(target); setDraft(target === "new" ? EMPTY : draftFrom(target)); setErrors({}); setGeneral(null); msg.start();
  }

  async function save() {
    const problems = vehicleProblems(draft);
    if (problems.length > 0) { setErrors(problemsToErrors(problems)); setGeneral(null); return; }
    setErrors({}); setGeneral(null); setBusy(true); msg.start();
    try {
      const body = vehicleBody(draft);
      if (editing === "new") await createVehicle(body); else if (editing) await updateVehicle(editing.id, body);
      setEditing(null);
      msg.ok("Veículo salvo.");
      await queryClient.invalidateQueries({ queryKey: [ TR_VEHICLES_KEY ] });
    } catch (err) {
      const routed = routeRefusals(transportRefusals(err), FIELDS, CODE_FIELD);
      setErrors(routed.fields); setGeneral(routed.general);
    } finally { setBusy(false); }
  }

  const cols: Column<TransportVehicle>[] = [
    { label: "Placa", w: "0.9fr", card: "title", render: (v) => <span className="mono">{v.plate}</span> },
    { label: "Modelo", w: "1.4fr", render: (v) => `${v.model} · ${vehicleKindLabel(v.kind)}` },
    { label: "Lugares", w: "1fr", render: (v) => `${v.seats} lugares · ${v.wheelchair_spots} cadeirante` },
    { label: "CNES", w: "0.8fr", render: (v) => v.cnes ?? "—" },
    { label: "Situação", w: "0.7fr", render: (v) => <Tag tone={v.active ? "ok" : undefined}>{v.active ? "ativo" : "inativo"}</Tag> },
    { label: "", w: "auto", card: "actions", render: (v) => <button type="button" style={secondaryButtonStyle} aria-label={`Editar veículo ${v.plate}`} onClick={() => open(v)}>Editar</button> }
  ];

  return (
    <Panel title="Veículos" sub="frota da cidade · lugares, cadeirante e CNES"
      right={<button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Novo veículo</button>}>
      <div style={stack}>
        {editing && (
          <FleetForm label="Veículo" busy={busy} general={general} onSubmit={() => { void save(); }} onCancel={() => setEditing(null)}>
            <TextField id="veh-plate" label="Placa" value={draft.plate} error={errors.plate} autoComplete="off"
              onChange={(v) => set({ plate: v })} hint={draft.plate !== "" && normalizePlate(draft.plate) !== draft.plate ? `será gravada como ${normalizePlate(draft.plate)}` : undefined} />
            <TextField id="veh-renavam" label="RENAVAM" value={draft.renavam} error={errors.renavam} inputMode="numeric" autoComplete="off" onChange={(v) => set({ renavam: v })} />
            <TextField id="veh-model" label="Modelo" value={draft.model} error={errors.model} onChange={(v) => set({ model: v })} />
            <SelectField id="veh-kind" label="Tipo" value={draft.kind} error={errors.kind} options={KINDS} onChange={(v) => set({ kind: v })} />
            <TextField id="veh-renem" label="Código RENEM (opcional)" value={draft.renem_code} error={errors.renem_code} onChange={(v) => set({ renem_code: v })} />
            <TextField id="veh-seats" label="Lugares para passageiros" value={draft.seats} error={errors.seats} inputMode="numeric" onChange={(v) => set({ seats: v })} />
            <TextField id="veh-wheel" label="Vagas para cadeirante" value={draft.wheelchair_spots} error={errors.wheelchair_spots} inputMode="numeric" onChange={(v) => set({ wheelchair_spots: v })} />
            <TextField id="veh-cnes" label="CNES (opcional)" value={draft.cnes} error={errors.cnes} inputMode="numeric" onChange={(v) => set({ cnes: v })} />
            <CheckField id="veh-active" label="Ativo" checked={draft.active} onChange={(v) => set({ active: v })} />
          </FleetForm>
        )}
        <ActionMessage message={msg.message} />
        {list.isError ? <p role="alert" style={alert}>{transportError(list.error)}</p> : (
          <DataTable<TransportVehicle> cols={cols} rows={list.data ?? []} rowKey={(v) => v.id} empty={list.isPending ? "carregando…" : "nenhum veículo cadastrado"} />
        )}
      </div>
    </Panel>
  );
}
