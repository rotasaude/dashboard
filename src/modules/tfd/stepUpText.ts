// Tradução das recusas nas confirmações do TFD: a recusa local (conferida antes de chamar o api) vai como está; a do api vira todas as
// frases de `tfdRefusals`, sem repetir. As peças vêm de lib/transport (uma fonte só, C9). Recusa de processo que mudou relê a fila da
// comissão e os meus pedidos (`useTfdRefusalText`, C7), como as telas do transporte.
import { useQueryClient } from "@tanstack/react-query";
import { errorCode } from "../../lib/api";
import { TFD_CASES_KEY, TFD_MY_CASES_KEY, TFD_STALE_CODES, tfdRefusals } from "../../lib/tfd";
import { LocalRefusal, refusalTexts } from "../../lib/transport";

export { LocalRefusal };

export function refusalText(err: unknown): string {
  return refusalTexts(err, tfdRefusals);
}

export function useTfdStale(): (err: unknown) => void {
  const queryClient = useQueryClient();
  return (err) => {
    if (!TFD_STALE_CODES.includes(errorCode(err) ?? "")) return;
    void queryClient.invalidateQueries({ queryKey: [ TFD_CASES_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ TFD_MY_CASES_KEY ] });
  };
}

export function useTfdRefusalText(): (err: unknown) => string {
  const stale = useTfdStale();
  return (err) => { stale(err); return refusalText(err); };
}
