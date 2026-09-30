// Analytics da cidade (módulo 14; ADR 0025; spec §8): séries consolidadas até
// D-1, só para analyst e municipal_admin (o menu já filtra; a API responde 403
// para o resto). O intervalo é um só para as quatro abas; os recortes são de
// cada aba e zeram ao trocar de aba.
import { useState } from "react";
import type { AnalyticsFront } from "../lib/api";
import { DEFAULT_RANGE, type AnalyticsRange } from "../lib/analytics";
import { PageHeader } from "../components/PageHeader";
import { SegmentedControl } from "../shell/SegmentedControl";
import { RangeControls } from "./analytics/Filters";
import { DemandTab } from "./analytics/DemandTab";
import { QualityTab } from "./analytics/QualityTab";
import { CalibrationTab } from "./analytics/CalibrationTab";
import { EpidemiologyTab } from "./analytics/EpidemiologyTab";

const TABS: { key: AnalyticsFront; label: string }[] = [
  { key: "demand", label: "Demanda" },
  { key: "quality", label: "Qualidade" },
  { key: "calibration", label: "Calibração" },
  { key: "epidemiology", label: "Epidemiologia" }
];

export function Analytics() {
  const [ tab, setTab ] = useState<AnalyticsFront>("demand");
  const [ range, setRange ] = useState<AnalyticsRange>(DEFAULT_RANGE);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Analytics" sub="séries consolidadas · até o dia anterior" />
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <SegmentedControl options={TABS} value={tab} onChange={setTab} />
        <RangeControls value={range} onChange={setRange} />
      </div>
      {tab === "demand" && <DemandTab range={range} />}
      {tab === "quality" && <QualityTab range={range} />}
      {tab === "calibration" && <CalibrationTab range={range} />}
      {tab === "epidemiology" && <EpidemiologyTab range={range} />}
    </div>
  );
}
