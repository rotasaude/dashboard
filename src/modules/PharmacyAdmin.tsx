// PharmacyAdmin — locais de estoque, equipe por local e configurações da cidade (módulo 27a; F-27.1; contrato §3).
// Só o municipal_admin (o portão); toda escrita passa pelo step-up, nas peças. As leituras são estáticas (STATIC_QUERY): depois
// de cada escrita a chave certa é relida (PH_ADMIN_KEY / PH_SETTINGS_KEY). A equipe é do local escolhido na tabela.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAdminLocations, listAllUnits, listMemberships } from "../lib/api";
import { PH_ADMIN_KEY, STATIC_QUERY, pharmacyError } from "../lib/pharmacy";
import { alert, muted, stack } from "./exams/styles";
import { PharmacyGate } from "./pharmacy/PharmacyGate";
import { LocationsPanel } from "./pharmacy/LocationsPanel";
import { StaffPanel } from "./pharmacy/StaffPanel";
import { SettingsPanel } from "./pharmacy/SettingsPanel";

const UNITS_KEY = "pharmacyUnits";
const MEMBERSHIPS_KEY = "pharmacyMemberships";

export function PharmacyAdmin({ onGoToSecurity }: { onGoToSecurity?(): void } = {}) {
  return (
    <PharmacyGate title="Locais e configurações" sub="locais de estoque, equipe por local e prazos" allow={(r) => r.admin}>
      {() => <Body onGoToSecurity={onGoToSecurity} />}
    </PharmacyGate>
  );
}

function Body({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  const queryClient = useQueryClient();
  const locations = useQuery({ queryKey: [ PH_ADMIN_KEY ], queryFn: listAdminLocations, ...STATIC_QUERY });
  const units = useQuery({ queryKey: [ UNITS_KEY ], queryFn: listAllUnits, ...STATIC_QUERY });
  const memberships = useQuery({ queryKey: [ MEMBERSHIPS_KEY ], queryFn: listMemberships, ...STATIC_QUERY });
  const [ selectedId, setSelectedId ] = useState<string | null>(null);

  const reload = () => { void queryClient.invalidateQueries({ queryKey: [ PH_ADMIN_KEY ] }); };
  const selected = locations.data?.find((l) => l.id === selectedId) ?? null;

  return (
    <div style={stack}>
      {locations.isPending && <p className="mono" style={muted}>carregando…</p>}
      {locations.isError && <p role="alert" style={alert}>{pharmacyError(locations.error)}</p>}
      {locations.data && (
        <LocationsPanel locations={locations.data} units={units.data ?? []} selectedId={selectedId}
          onSelectStaff={setSelectedId} onSaved={reload} onGoToSecurity={onGoToSecurity} />
      )}
      {selected && (
        <StaffPanel key={selected.id} location={selected} memberships={memberships.data ?? []} onChanged={reload} onGoToSecurity={onGoToSecurity} />
      )}
      <SettingsPanel onGoToSecurity={onGoToSecurity} />
    </div>
  );
}
