// Módulo 24c (ADR 0053): o mapa da microárea. Carregado por React.lazy — o
// MapLibre só entra no navegador de quem abre esta tela. Monta o adaptador
// uma vez por microárea e o desmonta ao sair; os pontos e a seleção chegam
// por propriedade.
import { useEffect, useRef } from "react";
import type { MapHousehold } from "../../../lib/api";
import { fieldMapUrl } from "../../../lib/api";
import { createFieldMap, type FieldMapHandle, type LatLng } from "./fieldMap";
import { boundsOf, toFeatureCollection } from "./points";

export type Correction = { from: LatLng; onMove(to: LatLng): void };

// As cores são os papéis do tema, lidos do elemento: o MapLibre não entende var(--x).
function themeColors(el: HTMLElement) {
  const css = getComputedStyle(el);
  const role = (name: string) => css.getPropertyValue(name).trim();
  return { point: role("--accent"), selected: role("--ink"), outline: role("--panel") };
}

export default function MicroAreaMap({ items, selectedId, onSelect, correction }: {
  items: MapHousehold[]; selectedId: string | null; onSelect(id: string): void; correction?: Correction | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<FieldMapHandle | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const map = createFieldMap(el, { mapUrl: fieldMapUrl(), base: import.meta.env.BASE_URL, colors: themeColors(el) });
    map.onPointClick((id) => select.current(id));
    handle.current = map;
    return () => { handle.current = null; map.destroy(); };
  }, []);

  useEffect(() => {
    handle.current?.setPoints(toFeatureCollection(items, selectedId));
  }, [ items, selectedId ]);

  // Enquadra a microárea ao abrir e o domicílio escolhido ao selecionar.
  useEffect(() => {
    const chosen = items.filter((h) => h.id === selectedId);
    const bounds = boundsOf(chosen.length > 0 ? chosen : items);
    if (bounds) handle.current?.fitTo(bounds);
  }, [ items, selectedId ]);

  useEffect(() => {
    if (!correction) return;
    handle.current?.startCorrection(correction.from, correction.onMove);
    return () => handle.current?.stopCorrection();
  }, [ correction ]);

  return (
    <div ref={container} role="application" aria-label="Mapa da microárea"
      style={{ height: "min(60vh, 480px)", borderRadius: 8, border: "1px solid var(--rule)", overflow: "hidden" }} />
  );
}
