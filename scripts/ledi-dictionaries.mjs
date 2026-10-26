#!/usr/bin/env node
// Gera src/lib/territoryDictionaries.generated.ts a partir do
// config/ledi/registration_dictionaries.yml do api (módulo 24a; contrato §15):
// domínios (códigos inteiros, na ordem do LEDI), domínios texto (uf,
// tipo_logradouro) e os campos das 5 seções. O YAML é a fonte; o .ts gerado é
// commitado e nunca editado à mão.
// Uso: node scripts/ledi-dictionaries.mjs <caminho do yml> --ref <commit do api>
//
// O YAML usa um subconjunto pequeno (mapas por indentação, mapas de fluxo
// `{ a: b }` sem aninhamento, lista de fluxo, textos entre aspas duplas sem
// escape); o leitor abaixo recusa qualquer linha fora dele em vez de adivinhar.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const fail = (line, why) => { throw new Error(`linha ${line}: ${why}`); };

// Tira o comentário do fim da linha (fora de aspas).
function stripComment(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\"") quoted = !quoted;
    if (!quoted && text[i] === "#" && (i === 0 || text[i - 1] === " ")) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

function scalar(raw, line) {
  const text = raw.trim();
  if (/^".*"$/.test(text)) {
    const inner = text.slice(1, -1);
    if (inner.includes("\"") || inner.includes("\\")) fail(line, "texto com aspas ou escape não suportado");
    return inner;
  }
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return text;
  return fail(line, `valor não suportado: ${text}`);
}

function key(raw, line) {
  const value = scalar(raw, line);
  if (typeof value === "boolean") fail(line, "chave booleana");
  return value;
}

function flowMap(text, line) {
  const body = text.slice(1, -1).trim();
  const out = {};
  for (const part of body.split(",")) {
    const at = part.indexOf(":");
    if (at < 0) fail(line, "par sem ':' no mapa de fluxo");
    const k = key(part.slice(0, at), line);
    if (Object.prototype.hasOwnProperty.call(out, k)) fail(line, `chave repetida: ${k}`);
    out[k] = scalar(part.slice(at + 1), line);
  }
  return out;
}

function value(text, line) {
  if (text.startsWith("{")) {
    if (!text.endsWith("}") || text.slice(1, -1).includes("{")) fail(line, "mapa de fluxo aninhado ou aberto");
    return flowMap(text, line);
  }
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) fail(line, "lista de fluxo aberta");
    return text.slice(1, -1).split(",").map((item) => scalar(item, line));
  }
  return scalar(text, line);
}

// Mapa por indentação. As chaves inteiras viram número (como no YAML do Ruby).
export function parseYaml(source) {
  const lines = source.split("\n").map((text, i) => ({ text: stripComment(text), line: i + 1 }))
    .filter(({ text }) => text.trim() !== "");
  let index = 0;
  function block(indent) {
    const out = new Map();
    while (index < lines.length) {
      const { text, line } = lines[index];
      const depth = text.length - text.trimStart().length;
      if (depth < indent) break;
      if (depth > indent) fail(line, "indentação inesperada");
      const content = text.trim();
      const match = /^("[^"]*"|[A-Za-z0-9_]+):(?:\s+(.*))?$/.exec(content);
      if (!match) fail(line, `linha fora do subconjunto: ${content}`);
      const k = key(match[1], line);
      if (out.has(k)) fail(line, `chave repetida: ${k}`);
      index++;
      if (match[2] === undefined) {
        const next = lines[index];
        const childIndent = next ? next.text.length - next.text.trimStart().length : 0;
        if (!next || childIndent <= indent) fail(line, `bloco vazio em ${k}`);
        out.set(k, block(childIndent));
      } else {
        out.set(k, value(match[2], line));
      }
    }
    return out;
  }
  const root = block(0);
  if (index !== lines.length) fail(lines[index].line, "sobrou conteúdo");
  return root;
}

const FIELD_PROPS = new Set([ "ledi", "type", "domain", "max", "min", "required", "max_items", "fields" ]);

function field(name, spec, types, domains) {
  const props = spec instanceof Map ? Object.fromEntries(spec) : spec;
  for (const prop of Object.keys(props)) if (!FIELD_PROPS.has(prop)) throw new Error(`${name}: propriedade desconhecida ${prop}`);
  if (!types.includes(props.type)) throw new Error(`${name}: tipo desconhecido ${props.type}`);
  if (props.domain !== undefined && !domains.has(props.domain)) throw new Error(`${name}: domínio desconhecido ${props.domain}`);
  if (/^(code|codes)$/.test(props.type) !== (props.domain !== undefined)) throw new Error(`${name}: code/codes exigem domínio`);
  const out = { key: name, ledi: props.ledi, type: props.type };
  for (const prop of [ "domain", "max", "min", "max_items", "required" ]) if (props[prop] !== undefined) out[prop] = props[prop];
  if (props.type === "object") {
    if (!(props.fields instanceof Map)) throw new Error(`${name}: object sem fields`);
    out.fields = [ ...props.fields ].map(([ k, v ]) => field(k, v, types, domains));
  }
  return out;
}

