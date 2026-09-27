// QueryClient do app autenticado. Fronteira de sessão (F-05.2): um 401 em
// qualquer painel avisa o AuthProvider, que relê a sessão e devolve ao Login.
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api";

export function createAppQueryClient(onUnauthorized: () => void) {
  return new QueryClient({
    queryCache: new QueryCache({
      onError(err) {
        if (err instanceof ApiError && err.status === 401) onUnauthorized();
      }
    }),
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          if (err instanceof ApiError && (err.status === 401 || err.status === 404)) return false;
          return count < 1;
        },
        staleTime: 30_000
      }
    }
  });
}
