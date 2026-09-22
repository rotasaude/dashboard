// Catálogo de módulos do dashboard (tenant-scoped). Subconjunto operacional do
// admin — sem o grupo Setup (cross-tenant) nem ScopePicker. Inclui `health`
// porque o Overview navega para queues/health.
export type ModuleId =
  | "overview" | "ingestion" | "conversations" | "consent"
  | "triages" | "classification" | "reports" | "protocols" | "events"
  | "queues" | "health" | "protocol-editor" | "security" | "team";

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
  { label: "Governança", items: [
    { id: "protocols", label: "Protocolos", icon: "❏" },
    { id: "protocol-editor", label: "Editor de protocolo", icon: "✎" },
    { id: "events", label: "Eventos & auditoria", icon: "❖" }
  ]},
  { label: "Operação", items: [
    { id: "queues", label: "Filas & jobs", icon: "≋" },
    { id: "health", label: "Saúde", icon: "◍" }
  ]},
  { label: "Equipe", items: [
    { id: "team", label: "Equipe", icon: "☷" }
  ]},
  { label: "Conta", items: [
    { id: "security", label: "Segurança", icon: "⚿" }
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
  const isAdmin = user?.memberships?.some((m) => m.role === "municipal_admin") ?? false;
  return NAV_GROUPS.filter((group) => {
    if (group.label === "Conta") return !user?.operator;
    if (group.label === "Equipe") return isAdmin;
    return true;
  });
}
