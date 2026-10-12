// Texto sobre --accent usa --on-accent (no alto-contraste o accent é amarelo e
// o texto precisa ser preto). Guarda contra `color: "#fff"` fixo nesses botões.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "modules/Login.tsx", "modules/ResetPassword.tsx",
  "modules/AcceptInvitation.tsx", "components/formStyles.ts"
];

describe("texto sobre accent", () => {
  it.each(FILES)("%s não fixa branco sobre o accent", (file) => {
    const code = readFileSync(join(src, file), "utf8");
    expect(code).not.toMatch(/color:\s*"#fff"/);
  });
});
