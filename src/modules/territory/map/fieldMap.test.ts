import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  type Handler = (data?: unknown) => void;
  const state = {
    maps: [] as FakeMap[],
    markers: [] as FakeMarker[],
    header: { minLon: -49.39, minLat: -25.65, maxLon: -49.18, maxLat: -25.34 } as Record<string, number> | null
  };

  class FakeSource { data: unknown = null; setData(d: unknown) { this.data = d; } }
  class FakeMap {
    options: { container: HTMLElement; style: { sources: Record<string, { url?: string }>; glyphs: string }; attributionControl: unknown };
    controls: unknown[] = [];
    sources: Record<string, FakeSource> = {};
    sourceSpecs: Record<string, Record<string, unknown>> = {};
    layers: { id: string; [k: string]: unknown }[] = [];
    handlers: { event: string; layer: string | null; cb: Handler }[] = [];
    fitBounds = vi.fn();
    easeTo = vi.fn();
    remove = vi.fn();
    getZoom = () => 12;
    constructor(options: FakeMap["options"]) { this.options = options; state.maps.push(this); }
    addControl(c: unknown) { this.controls.push(c); }
    addSource(id: string, spec: Record<string, unknown>) { this.sourceSpecs[id] = spec; this.sources[id] = new FakeSource(); this.sources[id].data = spec.data; }
    getSource(id: string) { return this.sources[id]; }
    addLayer(layer: { id: string }) { this.layers.push(layer); }
    on(event: string, a: string | Handler, b?: Handler) {
      this.handlers.push(typeof a === "string" ? { event, layer: a, cb: b! } : { event, layer: null, cb: a });
    }
    off(event: string, cb: Handler) { this.handlers = this.handlers.filter((h) => !(h.event === event && h.cb === cb)); }
    // fire("click", dado) dispara os ouvintes do mapa; fire("click", "camada", dado), os da camada.
    fire(event: string, a?: unknown, b?: unknown) {
      const layer = typeof a === "string" ? a : null;
      const data = typeof a === "string" ? b : a;
      for (const h of [ ...this.handlers ]) if (h.event === event && h.layer === layer) h.cb(data);
    }
  }
  class FakeMarker {
    options: unknown; lngLat: [ number, number ] | null = null; added = false; removed = false;
    handlers: Record<string, Handler> = {};
    constructor(options: unknown) { this.options = options; state.markers.push(this); }
    setLngLat(l: [ number, number ]) { this.lngLat = l; return this; }
    getLngLat() { return { lng: this.lngLat![0], lat: this.lngLat![1] }; }
    addTo() { this.added = true; return this; }
    on(event: string, cb: Handler) { this.handlers[event] = cb; return this; }
    remove() { this.removed = true; }
  }
  class AttributionControl { options: unknown; constructor(options: unknown) { this.options = options; } }
  class NavigationControl { options: unknown; constructor(options: unknown) { this.options = options; } }
  return { state, FakeMap, FakeMarker, AttributionControl, NavigationControl };
});

vi.mock("maplibre-gl", () => ({
  Map: fake.FakeMap, Marker: fake.FakeMarker, AttributionControl: fake.AttributionControl, NavigationControl: fake.NavigationControl,
  addProtocol: vi.fn(), setWorkerUrl: vi.fn()
}));
vi.mock("pmtiles", () => ({
  Protocol: class { tile = vi.fn(); add = vi.fn(); },
  PMTiles: class {
    url: string;
    constructor(url: string) { this.url = url; }
    getHeader() { return fake.state.header ? Promise.resolve(fake.state.header) : Promise.reject(new Error("404")); }
  }
}));
vi.mock("./worker", () => ({ workerUrl: "/dashboard/assets/maplibre-gl-worker.js" }));

import * as maplibregl from "maplibre-gl";
import { createFieldMap } from "./fieldMap";
import type { PointCollection } from "./points";

const OPTS = { mapUrl: "http://curitiba.localhost:5218/territory/map", base: "/dashboard/", colors: { point: "blue", selected: "red", outline: "white" } };
const div = () => document.createElement("div");
const lastMap = () => fake.state.maps[fake.state.maps.length - 1];
const lastMarker = () => fake.state.markers[fake.state.markers.length - 1];
const settle = () => new Promise((r) => setTimeout(r, 0));
const POINTS: PointCollection = {
  type: "FeatureCollection",
  features: [ { type: "Feature", geometry: { type: "Point", coordinates: [ -49.27, -25.42 ] }, properties: { id: "hh-1", selected: false, label: "das Flores, 120" } } ]
};

