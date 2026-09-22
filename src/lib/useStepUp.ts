import { useCallback, useEffect, useState } from "react";
import { useAuth } from "./auth";
import { stepUpMfa } from "./api";
import { stepUpWindow, type StepUpWindow } from "./stepUp";

// Janela de step-up viva: recalcula a cada 15 s (o "mais N min" anda
// sozinho) e, depois de um step-up aceito, recarrega a sessão — é o
// /session que traz o `mfa_verified_at` novo.
export function useStepUp(): { window: StepUpWindow; stepUp(code: string): Promise<void> } {
  const auth = useAuth();
  const [ now, setNow ] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const stepUp = useCallback(async (code: string) => {
    await stepUpMfa(code);
    await auth.reload();
    setNow(Date.now());
  }, [ auth ]);

  return { window: stepUpWindow(auth.user, now), stepUp };
}
