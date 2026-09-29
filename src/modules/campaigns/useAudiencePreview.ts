import { useQuery } from "@tanstack/react-query";
import { previewAudience, type Audience } from "../../lib/api";
import { PREVIEW_DEBOUNCE_MS, PREVIEW_KEY, campaignError } from "../../lib/campaigns";
import { useDebouncedValue } from "../../lib/useDebouncedValue";

export type PreviewState =
  | { kind: "incomplete" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "below_minimum" }
  | { kind: "ok"; citizens: number; phones: number };

// Contagem ao vivo (spec §7). O público vira uma chave de texto, e só a chave
// que ficou parada por `delayMs` chega à API. Enquanto a chave digitada não é
// a consultada, o estado é "loading" — nunca a contagem do público anterior,
// que liberaria o envio de um público que ninguém contou.
export function useAudiencePreview(audience: Audience | null, delayMs: number = PREVIEW_DEBOUNCE_MS): PreviewState {
  const key = audience ? JSON.stringify(audience) : null;
  const settledKey = useDebouncedValue(key, delayMs);
  const query = useQuery({
    queryKey: [ ...PREVIEW_KEY, settledKey ],
    queryFn: () => previewAudience(JSON.parse(settledKey as string) as Audience),
    enabled: settledKey !== null,
    retry: false
  });

  if (key === null) return { kind: "incomplete" };
  if (settledKey !== key) return { kind: "loading" };
  if (query.isPending) return { kind: "loading" };
  if (query.isError) return { kind: "error", message: campaignError(query.error) };
  if ("below_minimum" in query.data) return { kind: "below_minimum" };
  return { kind: "ok", citizens: query.data.citizens, phones: query.data.phones };
}
