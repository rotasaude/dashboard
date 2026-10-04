// api#34: contagem de triagens revogadas no período, à parte — só o número,
// nunca linha. Some quando a api não manda o campo (api antiga) ou manda null
// (filtro de bairro ligado: a revogada anonimizada perde o bairro). O texto
// de ajuda é de cada painel: diz de quais números a revogada sai.
import type { SmallCount } from "../lib/types";
import { StatTile } from "./StatTile";

export function RevokedTile({ value, hint }: { value: SmallCount | null | undefined; hint: string }) {
  if (value == null) return null;
  return <StatTile label="Revogadas no período" value={value} tone="neutral" source="live" hint={hint} />;
}
