// Todo grupo e toda tela do menu têm ícone e descrição no catálogo.
import { describe, expect, it } from "vitest";
import { NAV_GROUPS } from "./modules";
import { CATALOG } from "./catalog";

describe("catálogo do shell", () => {
  it.each(NAV_GROUPS.map((g) => g.label))("grupo %s tem ícone e descrição", (label) => {
    expect(CATALOG.groups[label]?.description).toBeTruthy();
    expect(CATALOG.groups[label]?.icon).toBeTruthy();
  });

  it.each(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)))("tela %s tem ícone e descrição", (id) => {
    expect(CATALOG.screens[id]?.description).toBeTruthy();
    expect(CATALOG.screens[id]?.icon).toBeTruthy();
  });
});
