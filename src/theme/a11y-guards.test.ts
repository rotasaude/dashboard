// Guardas de acessibilidade do tema (spec 4.3): o foco global de
// :focus-visible não pode ser cancelado por estilo inline, e texto legível
// não usa --ink4 (só decorativo/desabilitado; fica abaixo de 4,5:1).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(base: string): string[] {
  return readdirSync(base).flatMap((name) => {
    const full = join(base, name);
    if (statSync(full).isDirectory()) return name === "vendor" ? [] : sources(full);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe("foco visível", () => {
  it("nenhum estilo inline zera o outline", () => {
    const offenders = sources(src).filter((f) => /outline:\s*"none"/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => relative(src, f))).toEqual([]);
  });
});

describe("texto legível fora do --ink4", () => {
  it.each(["shell/TopBar.tsx", "shell/ContextStrip.tsx", "shell/LiveClock.tsx", "modules/Overview.tsx", "shell/ContaMenu.tsx", "shell/TenantChip.tsx"])("%s", (file) => {
    expect(readFileSync(join(src, file), "utf8")).not.toMatch(/color: "var\(--ink4\)"/);
  });
});
