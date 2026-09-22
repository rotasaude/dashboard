// Catálogo de módulos do dashboard (tenant-scoped). Subconjunto operacional do
// admin — sem o grupo Setup (cross-tenant) nem ScopePicker. Inclui `health`
// porque o Overview navega para queues/health.
export type ModuleId =
  | "overview" | "ingestion" | "conversations" | "consent"
  | "triages" | "classification" | "reports" | "protocols" | "events"
  | "queues" | "health" | "protocol-editor" | "security";

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
  { label: "Conta", items: [
    { id: "security", label: "Segurança", icon: "⚿" }
  ]}
];

export function labelFor(id: ModuleId): string {
  return NAV_GROUPS.flatMap(g => g.items).find(i => i.id === id)?.label ?? id;
}

// D6: "Conta" (autenticador, senha) é de usuário de cidade — um operador
// entra por grant e não tem essas telas no servidor (Mfa/PasswordsController
// exigem Current.user). Sem sessão ainda (tela de login carregando), mostra
// tudo: filtrar cedo demais esconderia o grupo por um instante para quem tem
// direito a ele.
export function navGroupsFor(user: { operator: boolean } | null): NavGroupDef[] {
  if (!user?.operator) return NAV_GROUPS;
  return NAV_GROUPS.filter((g) => g.label !== "Conta");
}
