// src/modules/TerritoryMap.tsx
// Mapa da microárea (módulo 24c, F-24.20; contrato §6): os domicílios que têm
// ponto marcado, sobre o mapa offline da cidade. O ponto nasce no app de
// campo; aqui ele é visto e, por quem cadastra na microárea, corrigido.
//
// Todas as microáreas do contexto aparecem (o enfermeiro lê a da equipe sem
// `can_register`). Uma consulta só traz o arquivo do mapa e os pontos (Q14):
// é NOMINAL e grava trilha — lida ao abrir a microárea, nunca sozinha. Sem
// mapa gerado, a tela avisa e a lista segue; o MapLibre nem é carregado.
import { Suspense, lazy, useId, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTerritoryContext, listMapHouseholds, type MapHousehold } from "../lib/api";
import { NOMINAL_QUERY, STATIC_QUERY, TERRITORY_CONTEXT_KEY, teamName, territoryError } from "../lib/territoryRegistry";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { Tag } from "../components/Tag";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, fieldLabel, muted, row, stack } from "./exams/styles";
import { TerritoryGate } from "./territory/TerritoryGate";
import { pointLabel } from "./territory/map/points";
import { PointCorrection } from "./territory/map/PointCorrection";
import type { LatLng } from "./territory/map/fieldMap";

const MicroAreaMap = lazy(() => import("./territory/map/MicroAreaMap"));

export const MAP_HOUSEHOLDS_KEY = "territoryMapHouseholds";
export const NO_MAP = "o mapa desta cidade ainda não foi gerado — peça à equipe de manutenção";
export const NO_POINTS = "nenhum domicílio desta microárea tem ponto marcado — o ponto é marcado no app de campo";

export function TerritoryMap() {
  return (
    <TerritoryGate title="Mapa da microárea" sub="cadastro territorial · domicílios com ponto no mapa" allow={(r) => r.professional}>
      {() => <MapBody />}
    </TerritoryGate>
  );
}

function MapBody() {
  const context = useQuery({ queryKey: [ TERRITORY_CONTEXT_KEY ], queryFn: getTerritoryContext, ...STATIC_QUERY });
  const [ teamChoice, setTeamChoice ] = useState("");
  const [ areaChoice, setAreaChoice ] = useState("");
  const teams = (context.data?.teams ?? []).filter((t) => t.micro_areas.length > 0);
  const team = teams.find((t) => t.id === teamChoice) ?? teams[0];
  const area = team?.micro_areas.find((m) => m.id === areaChoice) ?? team?.micro_areas[0];

  if (context.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (context.isError) return <p role="alert" style={alert}>{territoryError(context.error)}</p>;
  if (!team || !area) return <EmptyState title="nenhuma microárea nas suas equipes" />;

  return (
    <div style={stack}>
      <Panel title="Equipe e microárea">
        <div style={{ ...row, alignItems: "flex-end", padding: 16 }}>
          {teams.length > 1 && (
            <label style={fieldLabel}>
              Equipe
              <select value={team.id} style={inputStyle} onChange={(e) => { setAreaChoice(""); setTeamChoice(e.target.value); }}>
                {teams.map((t) => <option key={t.id} value={t.id}>{`${teamName(t)} · INE ${t.ine} · ${t.unit.name}`}</option>)}
              </select>
            </label>
          )}
          <label style={fieldLabel}>
            Microárea
            <select value={area.id} style={inputStyle} onChange={(e) => setAreaChoice(e.target.value)}>
              {team.micro_areas.map((m) => <option key={m.id} value={m.id}>{`${m.code} · ${m.name}`}</option>)}
            </select>
          </label>
        </div>
      </Panel>
      <AreaMap key={area.id} microAreaId={area.id} code={area.code} canRegister={area.can_register} />
    </div>
  );
}

function familiesText(n: number): string {
  return n === 1 ? "1 família" : `${n} famílias`;
}

function AreaMap({ microAreaId, code, canRegister }: { microAreaId: string; code: string; canRegister: boolean }) {
  const query = useQuery({ queryKey: [ MAP_HOUSEHOLDS_KEY, microAreaId ], queryFn: () => listMapHouseholds(microAreaId), ...NOMINAL_QUERY });
  const [ selectedId, setSelectedId ] = useState<string | null>(null);
  // Um ponto em correção por vez: de onde o marcador sai e para onde foi.
  const [ correcting, setCorrecting ] = useState<{ id: string; from: LatLng } | null>(null);
  const [ moved, setMoved ] = useState<LatLng | null>(null);
  const correction = useMemo(() => (correcting ? { from: correcting.from, onMove: setMoved } : null), [ correcting ]);

  if (query.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (query.isError) return <p role="alert" style={alert}>{territoryError(query.error)}</p>;
  const { map, items } = query.data;
  const stop = () => { setCorrecting(null); setMoved(null); };
  const reload = () => void query.refetch();

  return (
    <>
      <Panel title="Mapa" sub={`microárea ${code}`}>
        <div style={{ padding: 16 }}>
          {map
            ? (
              <Suspense fallback={<p className="mono" style={muted}>carregando o mapa…</p>}>
                <MicroAreaMap items={items} selectedId={selectedId} onSelect={setSelectedId} correction={correction} />
              </Suspense>
            )
            : <EmptyState title={NO_MAP} />}
        </div>
      </Panel>
      <Panel title="Domicílios com ponto" sub={`microárea ${code}`}>
        <div style={{ padding: 16 }}>
          {items.length === 0 ? <EmptyState title={NO_POINTS} /> : (
            <ul aria-label="Domicílios com ponto" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((h) => (
                <PointItem key={h.id} item={h} selected={h.id === selectedId} onShow={map ? () => setSelectedId(h.id) : null}
                  correction={map && canRegister ? {
                    active: correcting?.id === h.id, moved: correcting?.id === h.id ? moved : null, locked: correcting !== null && correcting.id !== h.id,
                    onStart: () => {
                      setSelectedId(h.id);
                      setMoved(null);
                      setCorrecting({ id: h.id, from: { latitude: h.location.latitude, longitude: h.location.longitude } });
                    },
                    onStop: stop, onDone: reload, onStale: reload
                  } : null} />
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </>
  );
}

type CorrectionControl = {
  active: boolean; moved: LatLng | null; locked: boolean; onStart(): void; onStop(): void; onDone(): void; onStale(): void;
};

function PointItem({ item, selected, onShow, correction }: {
  item: MapHousehold; selected: boolean; onShow: (() => void) | null; correction: CorrectionControl | null;
}) {
  const label = pointLabel(item);
  const labelId = useId();
  return (
    <li style={box}>
      <div style={row}>
        <strong id={labelId} style={{ fontSize: 13 }}>{label}</strong>
        {selected && <Tag tone="info">no mapa</Tag>}
      </div>
      <span style={muted}>{familiesText(item.families_count)}</span>
      {onShow && (
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} aria-label={`Ver no mapa ${label}`} onClick={onShow}>Ver no mapa</button>
        </div>
      )}
      {correction && <PointCorrection item={item} describedBy={labelId} {...correction} />}
    </li>
  );
}
