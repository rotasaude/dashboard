// src/modules/LabQcSetup.tsx
// Cadastro do CIQ (spec §5.1; contrato §3): materiais, lotes com código de
// barras por nível, referências e regras. Do admin ou do RT/substituto
// (contexto, Divergência C1); o liberador que não é RT vê a frase e nada é
// lido. Sem polling.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listLabExams } from "../lib/api";
import { QC_DISABLED, QC_EXAMS_KEY, QC_LEAD_ONLY } from "../lib/qc";
import { EmptyState } from "../components/EmptyState";
import { LabGate } from "./lab/LabGate";
import { LabPick } from "./lab/LabPick";
import { MaterialsPanel } from "./qc/MaterialsPanel";
import { LotsPanel } from "./qc/LotsPanel";
import { TargetsPanel } from "./qc/TargetsPanel";
import { RulesPanel } from "./qc/RulesPanel";
import { stack } from "./exams/styles";

export function LabQcSetup({ onGoToSecurity }: { onGoToSecurity?(): void }) {
  return (
    <LabGate title="Controles e referências" sub="CIQ · materiais, lotes, referências e regras de Westgard"
      allow={(r) => r.admin || r.releaser} requires={[ "lab_quality_control" ]} disabledText={QC_DISABLED}>
      {(roles) => (
        <LabPick>
          {(lab) => (roles.admin || lab.lead
            ? <SetupBody providerId={lab.id} lead={lab.lead} admin={roles.admin} onGoToSecurity={onGoToSecurity} />
            : <EmptyState title={QC_LEAD_ONLY} />)}
        </LabPick>
      )}
    </LabGate>
  );
}

function SetupBody({ providerId, lead, admin, onGoToSecurity }: { providerId: string; lead: boolean; admin: boolean; onGoToSecurity?(): void }) {
  const exams = useQuery({ queryKey: [ QC_EXAMS_KEY, providerId ], queryFn: () => listLabExams(providerId), retry: false });
  const [ lotId, setLotId ] = useState<string | null>(null);
  return (
    <div style={stack}>
      <MaterialsPanel providerId={providerId} exams={exams.data ?? []} onGoToSecurity={onGoToSecurity} />
      <LotsPanel providerId={providerId} pickedId={lotId} onPick={setLotId} onGoToSecurity={onGoToSecurity} />
      {lotId && <TargetsPanel key={lotId} providerId={providerId} lotId={lotId} lead={lead} admin={admin} exams={exams.data ?? []} onGoToSecurity={onGoToSecurity} />}
      <RulesPanel providerId={providerId} lead={lead} exams={exams.data ?? []} onGoToSecurity={onGoToSecurity} />
    </div>
  );
}
