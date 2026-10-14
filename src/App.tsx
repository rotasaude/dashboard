import { useCallback, useMemo, useState } from "react";
import { ScopeContext, PERIOD_OPTIONS, useScope, type PeriodKey } from "./lib/scope";
import { useAuth } from "./lib/auth";
import { NAV_GROUPS, labelFor, isExamProvider, navGroupsFor, withExamPendingCount, withPendingCount, type ModuleId, type NavGroupDef } from "./shell/modules";
import { useAlerts } from "./hooks/useAlerts";
import { usePendingSignatures } from "./hooks/usePendingSignatures";
import { canSign } from "./lib/signature";
import { useExamPending } from "./hooks/useExamPending";
import { canUseExams, examRoles } from "./lib/exams";
import { ExamsAdmin } from "./modules/ExamsAdmin";
import { ProviderPortal } from "./modules/ProviderPortal";
import { AcknowledgementNotice } from "./modules/exams/AcknowledgementNotice";
import { Shell } from "./shell/Shell";
import { ContextStrip } from "./shell/ContextStrip";
import { TenantChip } from "./shell/TenantChip";
import { LiveClock } from "./shell/LiveClock";
import { ContaMenu } from "./shell/ContaMenu";
import { HomeCards, GroupCards } from "./shell/Cards";
import { A11yPage } from "./shell/A11yPage";
import { SegmentedControl } from "./shell/SegmentedControl";
import { NotificationCenter } from "./shell/NotificationCenter";
import { SignatureSessionBadge } from "./shell/SignatureSessionBadge";
import { CATALOG } from "./shell/catalog";
import { slugOf, useHashRoute, type Route } from "./shell/router";
import type { ShellGroup } from "./shell/types";
import { Overview } from "./modules/Overview";
import { Ingestion } from "./modules/Ingestion";
import { Conversations } from "./modules/Conversations";
import { Consent } from "./modules/Consent";
import { Triages } from "./modules/Triages";
import { Classification } from "./modules/Classification";
import { Reports } from "./modules/Reports";
import { Protocols } from "./modules/Protocols";
import { Queues } from "./modules/Queues";
import { Events } from "./modules/Events";
import { Health } from "./modules/Health";
import { ExamAcknowledgements } from "./modules/ExamAcknowledgements";
import { ExamsUnit } from "./modules/ExamsUnit";
import { ExamsOverdue } from "./modules/ExamsOverdue";
import { ExamRegulation } from "./modules/ExamRegulation";
import { ExamReport } from "./modules/ExamReport";
import { Placeholder } from "./modules/Placeholder";
import { ProtocolEditor } from "./modules/ProtocolEditor";
import { Security } from "./modules/Security";
import { Team } from "./modules/Team";
import { Attendance } from "./modules/Attendance";
import { Professionals } from "./modules/Professionals";
import { Territory } from "./modules/Territory";
import { Campaigns } from "./modules/Campaigns";
import { Analytics } from "./modules/Analytics";
import { MyProfile } from "./modules/MyProfile";
import { MyAgenda } from "./modules/MyAgenda";
import { Integrations } from "./modules/Integrations";
import { Cnes } from "./modules/Cnes";
import { Production } from "./modules/Production";
import { ClinicalRecord } from "./modules/ClinicalRecord";
import { MyConsultations } from "./modules/MyConsultations";
import { ProfessionalConsultations } from "./modules/ProfessionalConsultations";
import { OpenDrafts } from "./modules/OpenDrafts";
import { SignatureAccount } from "./modules/SignatureAccount";
import { SignaturePending } from "./modules/SignaturePending";
import { SignatureOverview } from "./modules/SignatureOverview";
import { SncrAccount } from "./modules/SncrAccount";
import { SncrOverview } from "./modules/SncrOverview";
import { ClinicalDocumentsAdmin } from "./modules/ClinicalDocumentsAdmin";

const ALL_IDS: ReadonlySet<string> = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));
const ALL_SLUGS: ReadonlySet<string> = new Set(NAV_GROUPS.map((g) => slugOf(g.label)));

