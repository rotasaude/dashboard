// Catálogo de módulos do dashboard (tenant-scoped). Subconjunto operacional do
// admin — sem o grupo Setup (cross-tenant) nem ScopePicker. Inclui `health`
// porque o Overview navega para queues/health.
import { hasFeature } from "../lib/features";
import { canSeeSignatureOverview, canSign } from "../lib/signature";
import { canRequestSncr, canSeeSncrOverview } from "../lib/controlled";
export type ModuleId =
  | "overview" | "ingestion" | "conversations" | "consent"
  | "triages" | "classification" | "reports" | "protocols" | "events"
  | "queues" | "health" | "protocol-editor" | "security" | "team" | "attendance"
  | "professionals" | "my-profile" | "territory" | "campaigns" | "analytics"
  | "integrations" | "cnes" | "production" | "my-agenda" | "clinical-record" | "my-consultations" | "professional-consultations" | "open-drafts"
  | "signature" | "signature-pending" | "signature-overview" | "clinical-documents-admin" | "sncr" | "sncr-overview"
  | "exam-acknowledgements" | "exams-unit" | "exams-overdue" | "exam-regulation" | "exam-report" | "exams-admin" | "exam-provider";

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
    { id: "attendance", label: "Atendimento", icon: "☑" },
    { id: "my-agenda", label: "Minha agenda", icon: "◷" },
    { id: "signature-pending", label: "Pendentes de assinatura", icon: "⧗" },
    { id: "clinical-record", label: "Prontuário", icon: "⚕" },
    { id: "my-consultations", label: "Minhas consultas", icon: "☰" },
    { id: "professional-consultations", label: "Consultas por profissional", icon: "☷" },
    { id: "open-drafts", label: "Rascunhos abertos", icon: "✎" }
  ]},
  { label: "Exames", items: [
    { id: "exam-acknowledgements", label: "Resultados aguardando ciência", icon: "⚑" },
    { id: "exams-unit", label: "Exames da unidade", icon: "⚗" },
    { id: "exams-overdue", label: "Exames atrasados", icon: "⏱" },
    { id: "exam-regulation", label: "Fila de regulação", icon: "⚖" },
    { id: "exam-report", label: "Conferência de exames", icon: "▤" },
    { id: "exams-admin", label: "Catálogo e prestadores", icon: "⚙" },
    { id: "exam-provider", label: "Portal do prestador", icon: "⇆" }
  ]},
  { label: "Comunicação", items: [
    { id: "campaigns", label: "Campanhas", icon: "✉" }
  ]},
  { label: "Equipe", items: [
    { id: "team", label: "Equipe", icon: "☷" },
    { id: "professionals", label: "Profissionais", icon: "✚" },
    { id: "signature-overview", label: "Painel de assinatura", icon: "✍" },
    { id: "sncr-overview", label: "Painel do SNCR", icon: "№" }
  ]},
  { label: "Cidade", items: [
    { id: "territory", label: "Território", icon: "⌖" },
    { id: "clinical-documents-admin", label: "Documentos clínicos", icon: "℞" }
  ]},
  { label: "e-SUS", items: [
    { id: "integrations", label: "Integrações", icon: "⇌" },
    { id: "cnes", label: "CNES", icon: "⌗" },
    { id: "production", label: "Produção e-SUS", icon: "⇪" }
  ]},
  { label: "Conta", items: [
    { id: "security", label: "Segurança", icon: "⚿" },
    { id: "my-profile", label: "Meu perfil", icon: "☺" },
    { id: "signature", label: "Assinatura digital", icon: "✍" },
    { id: "sncr", label: "SNCR", icon: "№" }
  ]}
];

export function labelFor(id: ModuleId): string {
  return NAV_GROUPS.flatMap(g => g.items).find(i => i.id === id)?.label ?? id;
}

// Módulo 19b (Divergência D3): o `return_to` que o dashboard manda ao api é
// "/<id do módulo>" — a navegação é por estado, não por URL. Só vale o
// caminho EXATO de um módulo do catálogo (sem subcaminho, query nem fragmento);
// qualquer outra coisa é null, e quem chama cai na visão geral.
export function moduleFromPath(path: string | null | undefined): ModuleId | null {
  const match = typeof path === "string" ? /^\/([a-z][a-z-]*)$/.exec(path) : null;
  if (!match) return null;
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === match[1]);
  return item ? item.id : null;
}

// D6: "Conta" (autenticador, senha) é de usuário de cidade — um operador
// entra por grant e não tem essas telas no servidor. Sem sessão ainda,
// mostra tudo: filtrar cedo demais esconderia o grupo por um instante para
// quem tem direito a ele.
//
// Fatia 2: "Equipe" é o contrário — só municipal_admin, e escondido enquanto
// não se sabe quem é. A API recusaria (403) para qualquer outro papel, então
// oferecer o item antes da sessão seria oferecer uma porta trancada.
// Módulo 21a: o usuário do prestador é só do portal; o shell também usa
// este predicado para não rodar alertas de infra nem oferecer o sino.
export function isExamProvider(user: { operator: boolean; memberships?: { role: string }[] } | null): boolean {
  return !!user && !user.operator && !!user.memberships?.some((m) => m.role === "exam_provider");
}

