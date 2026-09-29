import { useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { CAMPAIGN_MANAGER_ROLE } from "../lib/campaigns";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import type { ModuleId } from "../shell/modules";
import { CampaignList } from "./campaigns/CampaignList";
import { CampaignEditor } from "./campaigns/CampaignEditor";
import { CampaignPanel } from "./campaigns/CampaignPanel";
import { SmsSettingPanel } from "./campaigns/SmsSettingPanel";

// Campanhas (módulo 12; ADR 0024; spec 2026-09-29 §7). O campaign_manager
// lista, edita, envia e acompanha; o municipal_admin liga o SMS da cidade.
// Quem é só municipal_admin nunca chama GET /campaigns (a API responderia
// 403). As vistas trocam por estado, sem URL, como em Profissionais.
type View = { kind: "list" } | { kind: "edit"; id: string | null } | { kind: "view"; id: string };

export function Campaigns({ onNavigate }: { onNavigate(id: ModuleId): void }) {
  const { user, state } = useAuth();
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const isManager = roles.includes(CAMPAIGN_MANAGER_ROLE);
  const isAdmin = roles.includes("municipal_admin");
  const [ view, setView ] = useState<View>({ kind: "list" });
  const toList = () => setView({ kind: "list" });
  const goToSecurity = () => onNavigate("security");

  let content: ReactNode;
  // Antes da sessão carregar, roles = [] — não é "sem papel" ainda.
  if (state.kind === "loading") {
    content = <p className="mono" style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>carregando…</p>;
  } else if (isManager && view.kind === "edit") {
    content = (
      <CampaignEditor key={view.id ?? "new"} campaignId={view.id} onBack={toList}
        onLeftDraft={(c) => setView({ kind: "view", id: c.id })} onGoToSecurity={goToSecurity} />
    );
  } else if (isManager && view.kind === "view") {
    content = (
      <CampaignPanel key={view.id} campaignId={view.id} onBack={toList}
        onEdit={(id) => setView({ kind: "edit", id })} onGoToSecurity={goToSecurity} />
    );
  } else {
    content = (
      <>
        {isAdmin && <SmsSettingPanel onGoToSecurity={goToSecurity} />}
        {isManager ? (
          <CampaignList
            onNew={() => setView({ kind: "edit", id: null })}
            onOpen={(c) => setView(c.status === "draft" ? { kind: "edit", id: c.id } : { kind: "view", id: c.id })}
          />
        ) : isAdmin ? (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink2)" }}>
            Criar e enviar campanhas é do papel gestor de campanhas (conceda em Equipe). Aqui você liga ou desliga o SMS da cidade.
          </p>
        ) : (
          <EmptyState title="seu papel não dá acesso a campanhas" />
        )}
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Campanhas" sub="avisos no wpda · sms opcional" />
      {content}
    </div>
  );
}
