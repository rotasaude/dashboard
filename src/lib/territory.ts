// Regras do território sem React (módulo 11, ADR 0023; spec 2026-09-28 §5).
import { ApiError, type Neighborhood } from "./api";

// Uma chave só para a lista de bairros: tela Território, formulário de
// unidade e seletor dos painéis leem e invalidam o mesmo cache.
export const NEIGHBORHOODS_KEY = [ "territoryNeighborhoods" ] as const;
export const NAME_MAX = 120;
export const SOURCE_LABEL: Record<Neighborhood["source"], string> = { seed: "semente", manual: "manual" };

// "São Brás" e "sao bras" são o mesmo bairro, na busca e no CEP (D6).
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function sortByName<T extends { name: string }>(rows: T[]): T[] {
  return [ ...rows ].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Bairro vindo do ViaCEP → bairro ATIVO da cidade com o mesmo nome. Só
// sugere: quem decide é o admin (D6), e bairro inativo não entra em escolha
// nova (ADR 0023, invariantes).
export function matchNeighborhood(name: string | null | undefined, list: Neighborhood[]): Neighborhood | null {
  const key = normalizeName(name ?? "");
  if (!key) return null;
  return list.find((n) => n.active && normalizeName(n.name) === key) ?? null;
}

export function validateNeighborhoodName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "informe o nome do bairro";
  if (trimmed.length > NAME_MAX) return `nome com mais de ${NAME_MAX} caracteres`;
  return null;
}

const GENERIC = "não foi possível concluir — tente de novo";
const MESSAGES: Record<string, string> = {
  name_taken: "já existe um bairro com este nome",
  blank_name: "informe o nome do bairro",
  inactive_unit: "há unidade desativada ou inexistente na cobertura — recarregue e tente de novo",
  inactive_neighborhood: "bairro desativado não recebe cobertura — reative antes",
  not_found: "bairro não encontrado — recarregue a lista",
  missing_role: "seu papel não permite esta ação",
  forbidden: "seu papel não permite esta ação"
};

export function territoryError(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  if (err.status === 401) return "sessão expirada — entre de novo";
  const code = (err.body as { error?: string } | undefined)?.error;
  return (code && MESSAGES[code]) || GENERIC;
}
