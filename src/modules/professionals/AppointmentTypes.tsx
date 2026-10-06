// src/modules/professionals/AppointmentTypes.tsx
// Tipos de atendimento (módulo 17; spec §3.1, contratos §3): base da
// plataforma copiada para a cidade + tipos próprios. Escrita só do
// municipal_admin (outros papéis leem a lista, mas não por esta tela).
// Tipo da plataforma não muda chave nem grupos de CBO; desativar nunca
// quebra pedido ou horário existente (ADR 0029).
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createAppointmentType, listAppointmentTypes, updateAppointmentType, type AppointmentType } from "../../lib/api";
import { professionalError } from "../../lib/professionals";
import { parseCboPrefixes, typeDraftFrom, typeDraftProblem, type TypeDraft } from "../../lib/scheduling";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

export const APPOINTMENT_TYPES_KEY = [ "appointmentTypes" ] as const;

export function AppointmentTypes() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: APPOINTMENT_TYPES_KEY, queryFn: listAppointmentTypes });
  const [ editing, setEditing ] = useState<AppointmentType | "new" | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: APPOINTMENT_TYPES_KEY });

  async function toggle(t: AppointmentType) {
    setError(null);
    try {
      await updateAppointmentType(t.key, { active: !t.active });
      refresh();
    } catch (err) {
      setError(professionalError(err));
    }
  }

  return (
    <Panel title="Tipos de atendimento" sub="base da plataforma · tipos da cidade"
      right={<button type="button" style={buttonStyle} onClick={() => setEditing("new")}>Novo tipo</button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={alert}>{error}</p>}
        {query.isError ? <p role="alert" style={alert}>{professionalError(query.error)}</p>
          : query.isPending ? <p className="mono" style={hint}>carregando…</p>
          : (query.data ?? []).length === 0 ? <EmptyState title="nenhum tipo de atendimento" />
          : (
            <DataTable<AppointmentType>
              cols={[
                { label: "Nome", w: "2fr", render: (t) => t.name },
                { label: "Chave", w: "2fr", render: (t) => <span className="mono">{t.key}</span> },
                { label: "Duração", w: "1fr", render: (t) => `${t.duration_minutes} min` },
                { label: "Grupos de CBO", w: "2fr", render: (t) => t.cbo_prefixes.join(", ") },
                { label: "Origem", w: "1fr", render: (t) => <Tag>{t.origin === "platform" ? "plataforma" : "cidade"}</Tag> },
                { label: "Situação", w: "1fr", render: (t) => t.active ? "ativo" : <Tag tone="warn">inativo</Tag> },
                { label: "", w: "auto", align: "right", render: (t) => (
                  <span style={{ display: "flex", gap: 6 }}>
                    <button type="button" style={secondaryButtonStyle} onClick={() => setEditing(t)}>Editar</button>
                    <button type="button" style={secondaryButtonStyle} onClick={() => void toggle(t)}>
                      {t.active ? "Desativar" : "Reativar"}
                    </button>
                  </span>
                ) }
              ]}
              rows={query.data ?? []}
              rowKey={(t) => t.key}
            />
          )}
        {editing && (
          <TypeForm
            key={editing === "new" ? "new" : editing.key}
            type={editing === "new" ? null : editing}
            onDone={() => { setEditing(null); refresh(); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </Panel>
  );
}

function TypeForm({ type, onDone, onCancel }: { type: AppointmentType | null; onDone(): void; onCancel(): void }) {
  const mode = type ? "edit" : "create";
  const locked = type?.origin === "platform";
  const [ draft, setDraft ] = useState<TypeDraft>(() => typeDraftFrom(type));
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const problem = typeDraftProblem(draft, mode);
  const set = (patch: Partial<TypeDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    if (busy || problem) return;
    const name = draft.name.trim();
    const duration = Number(draft.duration);
    const cbo = parseCboPrefixes(draft.cbo) ?? [];
    setBusy(true); setError(null);
    try {
      if (!type) {
        await createAppointmentType({ key: draft.key, name, duration_minutes: duration, cbo_prefixes: cbo });
      } else {
        await updateAppointmentType(type.key, locked
          ? { name, duration_minutes: duration }
          : { name, duration_minutes: duration, cbo_prefixes: cbo });
      }
      onDone();
    } catch (err) {
      setError(professionalError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={box}>
      <strong>{type ? `Editar ${type.name}` : "Novo tipo de atendimento"}</strong>
      {error && <p role="alert" style={alert}>{error}</p>}
      {type ? <span className="mono" style={hint}>{type.key}</span> : (
        <label style={label}>Chave
          <input value={draft.key} onChange={(e) => set({ key: e.target.value })} style={inputStyle} placeholder="pre_natal" />
        </label>
      )}
      <label style={label}>Nome<input value={draft.name} onChange={(e) => set({ name: e.target.value })} style={inputStyle} /></label>
      <label style={label}>Duração (min)
        <input inputMode="numeric" value={draft.duration} onChange={(e) => set({ duration: e.target.value })} style={inputStyle} />
      </label>
      <label style={label}>Grupos de CBO
        <input value={draft.cbo} disabled={locked} onChange={(e) => set({ cbo: e.target.value })} style={inputStyle}
          placeholder="2251, 2252" />
      </label>
      {locked && <small style={hint}>tipo da plataforma: chave e grupos de CBO fixos</small>}
      {problem && <small style={hint}>{problem}</small>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={!!problem || busy} onClick={() => void save()}
          style={problem || busy ? disabledButtonStyle : buttonStyle}>Salvar tipo</button>
        <button type="button" disabled={busy} onClick={onCancel} style={secondaryButtonStyle}>Cancelar</button>
      </div>
    </section>
  );
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)", maxWidth: 360 };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
