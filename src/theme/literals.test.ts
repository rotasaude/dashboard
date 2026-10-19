// Texto sobre --accent usa --on-accent (no alto-contraste o accent é amarelo e
// o texto precisa ser preto). Guarda contra `color: "#fff"` fixo nesses botões.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "modules/Login.tsx", "modules/entry/EntryFrame.tsx", "modules/ResetPassword.tsx",
  "modules/AcceptInvitation.tsx", "components/formStyles.ts"
];

describe("texto sobre accent", () => {
  it.each(FILES)("%s não fixa branco sobre o accent", (file) => {
    const code = readFileSync(join(src, file), "utf8");
    expect(code).not.toMatch(/color:\s*"#fff"/);
  });
});

// A moldura de entrada pinta a faixa com o destaque do tema ativo: nenhuma cor
// literal no CSS dela, só tokens (spec city-identity §5.5).
describe("moldura de entrada só com tokens", () => {
  it("entry.css não tem cor literal", () => {
    const css = readFileSync(join(src, "modules/entry/entry.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|:\s*(white|black)\b/);
  });
});
