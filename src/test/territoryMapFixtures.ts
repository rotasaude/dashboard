// Módulo 24c (ADR 0053): mapa da microárea. Coordenadas fictícias de Curitiba.
import type { FieldMapManifest, Household, HouseholdLocation, MapHousehold, MapHouseholdsResponse } from "../lib/api";
import { household } from "./territoryFixtures";

export const LOC_MAP: HouseholdLocation = { latitude: -25.42851, longitude: -49.2733, source: "map" };
export const LOC_GPS: HouseholdLocation = { latitude: -25.42847123, longitude: -49.27325411, accuracy_m: 8.5, source: "gps" };
export const MAP_MANIFEST: FieldMapManifest = { version: "2026-11-01", size_bytes: 41234567, sha256: "ab".repeat(32) };

export const mapHousehold = (o: Partial<MapHousehold> = {}): MapHousehold => ({
  id: "hh1", location: LOC_GPS, address: { street: "das Flores", number: "120" }, families_count: 1, version: 2, ...o
});
export const mapHouseholds = (o: Partial<MapHouseholdsResponse> = {}): MapHouseholdsResponse => ({
  map: MAP_MANIFEST, items: [ mapHousehold() ], ...o
});
export const householdWithLocation = (o: Partial<Household> = {}): Household => household({ location: LOC_GPS, ...o });
