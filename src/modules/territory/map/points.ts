// Módulo 24c (ADR 0053): os pontos dos domicílios no mapa da microárea.
// Funções puras, sem MapLibre. Nada de pessoa: o rótulo é só rua e número.
import type { MapHousehold } from "../../../lib/api";

export type PointProperties = { id: string; selected: boolean; label: string };
export type PointCollection = GeoJSON.FeatureCollection<GeoJSON.Point, PointProperties>;
export type Bounds = [ [ number, number ], [ number, number ] ];

// O api e o LEDI aceitam até 8 casas; o MapLibre devolve muito mais.
export const roundCoord = (n: number): number => Number(n.toFixed(8));

// Endereço curto de um ponto: rua e número, nunca nome de pessoa.
export const pointLabel = (h: Pick<MapHousehold, "address">): string => {
  const number = h.address.number || "S/N";
  return h.address.street ? `${h.address.street}, ${number}` : number;
};

export function toFeatureCollection(items: MapHousehold[], selectedId: string | null): PointCollection {
  return {
    type: "FeatureCollection",
    features: items.map((h) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ h.location.longitude, h.location.latitude ] },
      properties: { id: h.id, selected: h.id === selectedId, label: pointLabel(h) }
    }))
  };
}

// [[oeste, sul], [leste, norte]], para enquadrar o mapa nos pontos.
export function boundsOf(items: MapHousehold[]): Bounds | null {
  if (items.length === 0) return null;
  const lng = items.map((h) => h.location.longitude);
  const lat = items.map((h) => h.location.latitude);
  return [ [ Math.min(...lng), Math.min(...lat) ], [ Math.max(...lng), Math.max(...lat) ] ];
}