export function navGroupsFor(
  user: { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null
): NavGroupDef[] {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  // Módulo 21a (spec §6): o usuário do prestador vê só o portal e a
  // Segurança — nada de painel, atendimento ou prontuário. O api isola de
  // novo (403/404); aqui só não se oferece a porta.
  if (isExamProvider(user)) {
    return NAV_GROUPS.flatMap((group) => {
      const items = group.items.filter((item) =>
        item.id === "security" || (item.id === "exam-provider" && hasFeature(user, "exam_tracking")));
      return items.length > 0 ? [ { ...group, items } ] : [];
    });
  }
  const isAdmin = roles.includes("municipal_admin");
  const canAttend = isAdmin || roles.includes("citizen_verifier") || roles.includes("health_professional");
  const isProfessional = roles.includes("health_professional");
  // Módulo 12: /campaigns é do campaign_manager; o municipal_admin sem o
  // papel entra para a chave de SMS da cidade (spec 2026-09-29 §7).
  const canCampaigns = isAdmin || roles.includes("campaign_manager");
  // Módulo 14 (ADR 0025, D6/D12): Analytics é do analyst e do municipal_admin
  // da cidade; o operador, com ou sem grant, nunca (a API responde 403).
  const canAnalytics = !user?.operator && (isAdmin || roles.includes("analyst"));
  // Módulo 16 (ADR 0028; contratos §1 e §5): Integrações e CNES são do
  // municipal_admin; Produção é também do analyst e só aparece com
  // `ledi_export` ligado na sessão. O operador nunca vê o grupo.
  const canIntegrations = !user?.operator && isAdmin;
  const canProduction = !user?.operator && (isAdmin || roles.includes("analyst")) && hasFeature(user, "ledi_export");
  // Módulo 19 (ADR 0031): abertura justificada do profissional e relatório do
  // municipal_admin, só com `clinical_record` ligado; a recepção nunca.
  // Módulo 20: com só `patient_timeline` (modo integrated), a abertura
  // justificada da linha do tempo, só do profissional.
  // O relatório das aberturas do admin também vale com só `patient_timeline`
  // (o api aceita um ou outro em /clinical_record/openings).
  const canClinicalRecord = !user?.operator && (isProfessional || isAdmin) && (
    hasFeature(user, "clinical_record") || hasFeature(user, "patient_timeline")
  );
  // Módulo 21a: tudo de exames só com `exam_tracking` ligado na sessão.
  // O administrador não é equipe de unidade (C4): sem "Exames da unidade".
  const examsOn = !user?.operator && hasFeature(user, "exam_tracking");
  const isRegulator = roles.includes("exam_regulator");
  const isReception = roles.includes("citizen_verifier");
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
    items: group.items.filter((item) => {
      // Módulo 10: "Meu perfil" é do profissional; sem sessão ainda, some
      // (a API responderia 404 no_profile para quem não é profissional).
      if (item.id === "my-profile") return isProfessional;
      // Módulo 17: "Minha agenda" idem (GET /me/agenda responde 403/404 a quem não é).
      if (item.id === "my-agenda") return isProfessional;
      if (item.id === "clinical-record") return canClinicalRecord;
      // Task 17: leitura das próprias consultas, só do profissional.
      if (item.id === "my-consultations") return !user?.operator && isProfessional && hasFeature(user, "clinical_record");
      // Task 18: leitura administrativa, só do municipal_admin (não exige health_professional).
      if (item.id === "professional-consultations") return !user?.operator && isAdmin && hasFeature(user, "clinical_record");
      // fix51 (api#51): rascunhos abertos, só do municipal_admin.
      if (item.id === "open-drafts") return !user?.operator && isAdmin && hasFeature(user, "clinical_record");
      // Módulo 19b: certificado e sessão de assinatura são do profissional,
      // só com `digital_signature` ligado (o api recusaria com 403).
      if (item.id === "signature" || item.id === "signature-pending") return canSign(user);
      // F-19.14: painel só leitura do municipal_admin, com digital_signature.
      if (item.id === "signature-overview") return canSeeSignatureOverview(user);
      // Módulo 19d: estoque de números do SNCR, do profissional, com controlled_prescriptions.
      if (item.id === "sncr") return canRequestSncr(user);
      // F-19.29: painel só leitura do municipal_admin, com controlled_prescriptions.
      if (item.id === "sncr-overview") return canSeeSncrOverview(user);
      // Módulo 19c: CNPJ, REMUME e protocolos de enfermagem, só do municipal_admin, com clinical_documents.
      if (item.id === "clinical-documents-admin") return !user?.operator && isAdmin && hasFeature(user, "clinical_documents");
      if (item.id === "exam-acknowledgements") return examsOn && isProfessional;
      if (item.id === "exams-unit") return examsOn && (isProfessional || isReception);
      if (item.id === "exams-overdue" || item.id === "exam-regulation" || item.id === "exam-report") return examsOn && (isAdmin || isRegulator);
      if (item.id === "exams-admin") return examsOn && isAdmin;
      // O portal só aparece pelo ramo do prestador, acima.
      if (item.id === "exam-provider") return false;
      if (item.id === "integrations" || item.id === "cnes") return canIntegrations;
      if (item.id === "production") return canProduction;
      return true;
    })
  })).filter((group) => group.items.length > 0);
}

// Módulo 19b: contador de pendentes de assinatura no item do menu (a lista
// vem até 200 itens; dali em diante, "200+"). Só o rótulo muda; o NavDropdown
// continua o mesmo.
export function withPendingCount(groups: NavGroupDef[], count: number): NavGroupDef[] {
  if (count <= 0) return groups;
  const shown = count >= 200 ? "200+" : String(count);
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => item.id === "signature-pending" ? { ...item, label: `${item.label} (${shown})` } : item)
  }));
}

// Módulo 21a: contador de resultados aguardando ciência no item do menu.
// O número vem da rota de contagem (A46), que é exato: sem "+".
export function withExamPendingCount(groups: NavGroupDef[], count: number): NavGroupDef[] {
  if (count <= 0) return groups;
  const shown = String(count);
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => item.id === "exam-acknowledgements" ? { ...item, label: `${item.label} (${shown})` } : item)
  }));
}
