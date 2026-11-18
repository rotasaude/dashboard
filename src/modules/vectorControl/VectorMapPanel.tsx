// Módulo 35a (contrato §17; Q8, Q13(7), Q28): o mapa de uma camada da vigilância ambiental — risco do bairro,
// ovitrampas da semana ou a área do bloqueio —, sobre o mapa offline da cidade do 24c, com cada ponto marcado pela
// categoria que o api deu. Os portões (quem lê qual camada: `vectorMapLayers`) ficam com a tela que usa o painel.
//
// Ler os pontos grava a trilha `territory_map` do 24c: NOMINAL, lido ao abrir e por ação, nunca sozinho (sem foco,
// sem polling). Sigilo: nenhum ponto liga a um caso (o api manda só id, coordenada, categoria e rótulo; no bloqueio,
// nem o quarteirão — Q28); o rótulo só aparece para o ponto clicado. Sem mapa gerado, nada do MapLibre carrega.
// WCAG 1.4.1: a legenda é texto no DOM com todas as categorias da camada, e o ponto clicado diz a categoria por nome.
import { Suspense, lazy, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVectorDomains, listVectorMapPoints, type VectorMapPoint, type VectorMapQuery } from "../../lib/api";
import { NOMINAL_QUERY, STATIC_QUERY, VC_DOMAINS_KEY, VC_MAP_KEY, vectorError, type VectorMapLayer } from "../../lib/vectorControl";
import { MAP_MARKS, categoryLabel, markOf } from "../../lib/vectorMap";
import { NO_MAP } from "../../lib/territoryRegistry";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, row, stack } from "../exams/styles";

const VectorMap = lazy(() => import("./VectorMap"));

export const NO_VECTOR_POINTS = "nenhum imóvel desta seleção tem ponto marcado — o ponto é marcado no app de campo";

const has = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);

// O que o ponto clicado mostra: o rótulo do api, o nome da camada e o da categoria. No bloqueio, só a área (Q28).
function pointText(layer: VectorMapLayer, p: VectorMapPoint, label: string): string {
  if (layer === "risk") return `quarteirão ${p.label} · ${label}`;
  if (layer === "ovitraps") return `ovitrampa ${p.label} · ${label}`;
  return label;
}

const overlapText = (layer: VectorMapLayer, n: number) => (layer === "ovitraps" ? `${n} ovitrampas neste ponto` : `${n} imóveis neste ponto`);

function Swatch({ layer, category }: { layer: VectorMapLayer; category: string }) {
  const mark = markOf(layer, category);
  const style = mark.hollow
    ? { background: "transparent", border: `2px solid var(${mark.role})` }
    : { background: `var(${mark.role})`, border: "1px solid var(--rule)" };
  return <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: "50%", boxSizing: "border-box", flex: "none", ...style }} />;
}

export function VectorMapPanel({ query, title }: { query: VectorMapQuery; title: string }) {
  const layer = query.layer;
  const points = useQuery({ queryKey: [ VC_MAP_KEY, query ], queryFn: () => listVectorMapPoints(query), ...NOMINAL_QUERY });
  // Os rótulos do risco vêm dos domínios; sem eles (carregando ou falha), o código cru.
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, enabled: layer === "risk", ...STATIC_QUERY });
  const [ selectedId, setSelectedId ] = useState<string | null>(null);
  const riskClasses = domains.data?.risk_classes;
  const labelOf = (category: string) => categoryLabel(layer, category, riskClasses);

  const items = points.data?.points;
  // Todas as categorias da camada, na ordem da tabela (mesmo com 0), e as desconhecidas na ordem em que chegaram.
  const legend = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of items ?? []) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
    const unknown = [ ...counts.keys() ].filter((c) => !has(MAP_MARKS[layer], c));
    return [ ...Object.keys(MAP_MARKS[layer]), ...unknown ].map((category) => ({ category, count: counts.get(category) ?? 0 }));
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
    // Pontos na mesma coordenada (duas ovitrampas no mesmo imóvel): o clique só alcança o de cima, então a tela lista todos.
    const here = selected ? list.filter((p) => p.latitude === selected.latitude && p.longitude === selected.longitude) : [];
    return (
      <>
        <Suspense fallback={<p className="mono" style={muted}>carregando o mapa…</p>}>
          <VectorMap points={list} layer={layer} label={title} selectedId={selectedId} onSelect={setSelectedId} />
        </Suspense>
        <ul aria-label={`Legenda — ${title}`} style={{ ...row, listStyle: "none", margin: 0, padding: 0, gap: 12 }}>
          {legend.map(({ category, count }) => (
            <li key={category} style={{ ...row, gap: 6, fontSize: 12.5 }}>
              <Swatch layer={layer} category={category} />
              <span>{`${labelOf(category)}: ${count}`}</span>
            </li>
          ))}
        </ul>
        {selected && (
          <div role="status" style={box}>
            <div style={row}>
              <Swatch layer={layer} category={selected.category} />
              <strong style={{ fontSize: 13 }}>{pointText(layer, selected, labelOf(selected.category))}</strong>
              <button type="button" style={secondaryButtonStyle} aria-label="Fechar o ponto" onClick={() => setSelectedId(null)}>Fechar</button>
            </div>
            {here.length > 1 && (
              <>
                <span style={muted}>{overlapText(layer, here.length)}</span>
                {layer !== "transmission" && (
                  <div role="group" aria-label={overlapText(layer, here.length)} style={row}>
                    {here.map((p) => (
                      <button key={p.id} type="button" style={secondaryButtonStyle} aria-pressed={p.id === selected.id} onClick={() => setSelectedId(p.id)}>
                        {pointText(layer, p, labelOf(p.category))}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </>
    );
  }
}
