// Escolha do local da saída externa (módulo 27b; Q16/Q23, F-16). A saída externa é "dado de origem": vale para o estoque de QUALQUER
// domínio utilizável, sem o `bnafar`. Junta os locais da farmácia e do campo (GET /pharmacy/locations) e os da vacina (GET
// /vaccination/my_locations) em que a pessoa é `stock_keeper`, em ordem de nome, com o tipo ao lado. O `municipal_admin` só lê: escolhe
// entre TODOS os locais da cidade (GET /pharmacy/admin/locations e, com a vacina, a rede de frio e as salas) e a tela dele mostra a lista
// sem o formulário (`keeper: false`). Trocar de local remonta o conteúdo. Nada em storage.
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listAdminLocations, listMyPharmacyLocations, listMyVaccineLocations, listVaccineRooms } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hasFeature } from "../../lib/features";
import { EXTERNAL_EXITS_KEY, STATIC_QUERY, bnafarError, bnafarRoles } from "../../lib/bnafar";
import { NO_LOCATION, PH_LOCATIONS_KEY, canUseStockScreens, locationKindLabel, locationRoles } from "../../lib/pharmacy";
import { VAC_LOCATIONS_KEY, locationAbilities } from "../../lib/vaccination";
import { inputStyle } from "../../components/formStyles";
import { EmptyState } from "../../components/EmptyState";
import { alert, fieldLabel, muted, stack } from "../exams/styles";

// `keeper`: a pessoa grava saída neste local (almoxarife dele); sem isso, só lê.
export interface ExitLocation { id: string; name: string; kind: string; keeper: boolean }

export function ExitLocationPick({ children }: { children(loc: ExitLocation): ReactNode }) {
  const { user } = useAuth();
  const roles = bnafarRoles(user ?? null);
  const stockOn = !!user && canUseStockScreens(user), vacOn = !!user && hasFeature(user, "vaccination");
  const professional = !!user?.memberships?.some((m) => m.role === "health_professional");
  const uid = user?.id ?? null;
  const ph = useQuery({ queryKey: [ PH_LOCATIONS_KEY, uid ], queryFn: listMyPharmacyLocations, enabled: stockOn && roles.keeper, ...STATIC_QUERY });
  const vac = useQuery({ queryKey: [ VAC_LOCATIONS_KEY, uid ], queryFn: listMyVaccineLocations, enabled: vacOn && (roles.keeper || professional), ...STATIC_QUERY });
  const admin = useQuery({ queryKey: [ EXTERNAL_EXITS_KEY, "admin-locations" ], queryFn: listAdminLocations, enabled: stockOn && roles.admin, ...STATIC_QUERY });
  const rooms = useQuery({ queryKey: [ EXTERNAL_EXITS_KEY, "vaccine-rooms" ], queryFn: listVaccineRooms, enabled: vacOn && roles.admin, ...STATIC_QUERY });
  const [ locationId, setLocationId ] = useState("");

  const sources = [ ph, vac, admin, rooms ];
  if (sources.some((q) => q.isPending && q.fetchStatus !== "idle")) return <p className="mono" style={muted}>carregando…</p>;
  const failed = sources.find((q) => q.isError && !q.data);
  if (failed) return <p role="alert" style={alert}>{bnafarError(failed.error)}</p>;

  const found = new Map<string, ExitLocation>();
  const put = (id: string, name: string, kind: string, keeper: boolean) => {
    const before = found.get(id);
    found.set(id, { id, name, kind, keeper: keeper || !!before?.keeper });
  };
  for (const l of ph.data ?? []) if (l.active && locationRoles(l).keeper) put(l.id, l.name, l.kind, true);
  // O api aceita o `room_lead` como almoxarife da sala (Pharmacy::Access::ROOM_ROLE_MAP); o `vaccinator` só lê. Fica aqui para não mexer
  // no locationAbilities das outras telas.
  for (const l of vac.data ?? []) {
    const a = locationAbilities(l);
    if (l.active && (a.keeper || (l.kind === "vaccine_room" && a.lead))) put(l.id, l.name, l.kind, true);
  }
  for (const l of admin.data ?? []) if (l.active) put(l.id, l.name, l.kind, false);
  for (const r of rooms.data?.rooms ?? []) if (r.active) put(r.stock_location_id, r.name, "vaccine_room", false);
  const cold = rooms.data?.cold_chain_central;
  if (cold?.active) put(cold.id, cold.name, "cold_chain_central", false);

  const options = [ ...found.values() ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  if (options.length === 0) return <EmptyState title={NO_LOCATION} />;
  const loc = options.find((l) => l.id === locationId) ?? options[0];
  return (
    <div style={stack}>
      {options.length > 1 && (
        <label style={fieldLabel}>
          Local
          <select value={loc.id} style={inputStyle} onChange={(e) => setLocationId(e.target.value)}>
            {options.map((l) => <option key={l.id} value={l.id}>{l.name} — {locationKindLabel(l.kind)}</option>)}
          </select>
        </label>
      )}
      <Fragment key={loc.id}>{children(loc)}</Fragment>
    </div>
  );
}
