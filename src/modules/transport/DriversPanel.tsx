// Motoristas da frota (módulo 30, F-30.1): quem tem o papel `driver` na Equipe vira motorista com CNH. O api devolve só os 4 últimos dígitos da CNH;
// o número completo vai apenas no corpo da criação/edição e nunca é guardado nem exibido.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createDriver, listDriverCandidates, listDrivers, updateDriver, type TransportDriver } from "../../lib/api";
import {
  STATIC_QUERY, TR_DRIVERS_KEY, driverCreateBody, driverProblems, driverUpdateBody, licenseText, licenseTone, transportError, transportRefusals, type DriverDraft
} from "../../lib/transport";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { DataTable, type Column } from "../../components/DataTable";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, stack } from "../exams/styles";
import { CheckField, FleetForm, SelectField, TextField, problemsToErrors, routeRefusals, type FieldErrors } from "./fleetForm";

const FIELDS = [ "user_id", "license_number", "license_category", "license_expires_on" ] as const;
const CANDIDATES_KEY = "transportDriverCandidates";
const CATEGORIES: [ string, string ][] = [ "B", "C", "D", "E" ].map((c) => [ c, c ]);
const EMPTY: DriverDraft = { userId: "", licenseNumber: "", licenseCategory: "", licenseExpiresOn: "", active: true };

// Só motorista ativo conta: o inativo não entra em viagem, então a CNH dele não é pendência.
export function cnhAlertText(drivers: TransportDriver[]): string | null {
  const active = drivers.filter((d) => d.active);
  const expired = active.filter((d) => d.license_status === "expired").length;
  const expiring = active.filter((d) => d.license_status === "expiring").length;
  const parts: string[] = [];
  if (expired > 0) parts.push(`${expired} ${expired === 1 ? "motorista com CNH vencida" : "motoristas com CNH vencida"}`);
  if (expiring > 0) {
    const verb = expiring === 1 ? "vence" : "vencem";
    parts.push(expired > 0 ? `${expiring} ${verb} em até 30 dias` : `${expiring} ${expiring === 1 ? "motorista com CNH que vence" : "motoristas com CNH que vencem"} em até 30 dias`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function DriversPanel(_props: { today?: string }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [ TR_DRIVERS_KEY ], queryFn: () => listDrivers(), ...STATIC_QUERY });
  const [ editing, setEditing ] = useState<TransportDriver | "new" | null>(null);
  const candidates = useQuery({ queryKey: [ CANDIDATES_KEY ], queryFn: listDriverCandidates, enabled: editing === "new", ...STATIC_QUERY });
  const [ draft, setDraft ] = useState<DriverDraft>(EMPTY);
  const [ errors, setErrors ] = useState<FieldErrors>({});
  const [ general, setGeneral ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const msg = useActionMessage();
  const set = (patch: Partial<DriverDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const creating = editing === "new";

  function open(target: TransportDriver | "new") {
    setEditing(target); setErrors({}); setGeneral(null); msg.start();
    setDraft(target === "new" ? EMPTY : { userId: target.user.id, licenseNumber: "", licenseCategory: String(target.license_category), licenseExpiresOn: target.license_expires_on, active: target.active });
  }

  async function save() {
    const problems = driverProblems(draft, creating);
    if (problems.length > 0) { setErrors(problemsToErrors(problems)); setGeneral(null); return; }
    setErrors({}); setGeneral(null); setBusy(true); msg.start();
    try {
      if (creating) await createDriver(driverCreateBody(draft)); else if (editing) await updateDriver(editing.id, driverUpdateBody(draft));
      setEditing(null); setDraft(EMPTY);
      msg.ok(creating ? "Motorista cadastrado." : "Motorista atualizado.");
      await Promise.all([ queryClient.invalidateQueries({ queryKey: [ TR_DRIVERS_KEY ] }), queryClient.invalidateQueries({ queryKey: [ CANDIDATES_KEY ] }) ]);
    } catch (err) {
      const routed = routeRefusals(transportRefusals(err), FIELDS);
      setErrors(routed.fields); setGeneral(routed.general);
    } finally { setBusy(false); }
  }

  const alertText = cnhAlertText(list.data ?? []);
  const cols: Column<TransportDriver>[] = [
    { label: "Motorista", w: "1.3fr", card: "title", render: (d) => d.user.name },
    { label: "CNH", w: "1.6fr", render: (d) => (
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Tag tone={licenseTone(d)} mono={false}>{licenseText(d)}</Tag>
        <span className="mono">final {d.license_number_last4}</span>
      </span>
    ) },
    { label: "Situação", w: "0.7fr", render: (d) => <Tag tone={d.active ? "ok" : undefined}>{d.active ? "ativo" : "inativo"}</Tag> },
    { label: "", w: "auto", card: "actions", render: (d) => <button type="button" style={secondaryButtonStyle} aria-label={`Editar motorista ${d.user.name}`} onClick={() => open(d)}>Editar</button> }
  ];

  return (
    <Panel title="Motoristas" sub="quem tem o papel de motorista na Equipe · CNH e validade"
      right={<button type="button" style={secondaryButtonStyle} onClick={() => open("new")}>Novo motorista</button>}>
      <div style={stack}>
        <p role="status" style={{ ...alert, fontWeight: 600 }}>{alertText}</p>
        {editing && (
          <FleetForm key={creating ? "new" : typeof editing === "object" && editing ? editing.id : ""} label="Motorista" busy={busy} general={general} onSubmit={() => { void save(); }} onCancel={() => { setEditing(null); setDraft(EMPTY); }}>
            {creating ? (
              <>
                <SelectField id="drv-user" label="Pessoa" value={draft.userId} error={errors.user_id} blank="escolha…"
                  options={(candidates.data ?? []).map((c) => [ c.user_id, c.name ])} onChange={(v) => set({ userId: v })} />
                {candidates.isSuccess && candidates.data.length === 0 && <p style={muted}>Ninguém com o papel de motorista na Equipe está sem cadastro. Convide a pessoa na Equipe com o papel Motorista.</p>}
                {candidates.isError && <p role="alert" style={alert}>{transportError(candidates.error)}</p>}
              </>
            ) : <p style={{ margin: 0, fontSize: 13 }}>{typeof editing === "object" && editing ? editing.user.name : ""}</p>}
            <TextField id="drv-cnh" label="Número da CNH" value={draft.licenseNumber} error={errors.license_number} inputMode="numeric" autoComplete="off"
              hint={creating ? undefined : "deixe vazio para manter"} onChange={(v) => set({ licenseNumber: v })} />
            <SelectField id="drv-cat" label="Categoria" value={draft.licenseCategory} error={errors.license_category} blank="escolha…" options={CATEGORIES} onChange={(v) => set({ licenseCategory: v })} />
            <TextField id="drv-exp" label="Validade da CNH" type="date" value={draft.licenseExpiresOn} error={errors.license_expires_on} onChange={(v) => set({ licenseExpiresOn: v })} />
            <CheckField id="drv-active" label="Ativo" checked={draft.active} onChange={(v) => set({ active: v })} />
          </FleetForm>
        )}
        <ActionMessage message={msg.message} />
        {list.isError ? <p role="alert" style={alert}>{transportError(list.error)}</p> : (
          <DataTable<TransportDriver> cols={cols} rows={list.data ?? []} rowKey={(d) => d.id} empty={list.isPending ? "carregando…" : "nenhum motorista cadastrado"} />
        )}
      </div>
    </Panel>
  );
}
