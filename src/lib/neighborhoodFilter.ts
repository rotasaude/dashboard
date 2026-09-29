// Filtro de bairro dos painéis com cidadão (módulo 11; spec 2026-09-28 §5).
// Vale para todo papel que lê os painéis. Mora na URL (?bairro=<uuid> ou
// ?bairro=none) para sobreviver a recarregar a página e valer nos cinco
// painéis; "Todos" = sem o parâmetro. O cache do TanStack já é por usuário
// (useSessionQueryClient): a chave leva o bairro, nunca o usuário.
import { useSyncExternalStore } from "react";

export type NeighborhoodFilter = string | null;
export const NONE = "none";
export const PANEL_NEIGHBORHOODS_KEY = [ "panelNeighborhoods" ] as const;

const PARAM = "bairro";
const EVENT = "rotasaude:bairro";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lixo na URL vira "Todos": mandar para a API seria um 422 invalid_neighborhood.
export function readNeighborhoodParam(search: string = window.location.search): NeighborhoodFilter {
  const raw = new URLSearchParams(search).get(PARAM)?.trim() ?? "";
  return raw === NONE || UUID.test(raw) ? raw : null;
}

// replaceState: trocar o bairro não é navegação; o "voltar" do navegador
// continua saindo da página.
export function writeNeighborhoodParam(value: NeighborhoodFilter): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(PARAM, value);
  else url.searchParams.delete(PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("popstate", onChange);
  };
}

export function useNeighborhoodParam(): NeighborhoodFilter {
  return useSyncExternalStore(subscribe, () => readNeighborhoodParam());
}

// Nome próprio para o que os hooks consomem: se um dia o filtro depender de
// mais que a URL, muda só aqui.
export function useNeighborhoodFilter(): NeighborhoodFilter {
  return useNeighborhoodParam();
}

export function neighborhoodParams(filter: NeighborhoodFilter): Record<string, string | undefined> {
  return { neighborhood_id: filter ?? undefined };
}
