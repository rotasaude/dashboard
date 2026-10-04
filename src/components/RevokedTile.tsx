// api#34: contagem de triagens revogadas no período, à parte — só o número
// (suprimido como as outras contagens), nunca linha. Api antiga sem o campo:
// nada aparece.
import type { SmallCount } from "../lib/types";
import { StatTile } from "./StatTile";

export const REVOKED_HINT = "Triagens revogadas pelo cidadão não entram nas concluídas nem nos tiers.";

export function RevokedTile({ value }: { value: SmallCount | undefined }) {
  if (value === undefined) return null;
  return <StatTile label="Revogadas no período" value={value} tone="neutral" source="live" hint={REVOKED_HINT} />;
}
