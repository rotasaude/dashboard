// A cópia do estilo do mapa (src/lib/vendor/map-style/ e public/map/) é gerada
// pelo scripts/map-style-sync.mjs a partir de uma tag do contracts. Editar a
// cópia à mão, ou deixar um arquivo que o lock não conhece, reprova a suíte.
// Fonte que falta não é detalhe: uma faixa de glifo pedida e sem arquivo
// derruba o mapa inteiro (contrato do 24c, Q61).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const COPIES = [ "src/lib/vendor/map-style", "public/map" ];

function listFiles(base: string): string[] {
  if (!existsSync(base)) return [];
  // .DS_Store: o Finder cria ao abrir a pasta; não é parte da cópia.
  return readdirSync(base).filter((name) => name !== ".DS_Store").flatMap((name) => {
    const full = join(base, name);
    return statSync(full).isDirectory() ? listFiles(full) : [ relative(root, full) ];
  });
}

describe("cópia do estilo do mapa", () => {
  const lock = JSON.parse(readFileSync(join(root, "src/lib/vendor/map-style.lock"), "utf8")) as {
    ref: string; files: Record<string, string>;
  };

  it("vem da tag map-style-v1.0.0", () => {
    expect(lock.ref).toBe("map-style-v1.0.0");
  });

  it("cada arquivo bate com o hash do lock", () => {
    expect(Object.keys(lock.files).length).toBeGreaterThan(1000);
    for (const [ file, sha ] of Object.entries(lock.files)) {
      const actual = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
      expect(actual, file).toBe(sha);
    }
  });

  it("não há arquivo na cópia fora do lock", () => {
    const present = COPIES.flatMap((dir) => listFiles(join(root, dir))).sort();
    expect(present).toEqual(Object.keys(lock.files).sort());
  });

  it("só o tema claro foi copiado (Q18)", () => {
    expect(Object.keys(lock.files).filter((f) => /dark/.test(f))).toEqual([]);
  });
});
