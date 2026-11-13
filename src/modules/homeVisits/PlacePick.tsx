// src/modules/homeVisits/PlacePick.tsx
// "Onde" da visita (módulo 24b): microárea (as da equipe; "Fora de área" só com `out_of_area_allowed`) → "Domicílio cadastrado"
// (lista do 24a por microárea, "Carregar mais" pelo cursor; leitura nominal, nunca relida sozinha) ou "Imóvel sem cadastro" (tipo
// de imóvel do domínio). O domicílio escolhido fixa imóvel e microárea: só se troca o domicílio inteiro.
import type { ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listVisitHouseholds, type HomeVisitDomains, type HomeVisitTeam, type VisitHousehold } from "../../lib/api";
import { HV_HOUSEHOLDS_KEY, NOMINAL_QUERY, homeVisitError, propertyLabel } from "../../lib/homeVisits";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";

export const OUT_OF_AREA = "out";
export type PlaceMode = "household" | "no_household" | null;
type Aria = { "aria-invalid"?: true; "aria-describedby"?: string };

export function PlacePick({ team, domains, microArea, mode, chosen, household, propertyType, disabled, name, onMicroArea, onMode, onHousehold, onPropertyType, aria, errNode }: {
  team: HomeVisitTeam; domains: HomeVisitDomains; microArea: string; mode: PlaceMode;
  // Há domicílio escolhido (`chosen`); `household` é o resumo da lista ou o detalhe do atalho, null enquanto o detalhe carrega.
  chosen: boolean; household: { address_short: string; property_type: string; micro_area: { code: string } } | null;
  propertyType: string; disabled: boolean; name: string;
  onMicroArea(v: string): void; onMode(m: Exclude<PlaceMode, null>): void; onHousehold(h: VisitHousehold | null): void; onPropertyType(t: string): void;
  aria(path: string): Aria; errNode(path: string): ReactNode;
}) {
  const out = microArea === OUT_OF_AREA;
  const fixed = mode === "household" && chosen;
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Onde</legend>
      <label style={fieldLabel}>
        Microárea
        <select value={microArea} disabled={disabled || fixed} style={inputStyle} {...aria(out ? "out_of_area" : "micro_area_id")}
          onChange={(e) => onMicroArea(e.target.value)}>
          {team.micro_areas.length !== 1 && <option value="">— escolha —</option>}
          {team.micro_areas.map((m) => <option key={m.id} value={m.id}>{`${m.code} · ${m.name}`}</option>)}
          {team.out_of_area_allowed && <option value={OUT_OF_AREA}>Fora de área</option>}
        </select>
      </label>
      {errNode("micro_area_id")}
      {errNode("out_of_area")}

      <div style={row}>
        <label style={checkLabel}>
          <input type="radio" name={name} checked={mode === "household"} disabled={disabled || out} {...aria("household_id")} onChange={() => onMode("household")} />
          Domicílio cadastrado
        </label>
        <label style={checkLabel}>
          <input type="radio" name={name} checked={mode === "no_household"} disabled={disabled || fixed} onChange={() => onMode("no_household")} />
          Imóvel sem cadastro
        </label>
      </div>
      {errNode("household_id")}

      {mode === "household" && (fixed ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {household ? (
            <>
              <span style={{ fontSize: 13, overflowWrap: "anywhere" }}>{household.address_short}</span>
              <span style={muted}>{`microárea ${household.micro_area.code} · ${propertyLabel(domains, household.property_type)}`}</span>
            </>
          ) : <span role="status" style={muted}>Carregando o domicílio…</span>}
          <div>
            <button type="button" disabled={disabled} style={secondaryButtonStyle} onClick={() => onHousehold(null)}>Trocar domicílio</button>
          </div>
        </div>
      ) : microArea === "" ? <p style={muted}>Escolha a microárea para ver os domicílios.</p> : (
        <HouseholdList microAreaId={microArea} disabled={disabled} onPick={onHousehold} />
      ))}

      {mode === "no_household" && (
        <>
          <label style={fieldLabel}>
            Tipo de imóvel
            <select value={propertyType} disabled={disabled} style={inputStyle} {...aria("property_type")} onChange={(e) => onPropertyType(e.target.value)}>
              <option value="">— escolha —</option>
              {domains.tipo_de_imovel.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
            </select>
          </label>
          {errNode("property_type")}
        </>
      )}
    </fieldset>
  );
}

function HouseholdList({ microAreaId, disabled, onPick }: { microAreaId: string; disabled: boolean; onPick(h: VisitHousehold): void }) {
  const pages = useInfiniteQuery({
    queryKey: [ HV_HOUSEHOLDS_KEY, microAreaId ],
    queryFn: ({ pageParam }) => listVisitHouseholds(microAreaId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  if (!pages.data) return pages.isError ? <p role="alert" style={alert}>{homeVisitError(pages.error)}</p> : <p role="status" style={muted}>Carregando domicílios…</p>;
  const items = pages.data.pages.flatMap((p) => p.items);
  if (items.length === 0) return <p style={muted}>Nenhum domicílio cadastrado nesta microárea — registre o imóvel sem cadastro.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((h) => (
          <li key={h.id} style={row}>
            <button type="button" disabled={disabled || h.status !== "active"} style={{ ...secondaryButtonStyle, textAlign: "left", overflowWrap: "anywhere" }}
              onClick={() => onPick(h)}>
              {h.address_short}
            </button>
            {h.status !== "active" && <span style={muted}>domicílio inativo</span>}
          </li>
        ))}
      </ul>
      {pages.hasNextPage && (
        <div>
          <button type="button" disabled={disabled || pages.isFetchingNextPage} style={secondaryButtonStyle} onClick={() => void pages.fetchNextPage()}>
            Carregar mais
          </button>
        </div>
      )}
      {pages.isError && <p role="alert" style={alert}>{homeVisitError(pages.error)}</p>}
    </div>
  );
}
