// src/modules/TerritoryTeam.tsx
// Território da equipe (módulo 24a; contrato §4–§6): microáreas → domicílios
// → famílias → moradores, com a situação do cadastro de cada um. Só as
// microáreas em que o profissional grava as duas fichas (`can_register`): a
// de outro ACS o api recusa (403 out_of_scope), então nem aparece (A19/C24).
// O contexto não tem pessoa (STATIC_QUERY); lista, domicílio e moradores são
// nominais e gravam trilha — lidos ao abrir, nunca sozinhos.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTerritoryContext } from "../lib/api";
import { STATIC_QUERY, TERRITORY_CONTEXT_KEY, territoryError } from "../lib/territoryRegistry";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { TerritoryGate } from "./territory/TerritoryGate";
import { HouseholdList } from "./territory/HouseholdList";
import { HouseholdDetail } from "./territory/HouseholdDetail";

// `today` (padrão: o dia da cidade) vai para as fichas ("reside desde" não passa deste mês); a navegação não depende do dia.
export function TerritoryTeam({ today }: { today?: string } = {}) {
  return (
    <TerritoryGate title="Território da equipe" sub="cadastro territorial · domicílios, famílias e moradores" allow={(r) => r.professional}>
      {() => <TeamBody today={today} />}
    </TerritoryGate>
  );
}

function TeamBody({ today }: { today?: string }) {
  const context = useQuery({ queryKey: [ TERRITORY_CONTEXT_KEY ], queryFn: getTerritoryContext, ...STATIC_QUERY });
  const [ teamChoice, setTeamChoice ] = useState("");
  const [ areaChoice, setAreaChoice ] = useState("");
  const [ openId, setOpenId ] = useState<string | null>(null);
  const teams = (context.data?.teams ?? [])
    .map((t) => ({ ...t, micro_areas: t.micro_areas.filter((m) => m.can_register) }))
    .filter((t) => t.micro_areas.length > 0);
  const team = teams.find((t) => t.id === teamChoice) ?? teams[0];
  const area = team?.micro_areas.find((m) => m.id === areaChoice) ?? team?.micro_areas[0];

  if (context.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (context.isError) return <p role="alert" style={alert}>{territoryError(context.error)}</p>;
  if (!team || !area) return <EmptyState title="nenhuma microárea em que você cadastre nas suas equipes" />;

  return (
    <div style={stack}>
      <Panel title="Equipe e microárea">
        <div style={{ ...row, alignItems: "flex-end", padding: 16 }}>
          {teams.length > 1 && (
            <label style={fieldLabel}>
              Equipe
              <select value={team.id} style={inputStyle} onChange={(e) => { setOpenId(null); setAreaChoice(""); setTeamChoice(e.target.value); }}>
                {teams.map((t) => <option key={t.id} value={t.id}>{`${t.name} · INE ${t.ine} · ${t.unit.name}`}</option>)}
              </select>
            </label>
          )}
          <label style={fieldLabel}>
            Microárea
            <select value={area.id} style={inputStyle} onChange={(e) => { setOpenId(null); setAreaChoice(e.target.value); }}>
              {team.micro_areas.map((m) => <option key={m.id} value={m.id}>{`${m.code} · ${m.name}`}</option>)}
            </select>
          </label>
        </div>
      </Panel>
      {openId && <HouseholdDetail key={openId} householdId={openId} today={today} onBack={() => setOpenId(null)} />}
      <Panel title="Domicílios" sub={`microárea ${area.code} · do último salvo ao mais antigo`}>
        <div style={{ padding: 16 }}>
          <HouseholdList key={area.id} microAreaId={area.id} onOpen={setOpenId} />
        </div>
      </Panel>
    </div>
  );
}
