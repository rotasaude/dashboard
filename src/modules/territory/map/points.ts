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
  // Laço, não Math.min(...lista): a camada do 35a não tem teto, e o espalhamento estoura a pilha com listas enormes.
  let [ west, south, east, north ] = [ points[0].longitude, points[0].latitude, points[0].longitude, points[0].latitude ];
  for (const p of points) {
    if (p.longitude < west) west = p.longitude;
    if (p.longitude > east) east = p.longitude;
    if (p.latitude < south) south = p.latitude;
    if (p.latitude > north) north = p.latitude;
  }
  return [ [ west, south ], [ east, north ] ];
}

// Módulo 35a (Q13(7)): os pontos de uma camada do mapa de endemias, pintados pela categoria. Só id, rótulo e
// categoria vão para o mapa: nunca pessoa nem caso (o rótulo é o do api, D-5).
// `selectedId`: o ponto escolhido sai maior e com o anel da seleção, sem perder a cor da categoria.
export function toCategoryCollection(points: VectorMapPoint[], selectedId: string | null = null): PointCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ p.longitude, p.latitude ] },
      properties: { id: p.id, selected: p.id === selectedId, label: p.label, category: p.category }
    }))
  };
}
