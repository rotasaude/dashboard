// Módulo 35a (Q13(7), Q28; WCAG 1.4.1): a marca de cada categoria nos mapas da vigilância ambiental e o nome dela
// na legenda. Puro, sem MapLibre: a tela e o mapa (chunk lazy) leem daqui.
//
// A marca é preenchimento + contorno: cheia (cor do papel, contorno do painel) ou vazada (sem preenchimento, contorno
// na cor do papel). Dentro de uma camada, o par (preenchimento, contorno) é distinto em todos os temas, alto contraste
// incluído (teste em vectorMap.test.ts). A legenda é texto no DOM, nunca no canvas: o mapa não ganha camada de texto.
import { RISK_CLASSES, domainLabel, riskTone, type RiskTone, type VectorMapLayer } from "./vectorControl";

export type MapMark = { role: string; hollow: boolean };

// O papel do tema de cada tom do selo de risco (Tag). O mapa deriva o risco daqui; só o roxo muda (abaixo).
export const TONE_ROLE: Record<RiskTone, string> = { ok: "--ok", warn: "--warn", down: "--down", neutral: "--ink3", accent: "--accent" };
// I1 (coordenador): no mapa, o roxo é `--info` (o `--accent` colide com o amarelo no alto contraste). O selo não muda.
const MAP_ROLE_OVERRIDE: Record<string, string> = { purple: "--info" };

const filled = (role: string): MapMark => ({ role, hollow: false });

// Exatamente as categorias do api (MapPoints: risk = risk_class ou "none"; ovitraps = negative/positive/alert/not_counted;
// transmission = só "area"), na ordem da legenda.
export const MAP_MARKS: Record<VectorMapLayer, Record<string, MapMark>> = {
  risk: {
    ...Object.fromEntries(RISK_CLASSES.map((c) => [ c, filled(MAP_ROLE_OVERRIDE[c] ?? TONE_ROLE[riskTone(c)]) ])),
    none: { role: "--ink2", hollow: true }
  },
  ovitraps: { negative: filled("--ok"), positive: filled("--warn"), alert: filled("--down"), not_counted: filled("--ink3") },
  transmission: { area: filled("--warn") }
};
// Categoria fora da tabela (o api tem conjunto fechado: só defesa): vazada em `--ink4`, código cru na legenda.
export const UNKNOWN_MARK: MapMark = { role: "--ink4", hollow: true };
// O anel do ponto escolhido e o contorno das marcas cheias.
export const SELECTED_ROLE = "--ink";
export const OUTLINE_ROLE = "--panel";

// Os papéis por categoria (o que o adaptador recebe, resolvido em cor).
export const CATEGORY_COLORS: Record<VectorMapLayer, Record<string, string>> = Object.fromEntries(
  Object.entries(MAP_MARKS).map(([ layer, marks ]) => [ layer, Object.fromEntries(Object.entries(marks).map(([ c, m ]) => [ c, m.role ])) ])
) as Record<VectorMapLayer, Record<string, string>>;

const has = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);
export const markOf = (layer: VectorMapLayer, category: string): MapMark =>
  (has(MAP_MARKS[layer], category) ? MAP_MARKS[layer][category] : UNKNOWN_MARK);

const FIXED_LABELS: Record<VectorMapLayer, Record<string, string>> = {
  risk: { none: "sem risco avaliado" },
  ovitraps: { negative: "negativa", positive: "positiva", alert: "acima do alerta", not_counted: "não contada" },
  transmission: { area: "área do bloqueio" }
};
// O nome da categoria: o risco pelos domínios (código cru sem eles), os outros pela tabela; desconhecida, crua.
export function categoryLabel(layer: VectorMapLayer, category: string, riskClasses: readonly { code: string; label: string }[] = []): string {
  if (has(FIXED_LABELS[layer], category)) return FIXED_LABELS[layer][category];
  return layer === "risk" ? domainLabel(riskClasses, category) : category;
}

// As opções de cor do adaptador, com cada papel lido por `role` (getComputedStyle no navegador).
export function mapColors(layer: VectorMapLayer, role: (name: string) => string) {
  const marks = Object.entries(MAP_MARKS[layer]);
  return {
    point: role(UNKNOWN_MARK.role), selected: role(SELECTED_ROLE), outline: role(OUTLINE_ROLE),
    categories: Object.fromEntries(marks.map(([ c, m ]) => [ c, role(m.role) ])),
    hollow: marks.filter(([ , m ]) => m.hollow).map(([ c ]) => c),
    hollowOther: UNKNOWN_MARK.hollow
  };
}
