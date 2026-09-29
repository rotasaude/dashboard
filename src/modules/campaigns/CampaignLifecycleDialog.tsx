// src/modules/campaigns/CampaignLifecycleDialog.tsx
import { useRef } from "react";
import { cancelCampaign, unscheduleCampaign, type Campaign } from "../../lib/api";
import { campaignErrorOrNull } from "../../lib/campaigns";
import { SensitiveAction } from "../../components/SensitiveAction";

// Desagendar (scheduled → draft) e cancelar (draft/scheduled → cancelled),
// ambos com step-up (spec §5.1, D5).
export type LifecycleAction = "unschedule" | "cancel";

const COPY: Record<LifecycleAction, { title: string; description: string; confirm: string }> = {
  unschedule: {
    title: "Desagendar campanha",
    description: "A campanha volta a rascunho e não sai no horário marcado. Depois dá para editar e enviar de novo.",
    confirm: "Desagendar"
  },
  cancel: {
    title: "Cancelar campanha",
    description: "A campanha é cancelada: não sai, e não pode mais ser editada nem enviada.",
    confirm: "Cancelar campanha"
  }
};

export function CampaignLifecycleDialog({ campaign, action, onDone, onCancel, onGoToSecurity }: {
  campaign: Pick<Campaign, "id" | "title">;
  action: LifecycleAction;
  onDone(campaign: Campaign): void;
  onCancel(): void;
  onGoToSecurity(): void;
}) {
  const result = useRef<Campaign | null>(null);
  const copy = COPY[action];
  return (
    <SensitiveAction
      title={copy.title}
      description={`“${campaign.title}”: ${copy.description}`}
      requiresStepUp
      confirmLabel={copy.confirm}
      run={async () => {
        result.current = action === "unschedule" ? await unscheduleCampaign(campaign.id) : await cancelCampaign(campaign.id);
      }}
      onDone={() => onDone(result.current as Campaign)}
      onCancel={onCancel}
      onGoToSecurity={onGoToSecurity}
      translateError={campaignErrorOrNull}
    />
  );
}
