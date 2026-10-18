// Lote de reagente gravado com o resultado ou o valor de controle (contrato
// §7): número do lote, ou "sem rastreio de reagente" quando o estoque está
// ligado e não havia lote em uso no aparelho e exame. Ausente ou estoque
// desligado = nada (Task 12: com os interruptores desligados o 21b fica igual).
import type { ReagentLotRef } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { hasFeature } from "../../lib/features";
import { reagentLotMark } from "../../lib/inventory";
import { Tag } from "../../components/Tag";

// `spaced`: um espaço antes da marca (listas de texto corrido), só quando ela aparece.
export function ReagentLotTag({ row, spaced = false }: { row: { reagent_lot?: ReagentLotRef | null }; spaced?: boolean }) {
  const { user } = useAuth();
  const mark = reagentLotMark(row, hasFeature(user, "lab_inventory"));
  if (!mark) return null;
  const tag = <Tag tone={mark.untraced ? "warn" : "neutral"}>{mark.text}</Tag>;
  return spaced ? <> {tag}</> : tag;
}
