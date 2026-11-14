#!/usr/bin/env node
// Copia map-style/dist do contracts, numa ref (tag), para o dashboard e grava
// src/lib/vendor/map-style.lock (ref + SHA-256 por arquivo, com o caminho a
// partir da raiz do repo). Só o tema claro (contrato do 24c, Q18):
//   style-light.json, manifest.json → src/lib/vendor/map-style/
//   fontes do manifesto + OFL.txt   → public/map/fonts/
//   sprites light*                  → public/map/sprites/
// Uso: node scripts/map-style-sync.mjs map-style-v1.0.0 --contracts ../../contracts
// GIT=/opt/homebrew/bin/git quando o git do PATH não funcionar.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const ref = args[0];
const at = args.indexOf("--contracts");
if (!ref || at < 0 || !args[at + 1]) {
  console.error("uso: node scripts/map-style-sync.mjs <ref> --contracts <caminho do clone do contracts>");
  process.exit(1);
}
const contracts = resolve(args[at + 1]);
const git = process.env.GIT || "git";
const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(appRoot, "src/lib/vendor/map-style");
const publicMap = join(appRoot, "public/map");

const tmp = mkdtempSync(join(tmpdir(), "map-style-"));
const tar = execFileSync(git, ["-C", contracts, "archive", "--format=tar", ref, "map-style/dist"], { maxBuffer: 256 * 1024 * 1024 });
execFileSync("tar", ["-x", "-C", tmp], { input: tar, maxBuffer: 256 * 1024 * 1024 });
const dist = join(tmp, "map-style/dist");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

rmSync(vendor, { recursive: true, force: true });
rmSync(publicMap, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });
mkdirSync(join(publicMap, "fonts"), { recursive: true });
mkdirSync(join(publicMap, "sprites"), { recursive: true });

cpSync(join(dist, "style-light.json"), join(vendor, "style-light.json"));
cpSync(join(dist, "manifest.json"), join(vendor, "manifest.json"));
for (const stack of manifest.fonts) {
  cpSync(join(dist, "fonts", stack), join(publicMap, "fonts", stack), { recursive: true });
}
cpSync(join(dist, "fonts/OFL.txt"), join(publicMap, "fonts/OFL.txt"));
for (const name of readdirSync(join(dist, "sprites")).filter((n) => /^light(@2x)?\.(json|png)$/.test(n))) {
  cpSync(join(dist, "sprites", name), join(publicMap, "sprites", name));
}
rmSync(tmp, { recursive: true, force: true });

const list = (base) => readdirSync(base).flatMap((n) => {
  const full = join(base, n);
  return statSync(full).isDirectory() ? list(full) : [relative(appRoot, full)];
});
const files = {};
for (const f of [...list(vendor), ...list(publicMap)].sort()) {
  files[f] = createHash("sha256").update(readFileSync(join(appRoot, f))).digest("hex");
}
writeFileSync(join(appRoot, "src/lib/vendor/map-style.lock"), JSON.stringify({ ref, files }, null, 2) + "\n");
console.log(`map-style ${ref} copiado (${Object.keys(files).length} arquivos)`);
