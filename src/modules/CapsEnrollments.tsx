// Módulo 31 — F-31.2/F-31.3: lista sem dado clínico, detalhe no clique, PTS e encerramento (Task 6).
// Nesta etapa, só o portão (interruptor, papel e CAPS); o corpo chega na task indicada.
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

// `initialEnrollmentId`: a matrícula aberta no acolhimento (Task 5), mostrada ao entrar (Task 6).
export type CapsEnrollmentsProps = { today?: string; now?: Date; onGoToSecurity?: () => void; initialEnrollmentId?: string | null };

export function CapsEnrollments(_props: CapsEnrollmentsProps) {
  return (
    <PsychosocialGate title="Usuários do CAPS" sub="Matrícula, PTS, ações, receitas e encerramento" allow={(r) => r.staff}>
      {() => null}
    </PsychosocialGate>
  );
}
