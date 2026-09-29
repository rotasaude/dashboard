import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listPanelNeighborhoods } from "../lib/api";
import { NONE, PANEL_NEIGHBORHOODS_KEY, useNeighborhoodParam, writeNeighborhoodParam } from "../lib/neighborhoodFilter";
import { sortByName } from "../lib/territory";
import { SUPPRESSED_HINT } from "../lib/smallCount";
import { inputStyle } from "./formStyles";

// Seletor de bairro dos painéis com cidadão (módulo 11; spec 2026-09-28 §5),
// para todo papel que lê os painéis. Inativos continuam na lista (histórico e
// filtro, ADR 0023), marcados.
export function NeighborhoodPicker() {
  const value = useNeighborhoodParam();
  const list = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods });

  // Link velho, bairro de outra cidade: sem isto o painel ficaria no 422.
  // Só com a lista carregada — lista que falhou não prova que o bairro sumiu.
  const unknown = !!value && value !== NONE && list.isSuccess && !list.data.some((n) => n.id === value);
  useEffect(() => { if (unknown) writeNeighborhoodParam(null); }, [ unknown ]);

  // Lista ainda carregando ou que falhou: o filtro da URL vale mesmo assim, e o
  // <select> precisa de uma opção com o valor dele (senão mostraria "Todos"
  // com o painel filtrado, e escolher "Todos" não dispararia change).
  const placeholder = !!value && value !== NONE && !list.isSuccess;

  const errorId = "neighborhood-picker-error";
  const hintId = "neighborhood-picker-hint";
  const showHint = !!value && !unknown;
  const describedBy = [ list.isError ? errorId : null, showHint ? hintId : null ].filter(Boolean).join(" ") || undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 220, maxWidth: 320 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12, color: "var(--ink2)" }}>
        Bairro
        <select
          value={unknown ? "" : value ?? ""}
          disabled={list.isPending}
          aria-describedby={describedBy}
          onChange={(e) => writeNeighborhoodParam(e.target.value || null)}
          style={inputStyle}
        >
          <option value="">Todos</option>
          <option value={NONE}>Sem bairro</option>
          {placeholder && <option value={value}>bairro selecionado</option>}
          {sortByName(list.data ?? []).map((n) => (
            <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>
          ))}
        </select>
      </label>
      {list.isError && <span id={errorId} style={{ fontSize: 11, color: "var(--down)" }}>não foi possível carregar os bairros</span>}
      {showHint && <span id={hintId} style={{ fontSize: 11, color: "var(--ink3)" }}>{SUPPRESSED_HINT}</span>}
    </div>
  );
}
