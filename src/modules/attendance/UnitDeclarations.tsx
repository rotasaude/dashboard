// "Declarações de hoje" na fila da unidade (api#59): recolhida por padrão; a
// lista só é buscada quando a recepção abre (dia no fuso da cidade).
import { useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { listUnitDeclarations } from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { documentError } from "../../lib/clinicalDocuments";
import { DeclarationList, UNIT_DECLARATIONS_KEY } from "./DeclarationList";

interface Props {
  unitId: string;
  onGoToSecurity?(): void;
}

export function UnitDeclarations({ unitId, onGoToSecurity }: Props) {
  const [ open, setOpen ] = useState(false);
  const day = todayInCity();
  const query = useQuery({
    queryKey: [ UNIT_DECLARATIONS_KEY, unitId, day ], queryFn: () => listUnitDeclarations(unitId, day), enabled: open
  });

  return (
    <details style={box} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Declarações de hoje</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
        {query.isPending && open && <p style={muted}>carregando…</p>}
        {query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
        {query.data && query.data.length === 0 && <p style={muted}>nenhuma declaração emitida hoje nesta unidade</p>}
        {query.data && query.data.length > 0 && (
          <DeclarationList rows={query.data} unitId={unitId} label="Declarações de hoje nesta unidade" showPatient
            onGoToSecurity={onGoToSecurity} />
        )}
      </div>
    </details>
  );
}

const box: CSSProperties = { padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
