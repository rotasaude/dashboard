import { useEffect, useState } from "react";
import { listActiveUnits, type HealthUnit } from "../../lib/api";
import { currentUnitKey } from "../../lib/attendance";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { secondaryButtonStyle } from "../../components/formStyles";

// UnitPicker (Task 6) — "Unidade: *nome* [trocar]" no topo do Atendimento. A
// escolha persiste em localStorage por usuário (chave currentUnitKey); se a
// unidade guardada não está mais entre as ativas, limpa e pede escolha de
// novo. Todo acesso ao localStorage em try/catch — não é permissão que
// possamos garantir (modo privado, storage bloqueado).
interface Props {
  userId: string;
  onChange(unit: HealthUnit | null): void;
}

function readStored(userId: string): string | null {
  try {
    return localStorage.getItem(currentUnitKey(userId));
  } catch {
    return null;
  }
}

function writeStored(userId: string, unitId: string | null) {
  try {
    if (unitId) localStorage.setItem(currentUnitKey(userId), unitId);
    else localStorage.removeItem(currentUnitKey(userId));
  } catch {
    /* sem storage disponível — segue sem persistir */
  }
}

export function UnitPicker({ userId, onChange }: Props) {
  const [ units, setUnits ] = useState<HealthUnit[] | null>(null);
  const [ selected, setSelected ] = useState<HealthUnit | null>(null);
  const [ choosing, setChoosing ] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listActiveUnits().then((list) => {
      if (cancelled) return;
      setUnits(list);
      const storedId = readStored(userId);
      if (storedId) {
        const found = list.find((u) => u.id === storedId) ?? null;
        if (found) {
          setSelected(found);
          onChange(found);
          return;
        }
        writeStored(userId, null);
      }
      setSelected(null);
      setChoosing(true);
      onChange(null);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ userId ]);

  function choose(unit: HealthUnit) {
    writeStored(userId, unit.id);
    setSelected(unit);
    setChoosing(false);
    onChange(unit);
  }

  if (units === null) return null;

  if (selected && !choosing) {
    return (
      <Panel title="Atendente">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span>Unidade: {selected.name}</span>
          <button type="button" style={secondaryButtonStyle} onClick={() => setChoosing(true)}>
            trocar
          </button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Escolha a unidade">
      {units.length === 0 ? (
        <EmptyState title="nenhuma unidade ativa" sub="peça ao administrador para cadastrar uma" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {units.map((u) => (
            <button
              key={u.id}
              type="button"
              style={{ ...secondaryButtonStyle, textAlign: "left" }}
              onClick={() => choose(u)}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}
