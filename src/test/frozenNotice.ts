import { expect } from "vitest";
import { FROZEN_TEXT_NOTICE } from "../components/FrozenTextNotice";

// api#32: o campo de texto congelado aponta (aria-describedby) para o aviso,
// que já está na tela antes de qualquer envio.
export function expectFrozenNotice(field: HTMLElement) {
  const id = field.getAttribute("aria-describedby");
  expect(id, "campo sem aria-describedby para o aviso").toBeTruthy();
  expect(document.getElementById(id!)?.textContent).toBe(FROZEN_TEXT_NOTICE);
}
