// src/modules/careLines/useCareSubmit.ts
// "Running ref + busy + try/catch + isStaleCare" dos formulários do 23 num só
// lugar (errata C-03). `submit(action, onStale)` roda a ação uma vez por vez
// (segundo clique durante o envio é ignorado), devolve true se deu certo e,
// se falhou, ou manda a frase a `onStale` (registro já decidido/encerrado por
// outra pessoa: o chamador fecha e relê) ou a deixa em `error` (fica no
// formulário). A frase vem sempre de `careLineError`, nunca o código cru.
import { useCallback, useRef, useState } from "react";
import { careLineError, isStaleCare } from "../../lib/careLines";

export interface CareSubmit {
  busy: boolean;
  error: string | null;
  setError(message: string | null): void;
  submit(action: () => Promise<unknown>, onStale: (message: string) => void): Promise<boolean>;
}

export function useCareSubmit(): CareSubmit {
  const [ busy, setBusy ] = useState(false);
  const [ error, setError ] = useState<string | null>(null);
  const running = useRef(false);

  const submit = useCallback(async (action: () => Promise<unknown>, onStale: (message: string) => void): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      if (isStaleCare(err)) onStale(careLineError(err));
      else setError(careLineError(err));
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  return { busy, error, setError, submit };
}