describe("createFieldMap (24c)", () => {
  beforeEach(() => {
    fake.state.maps.length = 0;
    fake.state.markers.length = 0;
    fake.state.header = { minLon: -49.39, minLat: -25.65, maxLon: -49.18, maxLat: -25.34 };
  });

  it("protocolo pmtiles e worker uma vez; estilo local; atribuição visível", () => {
    createFieldMap(div(), OPTS); createFieldMap(div(), OPTS);
    expect(maplibregl.addProtocol).toHaveBeenCalledTimes(1);
    expect(vi.mocked(maplibregl.addProtocol).mock.calls[0][0]).toBe("pmtiles");
    expect(maplibregl.setWorkerUrl).toHaveBeenCalledTimes(1);
    expect(maplibregl.setWorkerUrl).toHaveBeenCalledWith("/dashboard/assets/maplibre-gl-worker.js");
    expect(lastMap().options.style.sources.protomaps.url).toBe(`pmtiles://${OPTS.mapUrl}`);
    expect(lastMap().options.style.glyphs).toBe("/dashboard/map/fonts/{fontstack}/{range}.pbf");
    expect(lastMap().options.attributionControl).toBe(false);
    const attribution = lastMap().controls.find((c) => c instanceof maplibregl.AttributionControl) as unknown as { options: unknown };
    expect(attribution.options).toEqual({ compact: false });
  });

  it("ao carregar: fonte agrupada dos domicílios e as duas camadas, com as cores do tema", () => {
    createFieldMap(div(), OPTS);
    lastMap().fire("load");
    expect(lastMap().sourceSpecs.households).toMatchObject({ type: "geojson", cluster: true, clusterRadius: 40 });
    expect(lastMap().layers.map((l) => l.id)).toEqual([ "households-clusters", "households-points" ]);
    expect(JSON.stringify(lastMap().layers)).toContain('"red"');
    expect(JSON.stringify(lastMap().layers)).toContain('"blue"');
    expect(lastMap().layers.every((l) => (l.paint as Record<string, unknown>)["circle-stroke-color"] === "white")).toBe(true);
  });

  it("setPoints antes e depois do carregamento chega à fonte", () => {
    const h = createFieldMap(div(), OPTS);
    h.setPoints(POINTS);
    lastMap().fire("load");
    expect(lastMap().sources.households.data).toEqual(POINTS);
    const empty: PointCollection = { type: "FeatureCollection", features: [] };
    h.setPoints(empty);
    expect(lastMap().sources.households.data).toEqual(empty);
  });

  it("fitTo enquadra os pontos, sem animação e sem zoom exagerado", () => {
    const h = createFieldMap(div(), OPTS);
    h.fitTo([ [ -49.3, -25.5 ], [ -49.2, -25.4 ] ]);
    expect(lastMap().fitBounds).toHaveBeenCalledWith([ [ -49.3, -25.5 ], [ -49.2, -25.4 ] ], { padding: 48, maxZoom: 17, animate: false });
  });

  it("sem pontos, enquadra a área do arquivo do mapa; com pontos, o arquivo não desfaz o enquadramento", async () => {
    createFieldMap(div(), OPTS);
    await settle();
    expect(lastMap().fitBounds).toHaveBeenCalledWith([ [ -49.39, -25.65 ], [ -49.18, -25.34 ] ], { animate: false });

    const h = createFieldMap(div(), OPTS);
    h.fitTo([ [ -49.3, -25.5 ], [ -49.2, -25.4 ] ]);
    await settle();
    expect(lastMap().fitBounds).toHaveBeenCalledTimes(1);
  });

  it("arquivo do mapa inalcançável não derruba a tela", async () => {
    fake.state.header = null;
    createFieldMap(div(), OPTS);
    await settle();
    expect(lastMap().fitBounds).not.toHaveBeenCalled();
  });

  it("clique num ponto devolve o id; clique num grupo aproxima; destroy remove o mapa", () => {
    const h = createFieldMap(div(), OPTS); const clicked = vi.fn();
    h.onPointClick(clicked);
    lastMap().fire("load");
    lastMap().fire("click", "households-points", { features: [ { properties: { id: "hh-1" } } ] });
    expect(clicked).toHaveBeenCalledWith("hh-1");
    lastMap().fire("click", "households-clusters", { lngLat: { lng: -49.27, lat: -25.42 } });
    expect(lastMap().easeTo).toHaveBeenCalledWith({ center: [ -49.27, -25.42 ], zoom: 14 });
    h.destroy();
    expect(lastMap().remove).toHaveBeenCalledTimes(1);
  });

  it("correção: clique e arrasto devolvem coordenadas com 8 casas", () => {
    const h = createFieldMap(div(), OPTS); const moved = vi.fn();
    h.startCorrection({ latitude: -25.42851, longitude: -49.2733 }, moved);
    expect(lastMarker().options).toEqual({ draggable: true });
    expect(lastMarker().lngLat).toEqual([ -49.2733, -25.42851 ]);
    expect(lastMarker().added).toBe(true);

    lastMap().fire("click", { lngLat: { lat: -25.428471234567, lng: -49.273254119999 } });
    expect(moved).toHaveBeenLastCalledWith({ latitude: -25.42847123, longitude: -49.27325412 });
    expect(lastMarker().lngLat).toEqual([ -49.27325412, -25.42847123 ]);

    lastMarker().setLngLat([ -49.111111119, -25.222222229 ]);
    lastMarker().handlers.dragend();
    expect(moved).toHaveBeenLastCalledWith({ latitude: -25.22222223, longitude: -49.11111112 });
  });

  it("durante a correção, clicar num ponto não troca a seleção; ao parar, o marcador sai e o clique volta a selecionar", () => {
    const h = createFieldMap(div(), OPTS); const clicked = vi.fn(); const moved = vi.fn();
    h.onPointClick(clicked);
    lastMap().fire("load");
    h.startCorrection({ latitude: -25.4, longitude: -49.2 }, moved);
    lastMap().fire("click", "households-points", { features: [ { properties: { id: "hh-2" } } ] });
    expect(clicked).not.toHaveBeenCalled();

    h.stopCorrection();
    expect(lastMarker().removed).toBe(true);
    lastMap().fire("click", { lngLat: { lat: -25.5, lng: -49.3 } });
    expect(moved).not.toHaveBeenCalled();
    lastMap().fire("click", "households-points", { features: [ { properties: { id: "hh-2" } } ] });
    expect(clicked).toHaveBeenCalledWith("hh-2");
  });

  it("começar outra correção troca o marcador, sem deixar dois no mapa", () => {
    const h = createFieldMap(div(), OPTS);
    h.startCorrection({ latitude: -25.4, longitude: -49.2 }, vi.fn());
    const first = lastMarker();
    h.startCorrection({ latitude: -25.5, longitude: -49.3 }, vi.fn());
    expect(first.removed).toBe(true);
    expect(fake.state.markers).toHaveLength(2);
  });
});
