// Módulo 35a: o mapa de uma camada da vigilância ambiental, sobre o adaptador do 24c. Carregado por React.lazy — o
// MapLibre só entra no navegador de quem abre um mapa. Cada ponto é pintado pela categoria (sem agrupamento: a cor
// de cada imóvel é o dado); o adaptador monta uma vez por camada e desmonta ao sair.
import { useEffect, useRef } from "react";
import { fieldMapUrl, type VectorMapPoint } from "../../lib/api";
import type { VectorMapLayer } from "../../lib/vectorControl";
import { createFieldMap, type FieldMapHandle } from "../territory/map/fieldMap";
import { boundsOfPoints, toCategoryCollection } from "../territory/map/points";
import { CATEGORY_COLORS, POINT_COLOR } from "./VectorMapPanel";

// As cores são os papéis do tema, lidos do elemento: o MapLibre não entende var(--x).
function themeColors(el: HTMLElement, layer: VectorMapLayer) {
  const css = getComputedStyle(el);
  const role = (name: string) => css.getPropertyValue(name).trim();
  const categories = Object.fromEntries(Object.entries(CATEGORY_COLORS[layer]).map(([ category, name ]) => [ category, role(name) ]));
  return { point: role(POINT_COLOR), selected: role("--ink"), outline: role("--panel"), categories };
}

export default function VectorMap({ points, layer, label, onSelect }: {
  points: VectorMapPoint[]; layer: VectorMapLayer; label: string; onSelect?(id: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<FieldMapHandle | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const map = createFieldMap(el, { mapUrl: fieldMapUrl(), base: import.meta.env.BASE_URL, cluster: false, colors: themeColors(el, layer) });
    map.onPointClick((id) => select.current?.(id));
    handle.current = map;
    return () => { handle.current = null; map.destroy(); };
  }, [ layer ]);

  useEffect(() => {
    handle.current?.setPoints(toCategoryCollection(points));
    const bounds = boundsOfPoints(points);
    if (bounds) handle.current?.fitTo(bounds);
  }, [ points, layer ]);

  return (
    <div ref={container} role="application" aria-label={label}
      style={{ height: "min(60vh, 480px)", borderRadius: 8, border: "1px solid var(--rule)", overflow: "hidden" }} />
  );
}
