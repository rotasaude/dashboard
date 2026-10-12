#!/usr/bin/env node
// Copia design-tokens/dist do contracts, numa ref (tag), para src/theme/vendor/
// e grava src/theme/vendor/tokens.lock (ref + SHA-256 por arquivo).
// Uso: node scripts/tokens-sync.mjs tokens-v1.0.0 --contracts ../../contracts
// GIT=/opt/homebrew/bin/git quando o git do PATH não funcionar.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const ref = args[0];
const at = args.indexOf("--contracts");
if (!ref || at < 0 || !args[at + 1]) {
  console.error("uso: node scripts/tokens-sync.mjs <ref> --contracts <caminho do clone do contracts>");
  process.exit(1);
}
const contracts = resolve(args[at + 1]);
const git = process.env.GIT || "git";
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(appRoot, "src/theme/vendor");

const tmp = mkdtempSync(join(tmpdir(), "tokens-"));
const tar = execFileSync(git, ["-C", contracts, "archive", "--format=tar", ref, "design-tokens/dist"]);
execFileSync("tar", ["-x", "-C", tmp], { input: tar });

rmSync(vendor, { recursive: true, force: true });
cpSync(join(tmp, "design-tokens/dist"), vendor, { recursive: true });
rmSync(tmp, { recursive: true, force: true });

const list = (base) => readdirSync(base).flatMap((n) => {
  const full = join(base, n);
  return statSync(full).isDirectory() ? list(full) : [relative(vendor, full)];
});
const files = {};
for (const f of list(vendor).sort()) {
  files[f] = createHash("sha256").update(readFileSync(join(vendor, f))).digest("hex");
}
writeFileSync(join(vendor, "tokens.lock"), JSON.stringify({ ref, files }, null, 2) + "\n");
console.log(`tokens ${ref} copiados para src/theme/vendor (${Object.keys(files).length} arquivos)`);
