// Um QueryClient por usuário logado (F-05.2 estendida): o cache do TanStack
// Query não pode sobreviver a uma troca de usuário na mesma aba. Sem isto, o
// AppRoot criava um único client para o tempo de vida da aba (useState), e
// dados em cache do usuário anterior podiam aparecer por até staleTime (30 s)
// quando outro usuário logava na sequência. Aqui, trocar o userId (login →
// logout → outro login) cria um client novo e limpa (`clear()`) o anterior
// de imediato, na própria renderização — nunca serve dado de A para B, nem
// por um frame. Enquanto o userId não muda (reload() após step-up, refresh
// de sessão), o mesmo client é devolvido, preservando o cache do usuário.
import { useRef } from "react";
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
    const previous = sessionRef.current;
    const client = createAppQueryClient(() => onUnauthorizedRef.current());
    sessionRef.current = { userId, client };
    if (previous) previous.client.clear();
  }

  return sessionRef.current.client;
}
