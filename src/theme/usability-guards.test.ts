// Guardas de usabilidade (spec 6a §3.7/§3.8).
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

describe("reticências só com o texto inteiro em title", () => {
  it("nenhum textOverflow ellipsis em elemento sem title", () => {
    const offenders: string[] = [];
    for (const f of sources(src)) {
      const code = readFileSync(f, "utf8");
      for (const m of code.matchAll(/textOverflow:\s*"ellipsis"|text-overflow:\s*ellipsis/g)) {
        const tagStart = code.lastIndexOf("<", m.index);
        const tag = code.slice(tagStart, code.indexOf(">", m.index));
        if (f.endsWith(".css") || !/\btitle=/.test(tag)) offenders.push(`${relative(src, f)}@${m.index}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
