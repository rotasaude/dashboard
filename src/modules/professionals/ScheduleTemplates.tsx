// Modelos de agenda (módulo 17; spec §3.2): lista e editor. Só
// municipal_admin. Mudar um modelo nunca apaga nem move horário marcado
// (ADR 0029): o que sair do modelo aparece como "fora do modelo" na agenda.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listAppointmentTypes, listScheduleTemplates, updateScheduleTemplate, type ScheduleTemplate } from "../../lib/api";
import { professionalError } from "../../lib/professionals";
import { blockLine } from "../../lib/scheduling";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { APPOINTMENT_TYPES_KEY } from "./AppointmentTypes";
import { TemplateEditor } from "./TemplateEditor";

export const SCHEDULE_TEMPLATES_KEY = [ "scheduleTemplates" ] as const;

export function ScheduleTemplates() {
  const queryClient = useQueryClient();
  const templates = useQuery({ queryKey: SCHEDULE_TEMPLATES_KEY, queryFn: listScheduleTemplates });
  const types = useQuery({ queryKey: APPOINTMENT_TYPES_KEY, queryFn: listAppointmentTypes });
  const [ editing, setEditing ] = useState<ScheduleTemplate | "new" | null>(null);
  const [ error, setError ] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: SCHEDULE_TEMPLATES_KEY });

  async function toggle(t: ScheduleTemplate) {
    setError(null);
    try {
      await updateScheduleTemplate(t.id, { active: !t.active });
      refresh();
    } catch (err) {
      setError(professionalError(err));
    }
  }

  const loadError = templates.error ?? types.error;

  return (
    <Panel title="Modelos de agenda" sub="faixas do turno · limite de encaixes"
      right={<button type="button" style={buttonStyle} onClick={() => setEditing("new")}>Novo modelo</button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{error}</p>}
        {loadError ? <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{professionalError(loadError)}</p>
          : templates.isPending || types.isPending ? <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
          : (templates.data ?? []).length === 0 ? <EmptyState title="nenhum modelo — turno sem modelo vira vagas do tipo padrão" />
          : (
            <DataTable<ScheduleTemplate>
              cols={[
                { label: "Nome", w: "1.5fr", render: (t) => t.name },
                { label: "Faixas", w: "4fr", render: (t) => (
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {t.blocks.map((b, i) => <span key={i}>{blockLine(b, types.data ?? [])}</span>)}
                  </span>
                ) },
                { label: "Encaixes", w: "1fr", render: (t) => `${t.fit_in_limit} por turno` },
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
              rows={templates.data ?? []}
              rowKey={(t) => t.id}
            />
          )}
        {editing && types.data && (
          <TemplateEditor
            key={editing === "new" ? "new" : editing.id}
            template={editing === "new" ? null : editing}
            types={types.data}
            onSaved={() => { setEditing(null); refresh(); }}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
    </Panel>
  );
}
