// Janela de step-up (spec do dashboard §2.3, ADR 0011): a API aceita uma ação
// sensível sem pedir código se `mfa_verified_at` for mais recente que 5 min
// (MfaStepUp::STEP_UP_WINDOW, regra `ts > 5.minutes.ago`). Isto é só uma
// PREVISÃO a partir do /session — relógios diferentes ou uma janela que fecha
// entre a leitura e o clique viram `mfa_required`, que o SensitiveAction trata.
export const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

export interface StepUpWindow { enrolled: boolean; open: boolean; remainingMs: number; }

const CLOSED = { open: false, remainingMs: 0 } as const;

export function stepUpWindow(
  session: { mfa_enrolled: boolean; mfa_verified_at: string | null } | null,
  now: number
): StepUpWindow {
  if (!session?.mfa_enrolled) return { enrolled: false, ...CLOSED };
  const verified = session.mfa_verified_at ? Date.parse(session.mfa_verified_at) : Number.NaN;
  if (Number.isNaN(verified)) return { enrolled: true, ...CLOSED };
  const remainingMs = verified + STEP_UP_WINDOW_MS - now;
  return remainingMs > 0 ? { enrolled: true, open: true, remainingMs } : { enrolled: true, ...CLOSED };
}
