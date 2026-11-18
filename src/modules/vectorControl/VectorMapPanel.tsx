// Módulo 35a (contrato §17; Q8, Q13(7), Q28): o mapa de uma camada da vigilância ambiental — risco do bairro,
// ovitrampas da semana ou a área do bloqueio —, sobre o mapa offline da cidade do 24c, com cada ponto pintado pela
// categoria que o api deu. Os portões (quem lê qual camada: `vectorMapLayers`) ficam com a tela que usa o painel.
//
// Ler os pontos grava a trilha `territory_map` do 24c: NOMINAL, lido ao abrir e por ação, nunca sozinho (sem foco,
// sem polling). Sigilo: nenhum ponto liga a um caso (o api manda só id, coordenada, categoria e rótulo; no bloqueio,
// nem o quarteirão — Q28); o rótulo só aparece para o ponto clicado. Sem mapa gerado, nada do MapLibre carrega.
import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVectorDomains, listVectorMapPoints, type VectorMapPoint, type VectorMapQuery } from "../../lib/api";
import {
  NOMINAL_QUERY, STATIC_QUERY, VC_DOMAINS_KEY, VC_MAP_KEY, domainLabel, vectorError, type VectorMapLayer
} from "../../lib/vectorControl";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, row, stack } from "../exams/styles";
import { NO_MAP } from "../TerritoryMap";

const VectorMap = lazy(() => import("./VectorMap"));

export const NO_VECTOR_POINTS = "nenhum imóvel desta seleção tem ponto marcado — o ponto é marcado no app de campo";

// Os papéis do tema por categoria, exatamente as categorias do api (MapPoints: risk = risk_class ou "none";
// ovitraps = negative/positive/alert/not_counted; transmission = só "area"). Categoria nova: a cor do ponto e o código cru.
export const CATEGORY_COLORS: Record<VectorMapLayer, Record<string, string>> = {
  risk: { green: "--ok", yellow: "--warn", red: "--down", gray: "--ink3", purple: "--accent", none: "--ink2" },
  ovitraps: { negative: "--ok", positive: "--warn", alert: "--down", not_counted: "--ink3" },
  transmission: { area: "--warn" }
};
// A cor do ponto de categoria desconhecida (nenhuma das acima).
export const POINT_COLOR = "--ink";

const FIXED_LABELS: Record<VectorMapLayer, Record<string, string>> = {
  risk: { none: "sem risco avaliado" },
  ovitraps: { negative: "negativa", positive: "positiva", alert: "acima do alerta", not_counted: "não contada" },
  transmission: { area: "área do bloqueio" }
};

const has = (map: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(map, key);
const colorOf = (layer: VectorMapLayer, category: string) => `var(${has(CATEGORY_COLORS[layer], category) ? CATEGORY_COLORS[layer][category] : POINT_COLOR})`;

// O que o ponto clicado mostra: o rótulo do api com o nome da camada. No bloqueio, só a área (Q28).
function pointText(layer: VectorMapLayer, p: VectorMapPoint, categoryLabel: string): string {
  if (layer === "risk") return `quarteirão ${p.label} · ${categoryLabel}`;
  if (layer === "ovitraps") return `ovitrampa ${p.label} · ${categoryLabel}`;
  return categoryLabel;
}

export function VectorMapPanel({ query, title }: { query: VectorMapQuery; title: string }) {
  const layer = query.layer;
  const points = useQuery({ queryKey: [ VC_MAP_KEY, query ], queryFn: () => listVectorMapPoints(query), ...NOMINAL_QUERY });
  // Os rótulos do risco vêm dos domínios; sem eles (carregando ou falha), o código cru.
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, enabled: layer === "risk", ...STATIC_QUERY });
  const [ selectedId, setSelectedId ] = useState<string | null>(null);

  const labelOf = useMemo(() => (category: string): string => {
    if (has(FIXED_LABELS[layer], category)) return FIXED_LABELS[layer][category];
    return layer === "risk" ? domainLabel(domains.data?.risk_classes ?? [], category) : category;
  }, [ layer, domains.data ]);

  const items = points.data?.points;
  // Contagem por categoria: as conhecidas na ordem da tabela, depois as desconhecidas na ordem em que chegaram.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of items ?? []) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const known = Object.keys(CATEGORY_COLORS[layer]).filter((c) => counts.has(c));
    const unknown = [ ...counts.keys() ].filter((c) => !has(CATEGORY_COLORS[layer], c));
    return [ ...known, ...unknown ].map((category) => ({ category, count: counts.get(category)! }));
  }, [ items, layer ]);

  return (
    <Panel title={title}>
      <div style={{ ...stack, padding: 16 }}>
        {body()}
      </div>
    </Panel>
  );

  // Uma função, não um componente: um componente novo a cada render remontaria o mapa ao clicar num ponto.
  function body() {
    if (points.isPending) return <p className="mono" style={muted}>carregando…</p>;
    if (points.isError) return <p role="alert" style={alert}>{vectorError(points.error)}</p>;
    const { map, points: list } = points.data;
    if (!map) return <EmptyState title={NO_MAP} />;
    if (list.length === 0) return <EmptyState title={NO_VECTOR_POINTS} />;
    const selected = list.find((p) => p.id === selectedId) ?? null;
    return (
      <>
        <Suspense fallback={<p className="mono" style={muted}>carregando o mapa…</p>}>
          <VectorMap points={list} layer={layer} label={title} onSelect={setSelectedId} />
        </Suspense>
        <ul aria-label={`Legenda — ${title}`} style={{ ...row, listStyle: "none", margin: 0, padding: 0, gap: 12 }}>
          {legend.map(({ category, count }) => (
            <li key={category} style={{ ...row, gap: 6, fontSize: 12.5 }}>
              <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: "50%", background: colorOf(layer, category), border: "1px solid var(--rule)" }} />
              <span>{`${labelOf(category)}: ${count}`}</span>
            </li>
          ))}
        </ul>
        {selected && (
          <div role="status" style={{ ...box, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13 }}>{pointText(layer, selected, labelOf(selected.category))}</strong>
            <button type="button" style={secondaryButtonStyle} aria-label="Fechar o ponto" onClick={() => setSelectedId(null)}>Fechar</button>
          </div>
        )}
      </>
    );
  }
}
