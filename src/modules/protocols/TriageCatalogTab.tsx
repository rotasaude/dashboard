// src/modules/protocols/TriageCatalogTab.tsx
// Aba "Catálogo de triagens" (módulo 15; spec §7; ADR 0027). Uma linha por
// protocolo com versão em uso. Leitura para os papéis de protocolo; o
// municipal_admin clica na linha para editar, com step-up.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listPanelNeighborhoods, listTriageCatalog, type TriageOffer } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fieldsFor } from "../../lib/condition";
import { describeCondition } from "../../lib/conditionPhrase";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { todayInCity } from "../../lib/campaigns";
import { COUNTER_HINT, TRIAGE_CATALOG_KEY, canEditCatalog, canReadCatalog, fmtCounter, offerState, periodPhrase } from "../../lib/triageCatalog";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { Skeleton } from "../../components/Skeleton";
import { ErrorState } from "../../components/ErrorState";
import type { ModuleId } from "../../shell/modules";
import { TriageOfferForm } from "./TriageOfferForm";

export function TriageCatalogTab({ onNavigate }: { onNavigate?: (id: ModuleId) => void } = {}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const roles = (auth.user?.memberships ?? []).map((m) => m.role);
  const canEdit = canEditCatalog(roles);
  const canRead = canReadCatalog(roles);
  const catalog = useQuery({ queryKey: TRIAGE_CATALOG_KEY, queryFn: listTriageCatalog, enabled: canRead });
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, enabled: canRead });
  const [ editing, setEditing ] = useState<TriageOffer | null>(null);
  const [ done, setDone ] = useState<string | null>(null);

  if (catalog.isLoading) return <Panel title="Catálogo de triagens"><Skeleton rows={4} /></Panel>;
  if (catalog.isError) return <ErrorState message="não foi possível carregar o catálogo" onRetry={() => void catalog.refetch()} />;

  const offers = catalog.data ?? [];
  const profileFields = fieldsFor("eligibility");
  const restrictionFields = fieldsFor("restriction", { neighborhoods: neighborhoods.data ?? [] });
  const today = todayInCity();

  return (
    <Panel title="Catálogo de triagens" sub={canEdit ? "clique numa linha para editar" : "somente leitura"}>
      {done && <p role="status" style={{ margin: "0 0 8px", fontSize: 12.5 }}>{done}</p>}
      <DataTable<TriageOffer>
        cols={[
          { label: "Ordem", w: "0.5fr", render: (o) => <span className="mono">{o.position ?? "—"}</span> },
          {
            label: "Protocolo", w: "1.6fr", render: (o) => (
              <span>
                <strong>{o.title}</strong>{" "}
                <span className="mono" style={{ color: "var(--ink3)" }}>{o.protocol_name} v{o.active_version}</span>
              </span>
            )
          },
          { label: "Elegibilidade", w: "1.6fr", render: (o) => describeCondition(o.eligibility, profileFields, "para todos") },
          { label: "Restrição da cidade", w: "1.6fr", render: (o) => describeCondition(o.restriction, restrictionFields, "nenhuma") },
          { label: "Período", w: "1fr", render: (o) => periodPhrase(o.available_from, o.available_until) },
          {
            label: "Situação", w: "1fr", render: (o) => {
              const state = offerState(o, today);
              return <Tag tone={state.tone}>{state.label}</Tag>;
            }
          },
          {
            label: "Oferecida · iniciada · concluída · de sugestão", w: "1.4fr", render: (o) => (
              <span className="mono" title={COUNTER_HINT}>
                {[ o.counters.offered, o.counters.started, o.counters.completed, o.counters.from_suggestion ].map(fmtCounter).join(" · ")}
              </span>
            )
          }
        ]}
        rows={offers}
        rowKey={(o) => o.protocol_name}
        onRowClick={canEdit ? (o) => { setDone(null); setEditing(o); } : undefined}
        empty="nenhum protocolo em uso nesta cidade"
      />
      <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--ink3)" }}>{COUNTER_HINT}</p>
      {editing && (
        <TriageOfferForm
          key={editing.protocol_name}
          offer={editing}
          all={offers}
          onCancel={() => setEditing(null)}
          onGoToSecurity={() => onNavigate?.("security")}
          onSaved={() => {
            setDone(`Catálogo atualizado: ${editing.title}`);
            setEditing(null);
            void queryClient.invalidateQueries({ queryKey: TRIAGE_CATALOG_KEY });
          }}
        />
      )}
    </Panel>
  );
}
