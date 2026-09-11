// Tom de exibição a partir do tier de uma triagem.
//
// `tier` é vocabulário LIVRE do autor do protocolo (contracts/protocols/schema.json
// declara "tier" como string sem enum), então este mapa é best-effort: cobre os
// dois vocabulários que existem no projeto hoje — o PT das specs do api e o EN
// do seed de demo — e cai em "neutral" para qualquer outro, em vez de fingir
// que conhece a escala da cidade.
//
// O backend NÃO decide urgência por tier (ver Protocols::Urgency no api, que
// usa priority). Isto aqui é só cor.
import type { Tone } from "../theme/tokens";

const TONES: Record<string, Tone> = {
  alta: "down",
  high: "down",
  media: "warn",
  medium: "warn",
  baixa: "ok",
  low: "ok"
};

export function tierTone(tier: string | null | undefined): Tone {
  if (!tier) return "neutral";
  const key = tier
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  return TONES[key] ?? "neutral";
}
