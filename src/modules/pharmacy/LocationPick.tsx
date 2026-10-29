// Escolha do local de estoque nas telas da farmácia (módulo 27a; molde do LabPick).
// Tudo de estoque e dispensação é POR LOCAL: lê os locais da pessoa (GET /pharmacy/locations,
// sem dado pessoal; lido ao abrir) e mostra só os ATIVOS que o `allow` aceita, com o papel dela
// naquele local. O almoxarife do central recebe também os locais alheios com `roles: []`:
// uma tela de ação passa um `allow` que exige papel (esses locais não aparecem), uma tela só
// de consulta (posição, alertas) passa `() => true` e deixa CONSULTAR a posição de todos.
// Trocar de local remonta o conteúdo (nada do local anterior sobra). Nada em storage.
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listMyPharmacyLocations, type PharmacyLocation } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { NO_LOCATION, PH_LOCATIONS_KEY, STATIC_QUERY, locationKindLabel, locationRoles, pharmacyError } from "../../lib/pharmacy";
import { inputStyle } from "../../components/formStyles";
import { EmptyState } from "../../components/EmptyState";
import { alert, fieldLabel, muted, stack } from "../exams/styles";

export type LocationAllow = (roles: { pharmacist: boolean; assistant: boolean; keeper: boolean }) => boolean;

export function LocationPick({ allow, children }: { allow: LocationAllow; children(loc: PharmacyLocation): ReactNode }) {
  const { user } = useAuth();
  const locations = useQuery({
    queryKey: [ PH_LOCATIONS_KEY, user?.id ?? null ], queryFn: listMyPharmacyLocations, enabled: !!user, ...STATIC_QUERY
  });
  const [ locationId, setLocationId ] = useState("");
  if (locations.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (locations.isError && !locations.data) return <p role="alert" style={alert}>{pharmacyError(locations.error)}</p>;
  const options = (locations.data ?? []).filter((l) => l.active && allow(locationRoles(l)));
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
