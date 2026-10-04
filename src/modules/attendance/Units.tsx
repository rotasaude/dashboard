import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createUnit, listAllUnits, listNeighborhoods, setUnitActive, updateUnit, type HealthUnitRow } from "../../lib/api";
import { UNIT_KINDS, attendanceError } from "../../lib/attendance";
import { NEIGHBORHOODS_KEY } from "../../lib/territory";
import { EMPTY_ADDRESS_FIELDS, addressFieldsFrom, addressPayload, formatAddress } from "../../lib/unitAddress";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { UnitForm, type UnitFormValue } from "./UnitForm";
import { DrainUnitPanel } from "./DrainUnitPanel";

// Units (Task 6) — cadastro de unidades de saúde, só para municipal_admin.
// Lista + criar/editar (UnitForm, com/sem id) + desativar/reativar. Desde o
// módulo 11 a unidade tem endereço (CEP pelo ViaCEP) e o bairro onde fica.
// Criar ou reativar muda quem entra em "unidades ativas" (UnitPicker,
// destino de encaminhamento em UnitQueue): invalida a query `activeUnits`
// para essas telas recarregarem (card dashboard#4, item 1 — Task 7).
const KIND_LABEL: Record<string, string> = Object.fromEntries(UNIT_KINDS.map((k) => [ k.value, k.label ]));

interface Editing { id: string | null; initial: UnitFormValue }

export function Units() {
  const queryClient = useQueryClient();
  const neighborhoods = useQuery({ queryKey: NEIGHBORHOODS_KEY, queryFn: listNeighborhoods });
  const [ rows, setRows ] = useState<HealthUnitRow[] | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ editing, setEditing ] = useState<Editing | null>(null);
  const [ draining, setDraining ] = useState<HealthUnitRow | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await listAllUnits());
    } catch (err) {
      setError(attendanceError(err));
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggleActive(row: HealthUnitRow) {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await setUnitActive(row.id, !row.active);
      if (!row.active) void queryClient.invalidateQueries({ queryKey: [ "activeUnits" ] });
      await load();
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(value: UnitFormValue) {
    if (busy || !editing) return;
    setBusy(true); setError(null);
    try {
      const address = addressPayload(value);
      if (editing.id) {
        await updateUnit(editing.id, value.name, value.kind, address);
      } else {
        await createUnit(value.name, value.kind, address);
        void queryClient.invalidateQueries({ queryKey: [ "activeUnits" ] });
      }
      setEditing(null);
      await load();
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  const nameOf = new Map((neighborhoods.data ?? []).map((n) => [ n.id, n.name ]));

  return (
    <Panel
      title="Unidades"
      right={!editing && (
        <button type="button" style={buttonStyle}
          onClick={() => setEditing({ id: null, initial: { name: "", kind: "ubs", ...EMPTY_ADDRESS_FIELDS } })}>
          Nova unidade
        </button>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
        {notice && <p role="status" style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>{notice}</p>}

        {draining && rows && (
          <DrainUnitPanel
            key={draining.id}
            unit={draining}
            units={rows}
            onCancel={() => setDraining(null)}
            onDone={(result, target) => {
              setDraining(null);
              setNotice(`${draining.name} esvaziada: ${result.requests_count} ${result.requests_count === 1 ? "pedido" : "pedidos"} e ` +
                `${result.appointments_count} ${result.appointments_count === 1 ? "horário foi" : "horários foram"} para ${target.name}. ` +
                "Se nada novo chegar a ela, já pode ser desativada.");
              void queryClient.invalidateQueries({ queryKey: [ "unitRequests" ] });
              void queryClient.invalidateQueries({ queryKey: [ "unitAgenda" ] });
              void load();
            }}
          />
        )}

        {editing && (
          <UnitForm
            key={editing.id ?? "new"}
            initial={editing.initial}
            neighborhoods={neighborhoods.data ?? []}
            busy={busy}
            onSave={(value) => void save(value)}
            onCancel={() => setEditing(null)}
          />
        )}

        {rows && (
          <DataTable<HealthUnitRow>
            cols={[
              { label: "Nome", w: "2fr", render: (r) => r.name },
              { label: "Tipo", w: "1fr", render: (r) => KIND_LABEL[r.kind] ?? r.kind },
              { label: "Endereço", w: "3fr", render: (r) =>
                formatAddress(r, r.neighborhood_id ? nameOf.get(r.neighborhood_id) : null) },
              { label: "Situação", w: "1fr", render: (r) => <Tag tone={r.active ? "ok" : undefined}>{r.active ? "ativa" : "inativa"}</Tag> },
              {
                label: "", w: "auto", align: "right", render: (r) => (
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" style={secondaryButtonStyle}
                      onClick={() => setEditing({ id: r.id, initial: { name: r.name, kind: r.kind, ...addressFieldsFrom(r) } })}>
                      Editar
                    </button>
                    {r.active && ((r.live_requests_count ?? 0) + (r.live_appointments_count ?? 0)) > 0 && (
                      <button type="button" style={secondaryButtonStyle} disabled={busy}
                        onClick={() => { setNotice(null); setDraining(r); }}>
                        Esvaziar
                      </button>
                    )}
                    <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={() => void toggleActive(r)}>
                      {r.active ? "Desativar" : "Reativar"}
                    </button>
                  </div>
                )
              }
            ]}
            rows={rows}
            rowKey={(r) => r.id}
            empty="nenhuma unidade cadastrada"
          />
        )}
      </div>
    </Panel>
  );
}
