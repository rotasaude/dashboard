// Domínios do centro de zoonoses (rótulos e limites). Estáticos: uma leitura por tela, sem trilha.
import { useQuery } from "@tanstack/react-query";
import { getZoonosesDomains } from "../../lib/api";
import { STATIC_QUERY, ZOO_DOMAINS_KEY } from "../../lib/zoonoses";

export function useZooDomains() {
  return useQuery({ queryKey: [ ZOO_DOMAINS_KEY ], queryFn: getZoonosesDomains, ...STATIC_QUERY });
}
