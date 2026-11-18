// Módulo 24c (ADR 0053): os pontos dos domicílios no mapa da microárea.
// Funções puras, sem MapLibre. Nada de pessoa: o rótulo é só rua e número.
import type { MapHousehold, VectorMapPoint } from "../../../lib/api";

// `category` (35a): a cor do ponto pela camada; o 24c não a usa.
export type PointProperties = { id: string; selected: boolean; label: string; category?: string };
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
  return boundsOfPoints(items.map((h) => h.location));
}

export function boundsOfPoints(points: readonly { latitude: number; longitude: number }[]): Bounds | null {
  if (points.length === 0) return null;
  const lng = points.map((p) => p.longitude);
  const lat = points.map((p) => p.latitude);
  return [ [ Math.min(...lng), Math.min(...lat) ], [ Math.max(...lng), Math.max(...lat) ] ];
}

// Módulo 35a (Q13(7)): os pontos de uma camada do mapa de endemias, pintados pela categoria. Só id, rótulo e
// categoria vão para o mapa: nunca pessoa nem caso (o rótulo é o do api, D-5).
export function toCategoryCollection(points: VectorMapPoint[]): PointCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ p.longitude, p.latitude ] },
      properties: { id: p.id, selected: false, label: p.label, category: p.category }
    }))
  };
}
