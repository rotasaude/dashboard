// src/lib/citizenNames.ts
// Nomes conferidos no documento (módulo 19; spec §3; contratos §2): completo
// obrigatório (3–200), social e mãe opcionais (até 200). Nome de exibição =
// social, senão completo (quem decide é o api). Nunca em URL nem em log.
import type { CitizenNamesInput } from "./api";

export const NAME_MAX = 200;
export const FULL_NAME_MIN = 3;

export interface NamesDraft { fullName: string; socialName: string; motherName: string }
export const EMPTY_NAMES: NamesDraft = { fullName: "", socialName: "", motherName: "" };

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

export function namesProblem(d: NamesDraft): string | null {
  const full = clean(d.fullName);
  if (full.length < FULL_NAME_MIN) return "informe o nome completo como no documento";
  if (full.length > NAME_MAX) return `o nome completo pode ter até ${NAME_MAX} caracteres`;
  if (clean(d.socialName).length > NAME_MAX) return `o nome social pode ter até ${NAME_MAX} caracteres`;
  if (clean(d.motherName).length > NAME_MAX) return `o nome da mãe pode ter até ${NAME_MAX} caracteres`;
  return null;
}

export function namesBody(d: NamesDraft): CitizenNamesInput {
  const social = clean(d.socialName);
  const mother = clean(d.motherName);
  return { full_name: clean(d.fullName), ...(social ? { social_name: social } : {}), ...(mother ? { mother_name: mother } : {}) };
}
