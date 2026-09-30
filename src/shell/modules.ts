// Catálogo de módulos do dashboard (tenant-scoped). Subconjunto operacional do
// admin — sem o grupo Setup (cross-tenant) nem ScopePicker. Inclui `health`
// porque o Overview navega para queues/health.
export type ModuleId =
  | "overview" | "ingestion" | "conversations" | "consent"
  | "triages" | "classification" | "reports" | "protocols" | "events"
  | "queues" | "health" | "protocol-editor" | "security" | "team" | "attendance"
  | "professionals" | "my-profile" | "territory" | "campaigns" | "analytics";

export interface NavItem { id: ModuleId; label: string; icon: string; }
export interface NavGroupDef { label: string; items: NavItem[]; }

export const NAV_GROUPS: NavGroupDef[] = [
  { label: "Visão geral", items: [{ id: "overview", label: "Visão geral", icon: "▦" }] },
  { label: "Aquisição", items: [
    { id: "ingestion", label: "Ingestão", icon: "↘" },
    { id: "conversations", label: "Conversas", icon: "⇄" },
    { id: "consent", label: "Consentimento", icon: "✓" }
  ]},
  { label: "Triagem", items: [
    { id: "triages", label: "Triagens", icon: "≣" },
    { id: "classification", label: "Classificação", icon: "◔" },
    { id: "reports", label: "Relatórios", icon: "▤" }
  ]},
  { label: "Análise", items: [
    { id: "analytics", label: "Analytics", icon: "∿" }
  ]},
  { label: "Governança", items: [
    { id: "protocols", label: "Protocolos", icon: "❏" },
    { id: "protocol-editor", label: "Editor de protocolo", icon: "✎" },
    { id: "events", label: "Eventos & auditoria", icon: "❖" }
  ]},
  { label: "Operação", items: [
    { id: "queues", label: "Filas & jobs", icon: "≋" },
    { id: "health", label: "Saúde", icon: "◍" }
  ]},
  { label: "Atendimento", items: [
    { id: "attendance", label: "Atendimento", icon: "☑" }
  ]},
  { label: "Comunicação", items: [
    { id: "campaigns", label: "Campanhas", icon: "✉" }
  ]},
  { label: "Equipe", items: [
    { id: "team", label: "Equipe", icon: "☷" },
    { id: "professionals", label: "Profissionais", icon: "✚" }
  ]},
  { label: "Cidade", items: [
    { id: "territory", label: "Território", icon: "⌖" }
  ]},
  { label: "Conta", items: [
    { id: "security", label: "Segurança", icon: "⚿" },
    { id: "my-profile", label: "Meu perfil", icon: "☺" }
  ]}
];

export function labelFor(id: ModuleId): string {
  return NAV_GROUPS.flatMap(g => g.items).find(i => i.id === id)?.label ?? id;
}

// D6: "Conta" (autenticador, senha) é de usuário de cidade — um operador
// entra por grant e não tem essas telas no servidor. Sem sessão ainda,
// mostra tudo: filtrar cedo demais esconderia o grupo por um instante para
// quem tem direito a ele.
//
// Fatia 2: "Equipe" é o contrário — só municipal_admin, e escondido enquanto
// não se sabe quem é. A API recusaria (403) para qualquer outro papel, então
// oferecer o item antes da sessão seria oferecer uma porta trancada.
export function navGroupsFor(
  user: { operator: boolean; memberships?: { role: string }[] } | null
): NavGroupDef[] {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const isAdmin = roles.includes("municipal_admin");
  const canAttend = isAdmin || roles.includes("citizen_verifier") || roles.includes("health_professional");
  const isProfessional = roles.includes("health_professional");
  // Módulo 12: /campaigns é do campaign_manager; o municipal_admin sem o
  // papel entra para a chave de SMS da cidade (spec 2026-09-29 §7).
  const canCampaigns = isAdmin || roles.includes("campaign_manager");
  // Módulo 14 (ADR 0025, D6/D12): Analytics é do analyst e do municipal_admin
  // da cidade; o operador, com ou sem grant, nunca (a API responde 403).
  const canAnalytics = !user?.operator && (isAdmin || roles.includes("analyst"));
  return NAV_GROUPS.filter((group) => {
    if (group.label === "Conta") return !user?.operator;
    if (group.label === "Equipe") return isAdmin;
    // Módulo 11: /territory recusa (403 missing_role) quem não é municipal_admin.
    if (group.label === "Cidade") return isAdmin;
    if (group.label === "Comunicação") return canCampaigns;
    if (group.label === "Análise") return canAnalytics;
    if (group.label === "Atendimento") return canAttend;
    return true;
  }).map((group) => ({
    ...group,
    // Módulo 10: "Meu perfil" é do profissional; sem sessão ainda, some
    // (a API responderia 404 no_profile para quem não é profissional).
    items: group.items.filter((item) => item.id !== "my-profile" || isProfessional)
  }));
}
