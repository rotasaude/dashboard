import { useState } from "react";
import { ScopeContext, type PeriodKey } from "./lib/scope";
import { municipalityId } from "./lib/tenant";
import { AppHeader } from "./shell/AppHeader";
import { labelFor, type ModuleId } from "./shell/modules";
import { Overview } from "./modules/Overview";
import { Placeholder } from "./modules/Placeholder";

export function App() {
  const [ period, setPeriod ] = useState<PeriodKey>("7d");
  const [ active, setActive ] = useState<ModuleId>("overview");
  const muni = municipalityId();

  return (
    <ScopeContext.Provider value={{ period, municipalityId: muni, setPeriod }}>
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        <AppHeader active={active} onSelect={setActive} />
        <main style={{ padding: "22px 24px 48px", flex: 1, width: "100%" }}>
          {active === "overview"
            ? <Overview onNavigate={setActive} />
            : <Placeholder title={labelFor(active)} />}
        </main>
      </div>
    </ScopeContext.Provider>
  );
}
