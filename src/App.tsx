import { useState } from "react";
import { ScopeContext, type PeriodKey } from "./lib/scope";
import { useAuth } from "./lib/auth";
import { AppHeader } from "./shell/AppHeader";
import { labelFor, type ModuleId } from "./shell/modules";
import { Overview } from "./modules/Overview";
import { Ingestion } from "./modules/Ingestion";
import { Placeholder } from "./modules/Placeholder";

export function App() {
  const [ period, setPeriod ] = useState<PeriodKey>("7d");
  const [ active, setActive ] = useState<ModuleId>("overview");
  const { municipalityId } = useAuth();

  return (
    <ScopeContext.Provider value={{ period, municipalityId, setPeriod }}>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <AppHeader active={active} onSelect={setActive} />
        <main style={{ padding: "22px 24px 48px", flex: 1, width: "100%" }}>
          {renderModule(active, setActive)}
        </main>
      </div>
    </ScopeContext.Provider>
  );
}

function renderModule(active: ModuleId, setActive: (id: ModuleId) => void) {
  switch (active) {
    case "overview":  return <Overview onNavigate={setActive} />;
    case "ingestion": return <Ingestion />;
    default:          return <Placeholder title={labelFor(active)} />;
  }
}