// Grupos do shell a partir do filtro por papel de hoje. O rótulo de
// Pendentes leva a contagem de withPendingCount ("(3)", "(200+)"), como no
// menu antigo; `count` só acende o ponto do trilho.
export function shellGroups(groups: NavGroupDef[], pending: number, examPending = 0, examHasMore = false): ShellGroup[] {
  return withExamPendingCount(withPendingCount(groups, pending), examPending, examHasMore).map((g) => ({
    label: g.label,
    slug: slugOf(g.label),
    items: g.items.map((i) => {
      if (i.id === "signature-pending" && pending > 0) return { id: i.id, label: i.label, count: pending };
      // Módulo 21a: `examPending` acende o item "Resultados aguardando ciência".
      if (i.id === "exam-acknowledgements" && examPending > 0) return { id: i.id, label: i.label, count: examPending };
      return { id: i.id, label: i.label };
    })
  }));
}

// `initialModule`: a tela de onde a pessoa saiu para o prestador de
// assinatura (módulo 19b) ou para o SNCR, devolvida pelo retorno do OAuth.
export function App({ initialModule }: { initialModule?: ModuleId } = {}) {
  const [ period, setPeriod ] = useState<PeriodKey>("7d");
  const { citySlug } = useAuth();
  return (
    <ScopeContext.Provider value={{ period, citySlug, setPeriod }}>
      <ShellInner initialModule={initialModule} />
    </ScopeContext.Provider>
  );
}

// Dentro do Provider: useAlerts (via useHealth → useScope) consome o contexto.
function ShellInner({ initialModule }: { initialModule?: ModuleId }) {
  const auth = useAuth();
  // O prestador de exames só tem o portal: sem alertas de infra nem sino.
  const providerOnly = isExamProvider(auth.user);
  const alerts = useAlerts(!providerOnly);
  const scope = useScope();
  const pending = usePendingSignatures(canSign(auth.user));
  const examPending = useExamPending(canUseExams(auth.user) && examRoles(auth.user).professional, auth.user?.id ?? null);
  // (enabled só liga com sessão; o id nunca é null com a consulta ligada)
  const examCount = examPending.data?.pending ?? 0;
  const deniedCount = examPending.data?.denied ?? 0;
  const examHasMore = !!examPending.data?.has_more;
  const groups = useMemo(
    () => shellGroups(navGroupsFor(auth.user), pending.data?.length ?? 0, examCount, examHasMore),
    [ auth.user, pending.data?.length, examCount, examHasMore ]
  );

  const isAllowed = useCallback((r: Route<ModuleId>) => {
    if (r.kind === "home" || r.kind === "a11y") return true;
    if (r.kind === "group") return groups.some((g) => g.slug === r.slug);
    return groups.some((g) => g.items.some((i) => i.id === r.id));
  }, [ groups ]);

  // O retorno do OAuth também passa pelo filtro por papel (o prestador não
  // é levado a outra tela); fora dele, o roteador cai no Início.
  const initial: Route<ModuleId> | undefined = initialModule && isAllowed({ kind: "screen", id: initialModule })
    ? { kind: "screen", id: initialModule } : undefined;
  const { route, go } = useHashRoute<ModuleId>({ ids: ALL_IDS, slugs: ALL_SLUGS, isAllowed, initial });
  const navigate = useCallback((id: ModuleId) => go({ kind: "screen", id }), [ go ]);
  // As peças do shell só produzem ids vindos dos próprios grupos (ModuleId).
  const goShell = go as (r: Route) => void;
  // Fora de uma tela, a sessão de assinatura volta para a Visão geral (o
  // return_to só aceita ids de tela).
  const active: ModuleId = route.kind === "screen" ? route.id : "overview";

  let content;
  if (route.kind === "home") content = (
    <>
      <AcknowledgementNotice pending={examCount} denied={deniedCount} hasMore={examHasMore} onOpen={() => navigate("exam-acknowledgements")} />
      <HomeCards groups={groups} catalog={CATALOG} go={goShell} />
    </>
  );
  else if (route.kind === "a11y") content = <A11yPage contact="Fale com o administrador da sua prefeitura." />;
  else if (route.kind === "group") {
    const group = groups.find((g) => g.slug === route.slug);
    content = group ? <GroupCards group={group} catalog={CATALOG} go={goShell} /> : null;
  } else content = renderModule(route.id, navigate);

  return (
    <Shell
      product="Dashboard"
      groups={groups}
      catalog={CATALOG}
      route={route}
      go={goShell}
      titleFor={(id) => labelFor(id as ModuleId)}
      context={
        <ContextStrip
          left={<>
            <TenantChip user={auth.user} />
            <SegmentedControl options={PERIOD_OPTIONS} value={scope.period} onChange={scope.setPeriod} />
          </>}
          right={<>
            <SignatureSessionBadge active={active} onSelect={navigate} />
            <LiveClock />
          </>}
        />
      }
      notifications={providerOnly ? null : <NotificationCenter active={alerts.active} limitations={alerts.limitations} onNavigate={navigate} />}
      account={auth.user ? <ContaMenu email={auth.user.email_address} onLogout={() => { void auth.logout(); }} /> : null}
    >
      {content}
    </Shell>
  );
}

