// Laboratórios em que a sessão atua e o conselho de quem libera (Divergência
// D1). Sem dado clínico; lido uma vez por tela. B32: sem laboratório o api
// responde 200 com `labs: []` — quem usa trata a lista vazia, não é erro.
import { useQuery } from "@tanstack/react-query";
import { getLabContext } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { LAB_CONTEXT_KEY } from "../../lib/lab";

export function useLabContext(enabled: boolean) {
  const { user } = useAuth();
  // Chave por usuário: outra sessão no mesmo navegador não herda o contexto.
  // Fora do refreshLab (muda só pela administração): relê ao montar e após 60 s.
  return useQuery({ queryKey: [ LAB_CONTEXT_KEY, user?.id ?? null ], queryFn: getLabContext, enabled, retry: false, staleTime: 60_000 });
}
