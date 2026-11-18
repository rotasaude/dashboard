// src/modules/VectorBlocks.tsx
// "Quarteirões e imóveis" da coordenação de endemias (módulo 35a, F-35.1; contrato §2; Q2, Q8, Q18). Papel: só a coordenação
// (o /blocks também é lido pelo laboratório e pelo agente, mas esta tela escreve; households index/assign/profile são
// coordinator!). Um bairro por vez, escolhido aqui (só em memória: não mexe no filtro de bairro dos painéis, que mora na URL),
// e três abas. Só a aba aberta lê: os imóveis gravam a trilha `territory_registry` e o mapa a `territory_map`.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVectorDomains, listPanelNeighborhoods } from "../lib/api";
import { PANEL_NEIGHBORHOODS_KEY } from "../lib/neighborhoodFilter";
import { sortByName } from "../lib/territory";
import { STATIC_QUERY, VC_DOMAINS_KEY, vectorMapLayers, type VectorRoles } from "../lib/vectorControl";
import { VectorGate } from "./vectorControl/VectorGate";
import { BlocksPanel } from "./vectorControl/BlocksPanel";
import { HouseholdsPanel } from "./vectorControl/HouseholdsPanel";
import { VectorMapPanel } from "./vectorControl/VectorMapPanel";
import { SegmentedControl } from "../shell/SegmentedControl";
import { EmptyState } from "../components/EmptyState";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, stack } from "./exams/styles";

export const PICK_NEIGHBORHOOD = "Escolha um bairro para ver os quarteirões e os imóveis";
type Tab = "blocks" | "households" | "map";

export function VectorBlocks() {
  return (
    <VectorGate title="Quarteirões e imóveis" sub="endemias · quarteirões e perfil vetorial" allow={(r) => r.coordinator}>
      {(roles) => <BlocksScreen roles={roles} />}
    </VectorGate>
  );
}

function BlocksScreen({ roles }: { roles: VectorRoles }) {
  const [ neighborhoodId, setNeighborhoodId ] = useState("");
  const [ tab, setTab ] = useState<Tab>("blocks");
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, ...STATIC_QUERY });
  // Só com a aba Imóveis aberta (o mapa lê os seus); sem os domínios (falha), o risco aparece cru.
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, enabled: !!neighborhoodId && tab === "households", ...STATIC_QUERY });
  const options: { key: Tab; label: string }[] = [ { key: "blocks", label: "Quarteirões" }, { key: "households", label: "Imóveis" } ];
  if (vectorMapLayers(roles).includes("risk")) options.push({ key: "map", label: "Mapa" });
  return (
    <div style={stack}>
      <label style={{ ...fieldLabel, maxWidth: 320 }}>
        Bairro
        <select value={neighborhoodId} disabled={neighborhoods.isPending} style={inputStyle} onChange={(e) => setNeighborhoodId(e.target.value)}>
          <option value="">escolha o bairro</option>
          {sortByName(neighborhoods.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>)}
        </select>
      </label>
      {neighborhoods.isError && <p role="alert" style={alert}>não foi possível carregar os bairros</p>}
      {!neighborhoodId ? <EmptyState title={PICK_NEIGHBORHOOD} /> : (
        <>
          <div><SegmentedControl options={options} value={tab} onChange={setTab} /></div>
          {tab === "blocks" && <BlocksPanel key={neighborhoodId} neighborhoodId={neighborhoodId} />}
          {tab === "households" && <HouseholdsPanel key={neighborhoodId} neighborhoodId={neighborhoodId} domains={domains.data ?? null} />}
          {tab === "map" && <VectorMapPanel query={{ layer: "risk", neighborhoodId }} title="Imóveis por risco" />}
        </>
      )}
    </div>
  );
}
