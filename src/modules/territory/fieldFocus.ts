// src/modules/territory/fieldFocus.ts
// Uma recusa por vez (errata 5.3): o campo do `path` — da regra na tela ou do
// 422 do api — fica marcado (aria-invalid) e recebe o foco. Path de seção ou
// de objeto ("living_conditions.instituicao_permanencia") vai para o primeiro
// campo registrado dentro dele; path sem campo na tela só mostra a frase.
import { useEffect, useRef, useState } from "react";

export function useFieldFocus() {
  const refs = useRef(new Map<string, HTMLElement>());
  const [ marked, setMarked ] = useState<{ path: string | null; at: number }>({ path: null, at: 0 });

  const target = (path: string | null): string | null => {
    if (!path) return null;
    if (refs.current.has(path)) return path;
    return [ ...refs.current.keys() ].find((key) => key.startsWith(`${path}.`)) ?? null;
  };

  useEffect(() => {
    const key = target(marked.path);
    if (key) refs.current.get(key)?.focus();
    // `at` refaz o foco quando a mesma recusa volta.
  }, [ marked ]);

  return {
    reg: (path: string) => (el: HTMLElement | null) => { if (el) refs.current.set(path, el); else refs.current.delete(path); },
    invalid: (path: string): true | undefined => (marked.path !== null && target(marked.path) === path ? true : undefined),
    mark: (path: string | null) => setMarked((m) => ({ path, at: m.at + 1 }))
  };
}

// Foco fora dos campos (m3 da revisão da prova): quando o botão que tinha o
// foco some (edição → confirmação, recusa sem campo, versão velha), o foco vai
// para um alvo nomeado — o título da confirmação ou a frase da recusa
// (tabIndex -1) —, nunca para o body. `at` refaz o foco quando o alvo repete.
export function useFocusTarget() {
  const refs = useRef(new Map<string, HTMLElement>());
  const [ wanted, setWanted ] = useState<{ name: string | null; at: number }>({ name: null, at: 0 });

  useEffect(() => {
    if (wanted.name) refs.current.get(wanted.name)?.focus();
  }, [ wanted ]);

  return {
    ref: (name: string) => (el: HTMLElement | null) => { if (el) refs.current.set(name, el); else refs.current.delete(name); },
    focus: (name: string) => setWanted((w) => ({ name, at: w.at + 1 }))
  };
}
