import { expect } from "vitest";
import { FROZEN_TEXT_NOTICE } from "../components/FrozenTextNotice";

// api#32: o campo de texto congelado aponta (aria-describedby) para o aviso,
// que já está na tela antes de qualquer envio.
export function expectFrozenNotice(field: HTMLElement) {
  const ids = field.getAttribute("aria-describedby");
  expect(ids, "campo sem aria-describedby para o aviso").toBeTruthy();
  // aria-describedby pode listar mais de um id (ex.: a dica do motivo, 6c).
  expect(ids!.split(/\s+/).map((id) => document.getElementById(id)?.textContent)).toContain(FROZEN_TEXT_NOTICE);
}
