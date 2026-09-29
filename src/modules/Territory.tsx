import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createNeighborhood, listActiveUnits, listNeighborhoods, renameNeighborhood, replaceCoverage, setNeighborhoodActive,
  type Neighborhood
} from "../lib/api";
import {
  NEIGHBORHOODS_KEY, SOURCE_LABEL, normalizeName, sortByName, territoryError, validateNeighborhoodName
} from "../lib/territory";
import { PANEL_NEIGHBORHOODS_KEY } from "../lib/neighborhoodFilter";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { DataTable } from "../components/DataTable";
import { Tag } from "../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";

// Território (módulo 11; ADR 0023; spec 2026-09-28 §5): só municipal_admin,
// sem step-up (D8). Bairro não se apaga: desativa. A cobertura diz quais
// unidades ATIVAS atendem o bairro, e é dela que sai a unidade de referência
// do cidadão.
type Editing = { kind: "create" } | { kind: "rename"; neighborhood: Neighborhood };

export function Territory() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: NEIGHBORHOODS_KEY, queryFn: listNeighborhoods });
  const [ search, setSearch ] = useState("");
  const [ editing, setEditing ] = useState<Editing | null>(null);
  const [ covering, setCovering ] = useState<Neighborhood | null>(null);
  const [ busyId, setBusyId ] = useState<string | null>(null);
  const [ error, setError ] = useState<string | null>(null);

  function refresh() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: NEIGHBORHOODS_KEY });
    void queryClient.invalidateQueries({ queryKey: PANEL_NEIGHBORHOODS_KEY });
  }

  async function toggleActive(n: Neighborhood) {
    if (busyId) return;
    setBusyId(n.id); setError(null);
    try {
      await setNeighborhoodActive(n.id, !n.active);
      if (n.active && covering?.id === n.id) setCovering(null);
      refresh();
    } catch (err) {
      setError(territoryError(err));
    } finally {
      setBusyId(null);
    }
  }

  const key = normalizeName(search);
  const rows = sortByName(list.data ?? []).filter((n) => !key || normalizeName(n.name).includes(key));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Território" sub="bairros · cobertura" />

      {editing && (
        <NameDialog
          key={editing.kind === "rename" ? editing.neighborhood.id : "new"}
          editing={editing}
          onCancel={() => setEditing(null)}
          onDone={() => { setEditing(null); refresh(); }}
        />
      )}

      {covering && (
        <CoverageEditor
          key={covering.id}
          neighborhood={covering}
          onCancel={() => setCovering(null)}
          onDone={() => { setCovering(null); refresh(); }}
        />
      )}

      <Panel title="Bairros" right={
        <button type="button" style={buttonStyle} onClick={() => { setCovering(null); setEditing({ kind: "create" }); }}>
          Novo bairro
        </button>
      }>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {error && <p role="alert" style={alertStyle}>{error}</p>}
          {list.isError && <p role="alert" style={alertStyle}>{territoryError(list.error)}</p>}
          <label style={{ ...labelStyle, maxWidth: 320 }}>
            Buscar bairro
            <input value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle} />
          </label>
          {list.isPending ? (
            <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
          ) : (
            <DataTable<Neighborhood>
              cols={[
                { label: "Nome", w: "2fr", render: (n) => n.name },
                { label: "Origem", w: "1fr", render: (n) => <Tag>{SOURCE_LABEL[n.source] ?? n.source}</Tag> },
                { label: "Estado", w: "1fr", render: (n) => <Tag tone={n.active ? "ok" : undefined}>{n.active ? "ativo" : "inativo"}</Tag> },
                // Só as ativas contam: é o que entra na unidade de referência.
                { label: "Unidades", w: "1fr", align: "right", render: (n) =>
                  <span className="mono">{n.units.filter((u) => u.active).length}</span> },
                { label: "", w: "auto", align: "right", render: (n) => (
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button type="button" style={secondaryButtonStyle}
                      aria-label={`Renomear ${n.name}`}
                      onClick={() => { setCovering(null); setEditing({ kind: "rename", neighborhood: n }); }}>
                      Renomear
                    </button>
                    {n.active && (
                      <button type="button" style={secondaryButtonStyle} aria-label={`Cobertura de ${n.name}`}
                        onClick={() => { setEditing(null); setCovering(n); }}>
                        Cobertura
                      </button>
                    )}
                    <button type="button" disabled={busyId === n.id}
                      aria-label={`${n.active ? "Desativar" : "Reativar"} ${n.name}`}
                      style={busyId === n.id ? disabledButtonStyle : secondaryButtonStyle}
                      onClick={() => void toggleActive(n)}>
                      {n.active ? "Desativar" : "Reativar"}
                    </button>
                  </div>
                ) }
              ]}
              rows={rows}
              rowKey={(n) => n.id}
              empty={key ? "nenhum bairro com esse nome" : "nenhum bairro cadastrado — carregue a semente da cidade ou crie o primeiro"}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}

function NameDialog({ editing, onCancel, onDone }: { editing: Editing; onCancel(): void; onDone(): void }) {
  const [ name, setName ] = useState(editing.kind === "rename" ? editing.neighborhood.name : "");
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const title = editing.kind === "rename" ? `Renomear ${editing.neighborhood.name}` : "Novo bairro";

  async function save() {
    if (busy) return;
    const invalid = validateNeighborhoodName(name);
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(null);
    try {
      if (editing.kind === "rename") await renameNeighborhood(editing.neighborhood.id, name.trim());
      else await createNeighborhood(name.trim());
      onDone();
    } catch (err) {
      setError(territoryError(err));
      setBusy(false);
    }
  }

  return (
    <section role="dialog" aria-label={title} style={dialogStyle} onKeyDown={(e) => { if (e.key === "Escape" && !busy) onCancel(); }}>
      <strong>{title}</strong>
      {error && <p role="alert" style={alertStyle}>{error}</p>}
      <label style={labelStyle}>
        Nome do bairro
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy} onClick={() => void save()} style={busy ? disabledButtonStyle : buttonStyle}>Salvar</button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

function CoverageEditor({ neighborhood, onCancel, onDone }: { neighborhood: Neighborhood; onCancel(): void; onDone(): void }) {
  const units = useQuery({ queryKey: [ "activeUnits" ], queryFn: listActiveUnits });
  const [ selected, setSelected ] = useState<Set<string>>(
    () => new Set(neighborhood.units.filter((u) => u.active).map((u) => u.id)));
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  // Unidade desativada depois de entrar na cobertura: a API recusaria
  // (inactive_unit) se ela fosse junto, então sai — e a tela diz isso.
  const leaving = neighborhood.units.filter((u) => !u.active);
  const title = `Cobertura de ${neighborhood.name}`;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save() {
    if (busy || !units.data) return;
    setBusy(true); setError(null);
    try {
      await replaceCoverage(neighborhood.id, sortByName(units.data).filter((u) => selected.has(u.id)).map((u) => u.id));
      onDone();
    } catch (err) {
      setError(territoryError(err));
      setBusy(false);
    }
  }

  return (
    <section role="dialog" aria-label={title} style={dialogStyle} onKeyDown={(e) => { if (e.key === "Escape" && !busy) onCancel(); }}>
      <strong>{title}</strong>
      <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink3)" }}>
        unidades ativas que atendem o bairro — a unidade de referência do cidadão sai daqui
      </p>
      {error && <p role="alert" style={alertStyle}>{error}</p>}
      {units.isError && <p role="alert" style={alertStyle}>{territoryError(units.error)}</p>}
      {units.isPending ? (
        <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
      ) : (units.data ?? []).length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5 }}>nenhuma unidade ativa na cidade</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sortByName(units.data ?? []).map((u, i) => (
            <label key={u.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
              <input type="checkbox" autoFocus={i === 0} checked={selected.has(u.id)} onChange={() => toggle(u.id)} />
              {u.name}
            </label>
          ))}
        </div>
      )}
      {leaving.length > 0 && (
        <p role="note" style={{ margin: 0, fontSize: 12, color: "var(--warn)" }}>
          {`Unidades desativadas nesta cobertura saem da cobertura ao salvar: ${leaving.map((u) => u.name).join(", ")}`}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy || !units.data} onClick={() => void save()}
          style={busy || !units.data ? disabledButtonStyle : buttonStyle}>
          Salvar cobertura
        </button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
const alertStyle = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const dialogStyle = {
  display: "flex", flexDirection: "column" as const, gap: 10, padding: 16, maxWidth: 480,
  border: "1px solid var(--rule)", borderRadius: 8, background: "var(--panel)"
};
