// Tradução das recusas nas confirmações com segundo fator do TFD: a recusa local (conferida antes de chamar o api) vai como está;
// a do api vira todas as frases de `tfdRefusals`, sem repetir. As peças vêm de lib/transport (uma fonte só, C9).
import { tfdRefusals } from "../../lib/tfd";
import { LocalRefusal, refusalTexts } from "../../lib/transport";

export { LocalRefusal };

export function refusalText(err: unknown): string {
  return refusalTexts(err, tfdRefusals);
}
