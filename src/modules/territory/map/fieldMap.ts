// Módulo 24c (ADR 0053; contrato §6): o único arquivo do dashboard que fala
// com o MapLibre. O mapa é o arquivo PMTiles da cidade, servido pelo próprio
// Rota Saúde em /territory/map e lido por faixas de bytes; estilo, fontes e
// ícones são do dashboard. Nenhum serviço de mapa de terceiros é chamado.
//
// Sigilo: a coordenada só sai daqui pelo `onMove` de quem pediu a correção —
// nunca vai para log, URL ou mensagem de erro.
import {
  AttributionControl, Map as MapLibreMap, Marker, NavigationControl, addProtocol, setWorkerUrl,
  type GeoJSONSource, type MapLayerMouseEvent, type MapMouseEvent
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { PMTiles, Protocol } from "pmtiles";
import { fieldMapStyle } from "../../../lib/fieldMapStyle";
import { roundCoord, type Bounds, type PointCollection } from "./points";
import { workerUrl } from "./worker";

export type LatLng = { latitude: number; longitude: number };

export interface FieldMapHandle {
  setPoints(fc: PointCollection): void;
  fitTo(bounds: Bounds): void;
  onPointClick(cb: (id: string) => void): void;
  startCorrection(from: LatLng, onMove: (to: LatLng) => void): void;
  stopCorrection(): void;
  destroy(): void;
}

// O mapa é sempre claro (Q18), em qualquer tema do dashboard: o contorno
// (`outline`) é o que mantém o ponto legível quando a cor do tema é clara.
export type FieldMapOptions = { mapUrl: string; base: string; colors: { point: string; selected: string; outline: string } };

const SOURCE = "households";
const EMPTY: PointCollection = { type: "FeatureCollection", features: [] };

// O protocolo e o worker são da página, não do mapa: registram-se uma vez.
let protocol: Protocol | null = null;
function pmtilesProtocol(): Protocol {
  if (!protocol) {
    protocol = new Protocol();
    setWorkerUrl(workerUrl);
    addProtocol("pmtiles", protocol.tile);
  }
  return protocol;
}

export function createFieldMap(container: HTMLElement, opts: FieldMapOptions): FieldMapHandle {
  const archive = new PMTiles(opts.mapUrl);
  pmtilesProtocol().add(archive);

  const map = new MapLibreMap({
    container,
    // O MapLibre recusa sprite com URL relativa: a base vira absoluta, no próprio host.
    style: fieldMapStyle({ base: new URL(opts.base, window.location.origin).href, mapUrl: opts.mapUrl }),
    attributionControl: false
  });
  // A atribuição do OpenStreetMap fica sempre visível (licença ODbL).
  map.addControl(new AttributionControl({ compact: false }));
  map.addControl(new NavigationControl({ showCompass: false }));

  let loaded = false;
  let framed = false;
  let points: PointCollection = EMPTY;
  let pointClick: ((id: string) => void) | null = null;
  let marker: Marker | null = null;
  let mapClick: ((e: MapMouseEvent) => void) | null = null;

  map.on("load", () => {
    loaded = true;
    map.addSource(SOURCE, { type: "geojson", data: points, cluster: true, clusterRadius: 40 });
    map.addLayer({
      id: "households-clusters", type: "circle", source: SOURCE, filter: [ "has", "point_count" ],
      paint: {
        "circle-color": opts.colors.point, "circle-opacity": 0.85,
        "circle-radius": [ "step", [ "get", "point_count" ], 14, 10, 18, 50, 24 ],
        "circle-stroke-width": 2, "circle-stroke-color": opts.colors.outline
      }
    });
    map.addLayer({
      id: "households-points", type: "circle", source: SOURCE, filter: [ "!", [ "has", "point_count" ] ],
      paint: {
        "circle-color": [ "case", [ "get", "selected" ], opts.colors.selected, opts.colors.point ],
        "circle-radius": [ "case", [ "get", "selected" ], 9, 6 ],
        "circle-stroke-width": 2, "circle-stroke-color": opts.colors.outline
      }
    });
  });

  map.on("click", "households-points", (e: MapLayerMouseEvent) => {
    if (marker) return; // corrigindo um ponto: o clique move o marcador, não troca a seleção
    const id = e.features?.[0]?.properties?.id;
    if (typeof id === "string") pointClick?.(id);
  });
  map.on("click", "households-clusters", (e: MapLayerMouseEvent) => {
    map.easeTo({ center: [ e.lngLat.lng, e.lngLat.lat ], zoom: map.getZoom() + 2 });
  });

  // Sem ponto para enquadrar, o mapa abre na área do arquivo (a cidade), não
  // no mundo. Arquivo inalcançável: o mapa fica vazio e a tela segue.
  archive.getHeader().then((h) => {
    if (framed) return;
    map.fitBounds([ [ h.minLon, h.minLat ], [ h.maxLon, h.maxLat ] ], { animate: false });
  }).catch(() => undefined);

  function stopCorrection() {
    marker?.remove();
    marker = null;
    if (mapClick) map.off("click", mapClick);
    mapClick = null;
  }

  return {
    setPoints(fc) {
      points = fc;
      if (loaded) (map.getSource(SOURCE) as GeoJSONSource | undefined)?.setData(fc);
    },
    fitTo(bounds) {
      framed = true;
      map.fitBounds(bounds, { padding: 48, maxZoom: 17, animate: false });
    },
    onPointClick(cb) { pointClick = cb; },
    startCorrection(from, onMove) {
      stopCorrection();
      const pin = new Marker({ draggable: true }).setLngLat([ from.longitude, from.latitude ]).addTo(map);
      const report = (lng: number, lat: number) => onMove({ latitude: roundCoord(lat), longitude: roundCoord(lng) });
      pin.on("dragend", () => { const at = pin.getLngLat(); report(at.lng, at.lat); });
      mapClick = (e) => {
        pin.setLngLat([ roundCoord(e.lngLat.lng), roundCoord(e.lngLat.lat) ]);
        report(e.lngLat.lng, e.lngLat.lat);
      };
      map.on("click", mapClick);
      marker = pin;
    },
    stopCorrection,
    destroy() {
      stopCorrection();
      map.remove();
    }
  };
}
