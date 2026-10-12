// O selo do sino usa --on-tone: branco fixo fica ilegível sobre amarelo no
// alto contraste e no escuro.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "NotificationCenter.tsx"), "utf8");

describe("selo do sino", () => {
  it("não fixa branco", () => {
    expect(code).not.toMatch(/color:\s*"white"/);
    expect(code).toMatch(/color:\s*"var\(--on-tone\)"/);
  });
});
