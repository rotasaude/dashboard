// Prazo da manifestação (módulo 33): o texto da cor sempre vem junto do tom, nunca só a cor. Sem cor (estado final), nada.
import { Tag } from "../../components/Tag";
import type { DeadlineColor } from "../../lib/api";
import { COLOR_TONE, colorLabel } from "../../lib/ombudsman";

// "2026-12-03" → "03/12", sem passar por Date (sem fuso).
const dayMonth = (iso: string | null | undefined): string => {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[2]}/${m[1]}` : "";
};

export function DeadlineTag({ color, dueOn }: { color: DeadlineColor | null; dueOn: string | null }) {
  if (!color) return null;
  const day = dayMonth(dueOn);
  return <Tag tone={COLOR_TONE[color]}>{day ? `${colorLabel(color)} · ${day}` : colorLabel(color)}</Tag>;
}
