// Módulo 35a: o mapa de uma camada da vigilância ambiental, sobre o adaptador do 24c. Carregado por React.lazy — o
// MapLibre só entra no navegador de quem abre um mapa. Cada ponto é marcado pela categoria (sem agrupamento: a marca
// de cada imóvel é o dado); o adaptador monta uma vez por camada e desmonta ao sair. O ponto escolhido ganha o anel.
import { useEffect, useRef } from "react";
import { fieldMapUrl, type VectorMapPoint } from "../../lib/api";
import type { VectorMapLayer } from "../../lib/vectorControl";
import { mapColors } from "../../lib/vectorMap";
import { createFieldMap, type FieldMapHandle } from "../territory/map/fieldMap";
import { boundsOfPoints, toCategoryCollection } from "../territory/map/points";

export default function VectorMap({ points, layer, label, selectedId = null, onSelect }: {
  points: VectorMapPoint[]; layer: VectorMapLayer; label: string; selectedId?: string | null; onSelect?(id: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<FieldMapHandle | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    // As cores são os papéis do tema, lidos do elemento: o MapLibre não entende var(--x).
    const css = getComputedStyle(el);
    const colors = mapColors(layer, (name) => css.getPropertyValue(name).trim());
    const map = createFieldMap(el, { mapUrl: fieldMapUrl(), base: import.meta.env.BASE_URL, cluster: false, colors });
    map.onPointClick((id) => select.current?.(id));
    handle.current = map;
    return () => { handle.current = null; map.destroy(); };
  }, [ layer ]);

  useEffect(() => {
    handle.current?.setPoints(toCategoryCollection(points, selectedId));
  }, [ points, layer, selectedId ]);

  // Enquadra ao chegar os pontos; escolher um ponto não move o mapa.
  useEffect(() => {
    const bounds = boundsOfPoints(points);
    if (bounds) handle.current?.fitTo(bounds);
  }, [ points, layer ]);

  return (
    <div ref={container} role="application" aria-label={label}
      style={{ height: "min(60vh, 480px)", borderRadius: 8, border: "1px solid var(--rule)", overflow: "hidden" }} />
  );
}
