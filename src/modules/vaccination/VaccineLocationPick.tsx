// Escolha do local nas telas da vacinação (módulo 29; molde do LocationPick da farmácia). Lê os locais da pessoa
// (GET /vaccination/my_locations, sem dado pessoal; lido ao abrir) e mostra só os ATIVOS que o `allow` aceita.
// Trocar de local remonta o conteúdo (nada do local anterior sobra). Nada em storage.
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { listMyVaccineLocations, type VaccineLocation } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { locationKindLabel } from "../../lib/pharmacy";
import { NO_VACCINE_LOCATION, STATIC_QUERY, VAC_LOCATIONS_KEY, locationAbilities, vaccinationError } from "../../lib/vaccination";
import { inputStyle } from "../../components/formStyles";
import { EmptyState } from "../../components/EmptyState";
import { alert, fieldLabel, muted, stack } from "../exams/styles";

export type VaccineLocationAllow = (abilities: ReturnType<typeof locationAbilities>, loc: VaccineLocation) => boolean;

export function VaccineLocationPick({ allow, children }: { allow: VaccineLocationAllow; children(loc: VaccineLocation): ReactNode }) {
  const { user } = useAuth();
  const locations = useQuery({
    queryKey: [ VAC_LOCATIONS_KEY, user?.id ?? null ], queryFn: listMyVaccineLocations, enabled: !!user, ...STATIC_QUERY
  });
  const [ locationId, setLocationId ] = useState("");
  if (locations.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (locations.isError && !locations.data) return <p role="alert" style={alert}>{vaccinationError(locations.error)}</p>;
  const options = (locations.data ?? []).filter((l) => l.active && allow(locationAbilities(l), l));
  if (options.length === 0) return <EmptyState title={NO_VACCINE_LOCATION} />;
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
