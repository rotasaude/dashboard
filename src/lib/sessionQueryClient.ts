// Um QueryClient por usuário logado (F-05.2 estendida): o cache do TanStack
// Query não pode sobreviver a uma troca de usuário na mesma aba. Sem isto, o
// AppRoot criava um único client para o tempo de vida da aba (useState), e
// dados em cache do usuário anterior podiam aparecer por até staleTime (30 s)
// quando outro usuário logava na sequência. Aqui, trocar o userId (login →
// logout → outro login) cria um client novo já durante a renderização
// (barato, sem efeito colateral observável fora do componente), mas a
// limpeza destrutiva do client anterior (`clear()`/`unmount()`) só acontece
// depois do commit, num useEffect — uma renderização pode ser descartada
// (StrictMode, render concorrente interrompido, transição que nunca comita),
// e limpar o cache nesse momento apagaria dados de uma troca que nunca
// chegou a valer. O efeito compara o client devolvido com o último client
// efetivamente commitado: só limpa quando eles diferem, então uma
// renderização repetida com o mesmo userId (inclusive o duplo-invoke de
// efeitos do StrictMode) nunca limpa o client vigente.
import { useEffect, useRef } from "react";
import { QueryClient } from "@tanstack/react-query";
import { createAppQueryClient } from "./queryClient";

export function useSessionQueryClient(
  userId: string | null,
  onUnauthorized: () => void
): QueryClient {
  // ref para o callback mais recente: mudar a identidade de onUnauthorized
  // (ex.: closure recriada em cada render de AppRoot) não deve recriar o
  // client nem disparar limpeza de cache.
  const onUnauthorizedRef = useRef(onUnauthorized);
  onUnauthorizedRef.current = onUnauthorized;

  const sessionRef = useRef<{ userId: string | null; client: QueryClient } | null>(null);

  if (sessionRef.current === null || sessionRef.current.userId !== userId) {
    sessionRef.current = { userId, client: createAppQueryClient(() => onUnauthorizedRef.current()) };
  }

  const client = sessionRef.current.client;

  // Só roda (e só limpa) depois que `client` é o que de fato comitou.
  const committedRef = useRef<QueryClient | null>(null);
  useEffect(() => {
    const previouslyCommitted = committedRef.current;
    if (previouslyCommitted && previouslyCommitted !== client) {
      previouslyCommitted.clear();
      previouslyCommitted.unmount();
    }
    committedRef.current = client;
  }, [ client ]);

  return client;
}
