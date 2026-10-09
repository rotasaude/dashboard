import { useState } from "react";
import { ScopeContext, type PeriodKey } from "./lib/scope";
import { useAuth } from "./lib/auth";
import { AppHeader } from "./shell/AppHeader";
import { labelFor, type ModuleId } from "./shell/modules";
import { useAlerts } from "./hooks/useAlerts";
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
import { SignatureAccount } from "./modules/SignatureAccount";
import { SignaturePending } from "./modules/SignaturePending";
import { SignatureOverview } from "./modules/SignatureOverview";

// `initialModule`: a tela de onde a pessoa saiu para o prestador de
// assinatura (módulo 19b), devolvida pelo retorno do OAuth.
export function App({ initialModule }: { initialModule?: ModuleId } = {}) {
  const [ period, setPeriod ] = useState<PeriodKey>("7d");
  const [ active, setActive ] = useState<ModuleId>(initialModule ?? "overview");
  const { citySlug } = useAuth();

  return (
    <ScopeContext.Provider value={{ period, citySlug, setPeriod }}>
      <ShellInner active={active} setActive={setActive} />
    </ScopeContext.Provider>
  );
}

// ShellInner é renderizado DENTRO do ScopeContext.Provider para que useAlerts
// (via useHealth → useScope) possa consumir o contexto.
function ShellInner({
  active,
  setActive
}: {
  active: ModuleId;
  setActive: (id: ModuleId) => void;
}) {
  const alerts = useAlerts();
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader active={active} onSelect={setActive} alerts={alerts} />
      <main style={{ padding: "22px 24px 48px", flex: 1, width: "100%" }}>
        {renderModule(active, setActive)}
      </main>
    </div>
  );
}

function renderModule(active: ModuleId, setActive: (id: ModuleId) => void) {
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
    case "my-consultations": return <MyConsultations />;
    case "professional-consultations": return <ProfessionalConsultations onGoToSecurity={() => setActive("security")} />;
    case "clinical-record": return <ClinicalRecord onGoToSecurity={() => setActive("security")} />;
    case "signature":      return <SignatureAccount onGoToSecurity={() => setActive("security")} />;
    case "signature-pending": return <SignaturePending onNavigate={setActive} />;
    case "signature-overview": return <SignatureOverview />;
    default:               return <Placeholder title={labelFor(active)} />;
  }
}
