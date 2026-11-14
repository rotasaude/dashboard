// O MapLibre 6 procura o arquivo do worker ao lado do próprio módulo
// (import.meta.url); depois do empacotamento do Vite esse vizinho não existe.
// `?worker&url` faz o Vite empacotar o worker e devolver a URL dele, do próprio
// dashboard — nada vem de CDN.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

export { workerUrl };
