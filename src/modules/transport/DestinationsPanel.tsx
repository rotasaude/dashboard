// Destinos do transporte (módulo 30, F-30.1): a distância rodoviária é cadastrada pela cidade e decide o TFD e o deslocamento no BPA.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createDestination, listDestinations, updateDestination, type TransportDestination } from "../../lib/api";
import { STATIC_QUERY, TR_DESTINATIONS_KEY, destinationBody, destinationProblems, transportError, transportRefusals, type DestinationDraft } from "../../lib/transport";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { DataTable, type Column } from "../../components/DataTable";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, stack } from "../exams/styles";
import { CheckField, FleetForm, TextField, problemsToErrors, routeRefusals, type FieldErrors } from "./fleetForm";

export const DISTANCE_NOTE = "A distância é a rodoviária, cadastrada pela cidade; ela decide o TFD e o deslocamento no BPA.";
const FIELDS = [ "ibge_code", "name", "distance_km", "metropolitan" ] as const;
const CODE_FIELD = { ibge_taken: "ibge_code" };
const EMPTY: DestinationDraft = { ibgeCode: "", name: "", distanceKm: "", metropolitan: false, active: true };

const draftFrom = (d: TransportDestination): DestinationDraft => ({
  ibgeCode: d.ibge_code, name: d.name, distanceKm: String(d.distance_km), metropolitan: d.metropolitan, active: d.active
});

export function DestinationsPanel() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [ TR_DESTINATIONS_KEY ], queryFn: () => listDestinations(), ...STATIC_QUERY });
  const [ editing, setEditing ] = useState<TransportDestination | "new" | null>(null);
  const [ draft, setDraft ] = useState<DestinationDraft>(EMPTY);
  const [ errors, setErrors ] = useState<FieldErrors>({});
  const [ general, setGeneral ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const msg = useActionMessage();
  const set = (patch: Partial<DestinationDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function open(target: TransportDestination | "new") {
    setEditing(target); setDraft(target === "new" ? EMPTY : draftFrom(target)); setErrors({}); setGeneral(null); msg.start();
  }

  async function save() {
    const problems = destinationProblems(draft);
    if (problems.length > 0) { setErrors(problemsToErrors(problems)); setGeneral(null); return; }
    setErrors({}); setGeneral(null); setBusy(true); msg.start();
    try {
      const body = destinationBody(draft);
      if (editing === "new") await createDestination(body); else if (editing) await updateDestination(editing.id, body);
      setEditing(null);
      msg.ok("Destino salvo.");
      await queryClient.invalidateQueries({ queryKey: [ TR_DESTINATIONS_KEY ] });
    } catch (err) {
      const routed = routeRefusals(transportRefusals(err), FIELDS, CODE_FIELD);
      setErrors(routed.fields); setGeneral(routed.general);
    } finally { setBusy(false); }
  }

  const cols: Column<TransportDestination>[] = [
    { label: "Destino", w: "1.4fr", card: "title", render: (d) => d.name },
    { label: "IBGE", w: "0.8fr", render: (d) => <span className="mono">{d.ibge_code}</span> },
    { label: "Distância", w: "0.8fr", render: (d) => (d.distance_km === 0 ? "dentro do município" : `${d.distance_km} km`) },
    { label: "Região metropolitana", w: "1fr", render: (d) => (d.metropolitan ? "sim" : "não") },
    { label: "Situação", w: "0.7fr", render: (d) => <Tag tone={d.active ? "ok" : undefined}>{d.active ? "ativo" : "inativo"}</Tag> },
    { label: "", w: "auto", card: "actions", render: (d) => <button type="button" style={secondaryButtonStyle} aria-label={`Editar destino ${d.name}`} onClick={() => open(d)}>Editar</button> }
  ];

  return (
    <Panel title="Destinos" sub="cidades para onde a frota leva · km a partir da sede"
      right={<button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Novo destino</button>}>
      <div style={stack}>
        <p style={muted}>{DISTANCE_NOTE}</p>
        {editing && (
          <FleetForm key={editing === "new" ? "new" : editing.id} label="Destino" busy={busy} general={general} onSubmit={() => { void save(); }} onCancel={() => setEditing(null)}>
            <TextField id="dst-ibge" label="Código IBGE" value={draft.ibgeCode} error={errors.ibge_code} inputMode="numeric" autoComplete="off" onChange={(v) => set({ ibgeCode: v })} />
            <TextField id="dst-name" label="Nome" value={draft.name} error={errors.name} onChange={(v) => set({ name: v })} />
            <TextField id="dst-km" label="Distância em km a partir da sede" value={draft.distanceKm} error={errors.distance_km} inputMode="numeric"
              hint="0 = dentro do município" onChange={(v) => set({ distanceKm: v })} />
            <CheckField id="dst-metro" label="Região metropolitana" checked={draft.metropolitan} onChange={(v) => set({ metropolitan: v })} />
            <CheckField id="dst-active" label="Ativo" checked={draft.active} onChange={(v) => set({ active: v })} />
          </FleetForm>
        )}
        <ActionMessage message={msg.message} />
        {list.isError ? <p role="alert" style={alert}>{transportError(list.error)}</p> : (
          <DataTable<TransportDestination> cols={cols} rows={list.data ?? []} rowKey={(d) => d.id} empty={list.isPending ? "carregando…" : "nenhum destino cadastrado"} />
        )}
      </div>
    </Panel>
  );
}