export function renderModule(active: ModuleId, setActive: (id: ModuleId) => void) {
  switch (active) {
    case "overview":       return <Overview onNavigate={setActive} />;
    case "ingestion":      return <Ingestion />;
    case "conversations":  return <Conversations />;
    case "consent":        return <Consent />;
    case "triages":        return <Triages />;
    case "classification": return <Classification />;
    case "reports":         return <Reports />;
    case "protocols":      return <Protocols onNavigate={setActive} />;
    case "protocol-editor": return <ProtocolEditor />;
    case "queues":         return <Queues />;
    case "events":         return <Events />;
    case "health":         return <Health />;
    case "security":       return <Security />;
    case "team":           return <Team onNavigate={setActive} />;
    case "attendance":     return <Attendance onNavigate={setActive} />;
    case "professionals":  return <Professionals />;
    case "my-profile":     return <MyProfile />;
    case "my-agenda":      return <MyAgenda />;
    case "territory":      return <Territory />;
    case "campaigns":      return <Campaigns onNavigate={setActive} />;
    case "analytics":      return <Analytics />;
    case "integrations":   return <Integrations onGoToSecurity={() => setActive("security")} />;
    case "cnes":           return <Cnes onGoToSecurity={() => setActive("security")} />;
    case "production":     return <Production onGoToSecurity={() => setActive("security")} />;
    case "my-consultations": return <MyConsultations onGoToSecurity={() => setActive("security")} />;
    case "professional-consultations": return <ProfessionalConsultations onGoToSecurity={() => setActive("security")} />;
    case "open-drafts": return <OpenDrafts onGoToSecurity={() => setActive("security")} />;
    case "clinical-record": return <ClinicalRecord onGoToSecurity={() => setActive("security")} />;
    case "signature":      return <SignatureAccount onGoToSecurity={() => setActive("security")} />;
    case "signature-pending": return <SignaturePending onNavigate={setActive} />;
    case "signature-overview": return <SignatureOverview />;
    case "sncr":           return <SncrAccount />;
    case "sncr-overview":  return <SncrOverview />;
    case "clinical-documents-admin": return <ClinicalDocumentsAdmin onGoToSecurity={() => setActive("security")} />;
    case "exam-acknowledgements": return <ExamAcknowledgements />;
    case "exams-unit":     return <ExamsUnit />;
    case "exams-overdue":  return <ExamsOverdue />;
    case "exam-regulation": return <ExamRegulation />;
    case "exam-report": return <ExamReport />;
    case "exam-provider": return <ProviderPortal />;
    case "exams-admin": return <ExamsAdmin onGoToSecurity={() => setActive("security")} />;
    default:               return <Placeholder title={labelFor(active)} />;
  }
}
