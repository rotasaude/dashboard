// src/modules/regulation/ColorCell.tsx
// A cor que ordena a fila: a confirmada pelo regulador, ou a sugerida enquanto ele não confirmou. Quando ainda é a sugerida,
// um texto pequeno ao lado diz isso; cor só por papéis do tema (Tag).
import type { RegulationRequest } from "../../lib/api";
import { colorLabel, colorTone, effectiveColor } from "../../lib/regulation";
import { Tag } from "../../components/Tag";

const suggestedNote = { fontSize: 11, color: "var(--ink3)" } as const;
const wrap = { display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" } as const;

export function ColorCell({ request }: { request: Pick<RegulationRequest, "color" | "suggested_color"> }) {
  const color = effectiveColor(request);
  return (
    <span style={wrap}>
      <Tag tone={colorTone(color)}>{colorLabel(color)}</Tag>
      {!request.color && <span style={suggestedNote}>sugerida</span>}
    </span>
  );
}
