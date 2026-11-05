// Módulo 31 — F-31.6: pendências, fechamento, remessa e fichas (Task 11). O faturista vê todos os CAPS ativos e só baixa remessa e fichas de mês fechado (P43).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsRaasProps = { today?: string; onGoToSecurity?: () => void };

export function CapsRaas(_props: CapsRaasProps) {
  return (
    <PsychosocialGate title="RAAS do mês" sub="Pendências, fechamento, remessa e fichas espelho" unit="any" allow={(r) => r.staff || r.billing}>
      {() => null}
    </PsychosocialGate>
  );
}
