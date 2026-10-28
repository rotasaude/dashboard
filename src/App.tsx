import { useCallback, useMemo, useState } from "react";
import { ScopeContext, PERIOD_OPTIONS, useScope, type PeriodKey } from "./lib/scope";
import { useAuth } from "./lib/auth";
import { NAV_GROUPS, labelFor, isExamProvider, navGroupsFor, withExamPendingCount, withLabCriticalCount, withPendingCount, withQcBlockCount, withRegulationCount, withSurveillanceCount, type ModuleId, type NavGroupDef } from "./shell/modules";
import { useAlerts } from "./hooks/useAlerts";
import { usePendingSignatures } from "./hooks/usePendingSignatures";
import { canSign } from "./lib/signature";
import { useExamPending } from "./hooks/useExamPending";
import { canUseExams, examRoles } from "./lib/exams";
import { useLabCriticalCount } from "./hooks/useLabCriticalCount";
import { useQcBlockCount } from "./hooks/useQcBlockCount";
import { useSurveillanceCount } from "./hooks/useSurveillanceCount";
import { canUseSurveillance, surveillanceRoles } from "./lib/surveillance";
import { useRegulationCount } from "./hooks/useRegulationCount";
import { canUseRegulation, regulationRoles } from "./lib/regulation";
import { canUseQc } from "./lib/qc";
import { canUseLab, labRoles } from "./lib/lab";
import { LabCriticalNotice } from "./modules/lab/LabCriticalNotice";
import { ExamsAdmin } from "./modules/ExamsAdmin";
import { LabRequisitions } from "./modules/LabRequisitions";
import { LabCollection } from "./modules/LabCollection";
import { LabShipments } from "./modules/LabShipments";
import { LabReception } from "./modules/LabReception";
import { LabEntry } from "./modules/LabEntry";
import { LabWorklist } from "./modules/LabWorklist";
import { LabRelease } from "./modules/LabRelease";
import { LabAdmin } from "./modules/LabAdmin";
import { LabReports } from "./modules/LabReports";
import { LabInstruments } from "./modules/LabInstruments";
import { LabInventory } from "./modules/LabInventory";
import { LabTraceability } from "./modules/LabTraceability";
import { LabQcSetup } from "./modules/LabQcSetup";
import { LabEqa } from "./modules/LabEqa";
import { LabQcRuns } from "./modules/LabQcRuns";
import { LabQcChart } from "./modules/LabQcChart";
import { LabQcBlocks } from "./modules/LabQcBlocks";
import { BillingProcedures } from "./modules/BillingProcedures";
import { BillingPeriods } from "./modules/BillingPeriods";
import { BillingSettings } from "./modules/BillingSettings";
import { CareLinesAdmin } from "./modules/CareLinesAdmin";
import { CareLinesTeam } from "./modules/CareLinesTeam";
import { CareLinesPreview } from "./modules/CareLinesPreview";
import { TerritoryTeam } from "./modules/TerritoryTeam";
import { RegistryStatus } from "./modules/RegistryStatus";
import { TerritoryMicroAreas } from "./modules/TerritoryMicroAreas";
import { SurveillanceQueue } from "./modules/SurveillanceQueue";
import { SurveillanceNegatives } from "./modules/SurveillanceNegatives";
import { SurveillanceReports } from "./modules/SurveillanceReports";
import { SurveillancePanel } from "./modules/SurveillancePanel";
import { SurveillanceDiseases } from "./modules/SurveillanceDiseases";
import { RegulationQueue } from "./modules/RegulationQueue";
import { RegulationReturned } from "./modules/RegulationReturned";
import { RegulationOffers } from "./modules/RegulationOffers";
import { RegulationSettings } from "./modules/RegulationSettings";
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
export function shellGroups(groups: NavGroupDef[], pending: number, examPending = 0, labCritical = 0, qcBlocks = 0, surveillanceImmediate = 0, regulationOverdue = 0): ShellGroup[] {
  return withRegulationCount(withSurveillanceCount(withQcBlockCount(withLabCriticalCount(withExamPendingCount(withPendingCount(groups, pending), examPending), labCritical), qcBlocks), surveillanceImmediate), regulationOverdue).map((g) => ({
    label: g.label,
    slug: slugOf(g.label),
    items: g.items.map((i) => {
      if (i.id === "signature-pending" && pending > 0) return { id: i.id, label: i.label, count: pending };
      // Módulo 21a: `examPending` acende o item "Resultados aguardando ciência".
      if (i.id === "exam-acknowledgements" && examPending > 0) return { id: i.id, label: i.label, count: examPending };
      // Módulo 21b: críticos sem aviso acendem a liberação.
      if (i.id === "lab-release" && labCritical > 0) return { id: i.id, label: i.label, count: labCritical };
      // Módulo 21c: bloqueios ativos acendem a tela de bloqueios.
      if (i.id === "lab-qc-blocks" && qcBlocks > 0) return { id: i.id, label: i.label, count: qcBlocks };
      // Módulo 25: imediatas abertas acendem a fila da vigilância.
      if (i.id === "surveillance-queue" && surveillanceImmediate > 0) return { id: i.id, label: i.label, count: surveillanceImmediate };
      // Módulo 26a: vencidos acendem a fila regulada.
      if (i.id === "regulation-queue" && regulationOverdue > 0) return { id: i.id, label: i.label, count: regulationOverdue };
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
  // A46: `pending` é a contagem exata (has_more só diz que a lista tem mais de uma página).
  const deniedCount = examPending.data?.denied ?? 0;
  const labCriticalQuery = useLabCriticalCount(canUseLab(auth.user) && labRoles(auth.user).releaser, auth.user?.id ?? null);
  const labCritical = labCriticalQuery.data ?? 0;
  const qcRoles = labRoles(auth.user);
  const qcBlockQuery = useQcBlockCount(canUseQc(auth.user) && (qcRoles.staff || qcRoles.releaser), auth.user?.id ?? null);
  const qcBlocks = qcBlockQuery.data ?? 0;
  // Módulo 25: só quem tem o papel surveillance lê a contagem (o analyst só vê o painel).
  const survQuery = useSurveillanceCount(canUseSurveillance(auth.user) && surveillanceRoles(auth.user).surveillance, auth.user?.id ?? null);
  const survImmediate = survQuery.data?.immediate_open ?? 0;
  // Módulo 26a: só o regulador lê a contagem (os vencidos acendem a fila regulada).
  const regQuery = useRegulationCount(canUseRegulation(auth.user) && regulationRoles(auth.user).regulator, auth.user?.id ?? null);
  const regOverdue = regQuery.data?.overdue ?? 0;
  const groups = useMemo(
    () => shellGroups(navGroupsFor(auth.user), pending.data?.length ?? 0, examCount, labCritical, qcBlocks, survImmediate, regOverdue),
    [ auth.user, pending.data?.length, examCount, labCritical, qcBlocks, survImmediate, regOverdue ]
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
      <AcknowledgementNotice pending={examCount} denied={deniedCount} onOpen={() => navigate("exam-acknowledgements")} />
      <LabCriticalNotice count={labCritical} onOpen={() => navigate("lab-release")} />
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
    case "lab-requisitions": return <LabRequisitions />;
    case "lab-collection": return <LabCollection />;
    case "lab-shipments": return <LabShipments />;
    case "lab-reception": return <LabReception />;
    case "lab-worklist": return <LabWorklist />;
    case "lab-entry": return <LabEntry />;
    case "lab-release": return <LabRelease onNavigate={setActive} onGoToSecurity={() => setActive("security")} />;
    case "lab-admin": return <LabAdmin onGoToSecurity={() => setActive("security")} />;
    case "lab-reports": return <LabReports />;
    case "lab-qc-runs": return <LabQcRuns />;
    case "lab-qc-chart": return <LabQcChart />;
    case "lab-qc-blocks": return <LabQcBlocks onNavigate={setActive} onGoToSecurity={() => setActive("security")} />;
    case "lab-qc-setup": return <LabQcSetup onGoToSecurity={() => setActive("security")} />;
    case "lab-eqa": return <LabEqa onGoToSecurity={() => setActive("security")} />;
    case "lab-inventory": return <LabInventory onGoToSecurity={() => setActive("security")} />;
    case "lab-traceability": return <LabTraceability />;
    case "lab-instruments": return <LabInstruments onGoToSecurity={() => setActive("security")} />;
    case "billing-procedures": return <BillingProcedures />;
    case "billing-periods": return <BillingPeriods onGoToSecurity={() => setActive("security")} />;
    case "billing-settings": return <BillingSettings onGoToSecurity={() => setActive("security")} />;
    case "care-lines-team": return <CareLinesTeam />;
    case "care-lines-preview": return <CareLinesPreview />;
    case "care-lines-admin": return <CareLinesAdmin onGoToSecurity={() => setActive("security")} />;
    case "territory-team": return <TerritoryTeam />;
    case "registry-status": return <RegistryStatus />;
    case "territory-micro-areas": return <TerritoryMicroAreas onGoToSecurity={() => setActive("security")} />;
    case "surveillance-queue": return <SurveillanceQueue />;
    case "surveillance-negatives": return <SurveillanceNegatives />;
    case "surveillance-reports": return <SurveillanceReports />;
    case "surveillance-panel": return <SurveillancePanel />;
    case "surveillance-diseases": return <SurveillanceDiseases onGoToSecurity={() => setActive("security")} />;
    case "regulation-queue": return <RegulationQueue />;
    case "regulation-returned": return <RegulationReturned />;
    case "regulation-offers": return <RegulationOffers />;
    case "regulation-settings": return <RegulationSettings onGoToSecurity={() => setActive("security")} />;
    default:               return <Placeholder title={labelFor(active)} />;
  }
}
