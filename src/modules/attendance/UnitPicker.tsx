import { useEffect, useRef, useState } from "react";
import { listActiveUnits, type HealthUnit } from "../../lib/api";
import { attendanceError, currentUnitKey } from "../../lib/attendance";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { secondaryButtonStyle } from "../../components/formStyles";
import { Tag } from "../../components/Tag";

// UnitPicker (Task 6) — "Unidade: *nome* [trocar]" no topo do Atendimento. A
// escolha persiste em localStorage por usuário (chave currentUnitKey); se a
// unidade guardada não está mais entre as ativas, limpa e pede escolha de
// novo. Todo acesso ao localStorage em try/catch — não é permissão que
// possamos garantir (modo privado, storage bloqueado).
interface Props {
  userId: string;
  onChange(unit: HealthUnit | null): void;
  // AT-16: unidades com vínculo do profissional vêm primeiro e marcadas.
  linkedUnitIds?: ReadonlySet<string>;
  // AT-16: avisa quando a escolha abre e fecha (a página esconde as seções).
  onChoosing?(open: boolean): void;
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

export function UnitPicker({ userId, onChange, linkedUnitIds, onChoosing }: Props) {
  const [ units, setUnits ] = useState<HealthUnit[] | null>(null);
  const [ selected, setSelected ] = useState<HealthUnit | null>(null);
  const [ choosing, setChoosing ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const onChoosingRef = useRef(onChoosing);
  onChoosingRef.current = onChoosing;
  useEffect(() => { onChoosingRef.current?.(choosing); }, [ choosing ]);
  // Ao abrir a troca, o foco vai para a unidade atual (o botão "trocar" some);
  // assim Escape e as setas funcionam logo (I4).
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (choosing && selected) listRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }, [ choosing, selected ]);

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
    }).catch((err) => {
      if (cancelled) return;
      setError(attendanceError(err));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ userId ]);

  if (error) {
    return (
      <Panel title="Unidade">
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>
      </Panel>
    );
  }

  function choose(unit: HealthUnit) {
    writeStored(userId, unit.id);
    setSelected(unit);
    setChoosing(false);
    onChange(unit);
  }

  if (units === null) return null;

  if (selected && !choosing) {
    return (
      <Panel title="Unidade">
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
    <Panel title="Escolha a unidade" sub="Escolha a unidade para ver o check-in e a fila">
      <div ref={listRef} onKeyDown={(e) => { if (e.key === "Escape" && selected) setChoosing(false); }}>
      {units.length === 0 ? (
        <EmptyState title="nenhuma unidade ativa" sub="peça ao administrador para cadastrar uma" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {[ ...units ].sort((a, b) => Number(!!linkedUnitIds?.has(b.id)) - Number(!!linkedUnitIds?.has(a.id))).map((u) => (
            <button
              key={u.id}
              type="button"
              aria-current={selected?.id === u.id ? "true" : undefined}
              style={{ ...secondaryButtonStyle, textAlign: "left", display: "flex", alignItems: "center", gap: 8,
                ...(selected?.id === u.id ? { borderColor: "var(--accent)", fontWeight: 600 } : {}) }}
              onClick={() => choose(u)}
            >
              {u.name}
              {linkedUnitIds?.has(u.id) && <Tag tone="ok" mono={false}>seu vínculo</Tag>}
              {selected?.id === u.id && <Tag mono={false}>atual</Tag>}
            </button>
          ))}
          {selected && (
            <button type="button" style={{ ...secondaryButtonStyle, alignSelf: "flex-start" }} onClick={() => setChoosing(false)}>
              {`manter ${selected.name}`}
            </button>
          )}
        </div>
      )}
      </div>
    </Panel>
  );
}
