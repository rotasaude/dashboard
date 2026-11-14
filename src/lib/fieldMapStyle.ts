// Estilo do mapa de campo no dashboard (módulo 24c, F-24.20; contrato §6, Q11,
// Q18). O estilo vem do domínio map-style do contracts (cópia presa por lock em
// src/lib/vendor/map-style/, só o tema claro) com três marcadores, trocados
// aqui: o arquivo do mapa (o PMTiles da cidade, servido pelo api em
// /territory/map), as fontes e os ícones (public/map/, do próprio dashboard).
// Nenhuma URL de terceiros: o mapa não chama serviço de fora.
import type { StyleSpecification } from "maplibre-gl";
import vendored from "./vendor/map-style/style-light.json";

export function fieldMapStyle(opts: { base: string; mapUrl: string }): StyleSpecification {
  const style = structuredClone(vendored) as unknown as StyleSpecification;
  const source = style.sources.protomaps as { url?: string };
  source.url = `pmtiles://${opts.mapUrl}`;
  style.glyphs = `${opts.base}map/fonts/{fontstack}/{range}.pbf`;
  style.sprite = `${opts.base}map/sprites/light`;
  return style;
}