export function dictionaries(root) {
  const types = root.get("types");
  const domains = root.get("domains");
  const stringDomains = root.get("string_domains");
  const sections = root.get("sections");
  if (!Array.isArray(types) || !(domains instanceof Map) || !(stringDomains instanceof Map) || !(sections instanceof Map)) {
    throw new Error("faltam types, domains, string_domains ou sections");
  }
  const entries = (map, name, codeType) => [ ...map ].map(([ code, label ]) => {
    if (typeof code !== codeType || typeof label !== "string") throw new Error(`${name}: código ${code} fora do formato`);
    return { code, label };
  });
  return {
    version: root.get("version"),
    domains: Object.fromEntries([ ...domains ].map(([ name, map ]) => [ name, entries(map, name, "number") ])),
    stringDomains: Object.fromEntries([ ...stringDomains ].map(([ name, map ]) => [ name, entries(map, name, "string") ])),
    sections: Object.fromEntries([ ...sections ].map(([ name, fields ]) =>
      [ name, [ ...fields ].map(([ k, spec ]) => field(k, spec, types, domains)) ])),
    types
  };
}

const q = (s) => JSON.stringify(s);

function render(data, ref) {
  const union = (names) => names.map(q).join(" | ");
  const fieldLine = (f) => {
    const parts = Object.entries(f).filter(([ k ]) => k !== "fields").map(([ k, v ]) => `${k}: ${q(v)}`);
    if (f.fields) parts.push(`fields: [\n${f.fields.map((c) => `      ${fieldLine(c)}`).join(",\n")}\n    ]`);
    return `{ ${parts.join(", ")} }`;
  };
  const out = [];
  out.push(`// gerado de apps/api/config/ledi/registration_dictionaries.yml (api ${ref}) — não editar à mão.`);
  out.push("// Regerar: node scripts/ledi-dictionaries.mjs <caminho do yml> --ref <commit do api>");
  out.push(`// LEDI APS ${data.version} (contrato §15). Códigos na ordem do LEDI (a do YAML); as regras moram em territoryDictionaries.ts.`);
  out.push("");
  out.push(`export const LEDI_VERSION = ${q(data.version)};`);
  out.push(`export type FieldType = ${union(data.types)};`);
  out.push(`export type DomainKey = ${union(Object.keys(data.domains))};`);
  out.push(`export type StringDomainKey = ${union(Object.keys(data.stringDomains))};`);
  out.push(`export type SectionKey = ${union(Object.keys(data.sections))};`);
  out.push("export interface DictEntry { code: number; label: string }");
  out.push("export interface StringDictEntry { code: string; label: string }");
  out.push("export interface FieldSpec {");
  out.push("  key: string; ledi: string; type: FieldType; domain?: DomainKey; max?: number; min?: number; max_items?: number;");
  out.push("  required?: boolean; fields?: FieldSpec[];");
  out.push("}");
  out.push("");
  out.push("export const DOMAINS: Record<DomainKey, DictEntry[]> = {");
  for (const [ name, list ] of Object.entries(data.domains)) {
    out.push(`  ${name}: [`);
    list.forEach((e, i) => out.push(`    { code: ${e.code}, label: ${q(e.label)} }${i < list.length - 1 ? "," : ""}`));
    out.push("  ],");
  }
  out[out.length - 1] = "  ]";
  out.push("};");
  out.push("");
  out.push("export const STRING_DOMAINS: Record<StringDomainKey, StringDictEntry[]> = {");
  for (const [ name, list ] of Object.entries(data.stringDomains)) {
    out.push(`  ${name}: [`);
    list.forEach((e, i) => out.push(`    { code: ${q(e.code)}, label: ${q(e.label)} }${i < list.length - 1 ? "," : ""}`));
    out.push("  ],");
  }
  out[out.length - 1] = "  ]";
  out.push("};");
  out.push("");
  out.push("export const SECTIONS: Record<SectionKey, FieldSpec[]> = {");
  for (const [ name, fields ] of Object.entries(data.sections)) {
    out.push(`  ${name}: [`);
    fields.forEach((f, i) => out.push(`    ${fieldLine(f)}${i < fields.length - 1 ? "," : ""}`));
    out.push("  ],");
  }
  out[out.length - 1] = "  ]";
  out.push("};");
  return `${out.join("\n")}\n`;
}

function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--ref");
  const yml = args.find((arg, i) => !arg.startsWith("--") && i !== at + 1);
  const ref = at >= 0 ? args[at + 1] : null;
  if (!yml || !ref) {
    console.error("uso: node scripts/ledi-dictionaries.mjs <caminho do registration_dictionaries.yml> --ref <commit do api>");
    process.exit(1);
  }
  const data = dictionaries(parseYaml(readFileSync(yml, "utf8")));
  const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src/lib/territoryDictionaries.generated.ts");
  writeFileSync(target, render(data, ref));
  const count = (o) => Object.values(o).reduce((n, list) => n + list.length, 0);
  console.log(`${target}: ${Object.keys(data.domains).length} domínios (${count(data.domains)} códigos), ` +
    `${Object.keys(data.stringDomains).length} domínios texto (${count(data.stringDomains)}), ` +
    `${Object.keys(data.sections).length} seções (${count(data.sections)} campos)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
