// A cópia dos tokens (src/theme/vendor/) é gerada pelo scripts/tokens-sync.mjs
// a partir de uma tag do contracts. Editar a cópia à mão, ou deixar um arquivo
// que o lock não conhece, reprova a suíte.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "vendor");

function listFiles(base: string): string[] {
  return readdirSync(base).flatMap((name) => {
    const full = join(base, name);
    return statSync(full).isDirectory() ? listFiles(full) : [relative(dir, full)];
  });
}

describe("cópia dos tokens", () => {
  const lock = JSON.parse(readFileSync(join(dir, "tokens.lock"), "utf8")) as {
    ref: string; files: Record<string, string>;
  };

  it("vem de uma tag tokens-vX.Y.Z", () => {
    expect(lock.ref).toMatch(/^tokens-v\d+\.\d+\.\d+$/);
  });

  it("cada arquivo bate com o hash do lock", () => {
    for (const [file, sha] of Object.entries(lock.files)) {
      const actual = createHash("sha256").update(readFileSync(join(dir, file))).digest("hex");
      expect(actual, file).toBe(sha);
    }
  });

  it("não há arquivo na cópia fora do lock", () => {
    const present = listFiles(dir).filter((f) => f !== "tokens.lock").sort();
    expect(present).toEqual(Object.keys(lock.files).sort());
  });
});
