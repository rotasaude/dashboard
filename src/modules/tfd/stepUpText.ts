// Tradução das recusas nas confirmações com segundo fator do TFD: a recusa local (conferida antes de chamar o api) vai como está;
// a do api vira todas as frases de `tfdRefusals`, sem repetir.
import { tfdRefusals } from "../../lib/tfd";

export class LocalRefusal extends Error {}

export function refusalText(err: unknown): string {
  if (err instanceof LocalRefusal) return err.message;
  return [ ...new Set(tfdRefusals(err).map((r) => r.text)) ].join("; ");
}
