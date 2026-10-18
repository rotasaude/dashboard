// Lote de reagente gravado com o resultado ou o valor de controle (contrato
// §7): número do lote, ou "sem rastreio de reagente" quando o estoque está
// ligado e não havia lote em uso no aparelho e exame. Ausente = nada.
import type { ReagentLotRef } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hasFeature } from "../../lib/features";
import { reagentLotMark } from "../../lib/inventory";
import { Tag } from "../../components/Tag";

export function ReagentLotTag({ row }: { row: { reagent_lot?: ReagentLotRef | null } }) {
  const { user } = useAuth();
  const mark = reagentLotMark(row, hasFeature(user, "lab_inventory"));
  if (!mark) return null;
  return <Tag tone={mark.untraced ? "warn" : "neutral"}>{mark.text}</Tag>;
}
