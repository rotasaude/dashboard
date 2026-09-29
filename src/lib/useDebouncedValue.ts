import { useEffect, useState } from "react";

// O valor só muda depois de `delayMs` sem mudança. Passe um valor primitivo
// (ex.: JSON.stringify) — objeto novo a cada render reiniciaria a espera.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [ debounced, setDebounced ] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [ value, delayMs ]);
  return debounced;
}
