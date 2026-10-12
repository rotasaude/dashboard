// Painel que aparece por causa de um clique (spec 6a §3.1): rola até ele e
// põe o foco no título, para quem usa teclado ou leitor saber que abriu.
import { useEffect, useRef } from "react";

export function useReveal<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView?.({ block: "nearest" });
    const target = el.querySelector<HTMLElement>("[data-reveal-title],h2,h3") ?? el;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  }, [ active ]);
  return ref;
}
