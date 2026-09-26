import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createUnit, listAllUnits, setUnitActive, updateUnit, type HealthUnitRow } from "../../lib/api";
import { UNIT_KINDS, attendanceError } from "../../lib/attendance";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

// Units (Task 6) — cadastro de unidades de saúde, só para municipal_admin.
// Lista + criar/editar (mesmo formulário, com/sem id) + desativar/reativar.
// Criar ou reativar muda quem entra em "unidades ativas" (UnitPicker,
// destino de encaminhamento em UnitQueue): invalida a query `activeUnits`
// para essas telas recarregarem (card dashboard#4, item 1 — Task 7).
const KIND_LABEL: Record<string, string> = Object.fromEntries(UNIT_KINDS.map((k) => [ k.value, k.label ]));

interface FormState { id: string | null; name: string; kind: string }

export function Units() {
  const queryClient = useQueryClient();
  const [ rows, setRows ] = useState<HealthUnitRow[] | null>(null);
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ form, setForm ] = useState<FormState | null>(null);

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

  async function save() {
    if (busy || !form || !form.name.trim()) return;
    setBusy(true); setError(null);
    try {
      if (form.id) {
        await updateUnit(form.id, form.name, form.kind);
      } else {
        await createUnit(form.name, form.kind);
        void queryClient.invalidateQueries({ queryKey: [ "activeUnits" ] });
      }
      setForm(null);
      await load();
    } catch (err) {
      setError(attendanceError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Unidades"
      right={!form && <button type="button" style={buttonStyle} onClick={() => setForm({ id: null, name: "", kind: "ubs" })}>Nova unidade</button>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}

        {form && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 320 }}>
            <label style={labelStyle}>
              Nome
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Tipo
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                style={inputStyle}
              >
                {UNIT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                disabled={busy || !form.name.trim()}
                onClick={() => void save()}
                style={(busy || !form.name.trim()) ? disabledButtonStyle : buttonStyle}
              >
                Salvar
              </button>
              <button type="button" disabled={busy} onClick={() => setForm(null)} style={secondaryButtonStyle}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {rows && (
          <DataTable<HealthUnitRow>
            cols={[
              { label: "Nome", w: "2fr", render: (r) => r.name },
              { label: "Tipo", w: "1fr", render: (r) => KIND_LABEL[r.kind] ?? r.kind },
              { label: "Situação", w: "1fr", render: (r) => <Tag tone={r.active ? "ok" : undefined}>{r.active ? "ativa" : "inativa"}</Tag> },
              {
                label: "", w: "auto", align: "right", render: (r) => (
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => setForm({ id: r.id, name: r.name, kind: r.kind })}>
                      Editar
                    </button>
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

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
