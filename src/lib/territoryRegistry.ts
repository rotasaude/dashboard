// src/lib/territoryRegistry.ts
// Regras de tela do cadastro individual e domiciliar (módulo 24a; ADR 0042;
// contrato 2026-10-23 §1–§6). Situação de validade, quem pode cadastrar e o
// formato de cada recusa são do api: aqui só se traduzem os códigos e se
// recusa o que o api recusaria por formato. Nada aqui guarda dado da ficha
// (sem rascunho) nem escreve em log; a frase de erro nunca repete o enviado.
import { ApiError, errorCode } from "./api";
import { describeActionError } from "./actionErrors";
import { isValidCpf, onlyDigits } from "./attendance";
import { COUNT_QUERY, NOMINAL_QUERY, STATIC_QUERY, fmtDay } from "./careLines";
import { featureDisabledKey, hasFeature } from "./features";

// "Lê sem trilha" é uma regra só, a do módulo 23.
export { COUNT_QUERY, NOMINAL_QUERY, STATIC_QUERY, fmtDay };

export const TERRITORY_DISABLED = "o cadastro individual e domiciliar está desligado nesta cidade";
export const TERRITORY_NO_ROLE = "seu papel não permite usar o cadastro territorial";
export const STALE_TEXT = "outra pessoa salvou enquanto você editava — recarregue para ver a versão nova";
// L24: o posto atualizou a identidade do paciente depois do último cadastro.
export const IDENTITY_REVIEW_TEXT = "identidade atualizada no posto, revisar e salvar";

// Texto único para pessoa sem nome (paciente de par validado sem perfil) e equipe sem nome no CNES.
export const NO_NAME = "pessoa sem nome no cadastro";
export const NO_TEAM_NAME = "equipe sem nome";
export function teamName(team: { name: string | null }): string { return team.name ?? NO_TEAM_NAME; }

export const TERRITORY_CONTEXT_KEY = "territoryContext";
export const MICRO_AREAS_KEY = "territoryMicroAreas";
export const ADMIN_TEAMS_KEY = "territoryAdminTeams";
export const HOUSEHOLDS_KEY = "territoryHouseholds";
export const HOUSEHOLD_KEY = "territoryHousehold";
export const RESIDENTS_KEY = "territoryResidents";
export const REGISTRATION_KEY = "territoryRegistration";
export const REGISTRY_STATUS_KEY = "territoryRegistryStatus";
export const REGISTRY_COUNT_KEY = "territoryRegistryCount";

type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// O interruptor `territory_registry` exige o prontuário (`clinical_record`); a
// tela só existe com os dois na sessão, e nunca para o operador da plataforma.
export function canUseTerritory(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "territory_registry") && hasFeature(user, "clinical_record");
}

export function territoryRoles(user: SessionLike): { professional: boolean; admin: boolean } {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return { professional: roles.includes("health_professional"), admin: roles.includes("municipal_admin") };
}

// ─── Rótulos (contrato §1, L19, L23). Código novo do api aparece cru. ──────
const STATUS_LABEL: Record<string, string> = {
  valid: "válido", due_soon: "vence em até 60 dias", expired: "vencido (24 meses ou mais)", missing: "sem cadastro",
  missing_identifier: "sem identificador (CPF ou CNS)", refused: "recusou o cadastro", exited: "saiu do cadastro"
};
export function registryStatusLabel(code: string): string { return STATUS_LABEL[code] ?? code; }

const STATUS_TONE: Record<string, string> = {
  valid: "ok", due_soon: "warn", expired: "down", missing: "down", missing_identifier: "warn", refused: "neutral", exited: "neutral"
};
export function registryStatusTone(code: string): string { return STATUS_TONE[code] ?? "neutral"; }

export const EXIT_REASONS: { key: "moved" | "death"; label: string }[] = [
  { key: "moved", label: "mudou de território" }, { key: "death", label: "óbito" }
];
export function exitReasonLabel(code: string): string { return EXIT_REASONS.find((r) => r.key === code)?.label ?? code; }

// ─── Formato (o api recusa de novo) ────────────────────────────────────────
const CODE_PROBLEM = "código de 01 a 99, com dois dígitos";
export function microAreaCodeProblem(code: string): string | null {
  return /^(0[1-9]|[1-9][0-9])$/.test(code) ? null : CODE_PROBLEM;
}

// SaveMicroArea::NAME_MAX = 60; recusado, nunca cortado.
export const MICRO_AREA_NAME_MAX = 60;
export function microAreaNameProblem(name: string): string | null {
  const text = name.trim();
  if (!text) return "informe o nome da microárea";
  return text.length > MICRO_AREA_NAME_MAX ? `nome com mais de ${MICRO_AREA_NAME_MAX} caracteres` : null;
}

// Busca de possíveis duplicados: nome e sobrenome, nascimento até hoje; a mãe é opcional.
export function duplicateQueryProblem(q: { full_name: string; birth_date: string; mother_name?: string }, today: string): string | null {
  if (q.full_name.trim().split(/\s+/).filter(Boolean).length < 2) return "informe nome e sobrenome";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.birth_date)) return "informe a data de nascimento";
  return q.birth_date > today ? "nascimento depois de hoje" : null;
}

export function cpfProblem(cpf: string): string | null {
  return isValidCpf(onlyDigits(cpf)) ? null : "CPF inválido: confira os 11 dígitos";
}

// ─── Recusas do api (frase, nunca o corpo nem o valor enviado) ─────────────
const CHECK_FIELD = "confira o campo destacado";
const ERRORS: Record<string, string> = {
  duplicate_code: "já existe microárea com este código na equipe",
  acs_not_in_team: "o ACS escolhido não é agente comunitário ativo desta equipe",
  acs_without_cns: "o ACS precisa ter CNS no cadastro de profissionais para ser responsável pela microárea",
  team_kind_not_allowed: "só equipes de saúde da família (70) e de atenção primária (76) têm microáreas",
  invalid_code: CODE_PROBLEM,
  already_registered: "esta pessoa já tem cadastro individual ativo — abra o cadastro dela para atualizar",
  cpf_taken: "este CPF já pertence a outro paciente — confira o número; a junção de pacientes ainda não existe",
  cns_taken: "este CNS já pertence a outro paciente — confira o número",
  citizen_not_verified: "este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes",
  cpf_or_reason_required: "informe o CPF ou o motivo de não ter CPF",
  invalid_cpf: "CPF inválido: confira os 11 dígitos",
  invalid_cns: "CNS inválido: confira os 15 dígitos",
  identity_locked: "a identidade desta pessoa já foi validada presencialmente — não se altera aqui",
  // O api manda o mesmo código para etnia fora de 05 e para código fora da lista LEDI.
  invalid_ethnicity: "etnia inválida: só vale com raça/cor indígena e com um código de etnia da lista — confira a raça/cor ou escolha outro código",
  too_long: "texto maior que o limite do campo destacado",
  invalid_transition: "esta ação não vale para a situação atual do cadastro (já saiu ou recusou)",
  cbo_not_allowed: "só o ACS da microárea, enfermeiro ou médico da equipe grava o cadastro",
  out_of_scope: "esta microárea não é da sua equipe",
  missing_role: TERRITORY_NO_ROLE,
  stale_version: STALE_TEXT,
  invalid_household: CHECK_FIELD,
  invalid_family: CHECK_FIELD,
  invalid_registration: CHECK_FIELD,
  address_from_household: "o endereço desta pessoa vem do cadastro domiciliar — altere pelo domicílio",
  invalid_request: "pedido inválido — recarregue a tela e tente de novo",
  invalid_limit: "tamanho de página inválido — recarregue a tela",
  invalid_cursor: "a lista mudou — recarregue",
  person_not_found: "nenhuma pessoa com este CPF — preencha os dados para cadastrar",
  not_found: "não encontrado — recarregue",
  too_many_requests: "muitas buscas seguidas — aguarde um minuto"
};
// invalid_registration num lugar que não é campo da tela: o domicílio, a
// família ou a microárea mudou depois da leitura.
const PLACE_PATHS = new Set([ "micro_area_id", "household_id", "family_id", "is_responsible", "version" ]);
const PLACE_CHANGED = "o domicílio, a família ou a microárea não aceita mais este cadastro — recarregue";
// 422/409 fora do mapa e sem frase do api (o padrão comum diria "a API recusou a ação").
const REFUSED = "o sistema recusou — confira os dados e tente de novo";
// invalid_micro_area traz `field` (name | active): a frase diz qual.
const MICRO_AREA_FIELD: Record<string, string> = {
  name: `nome da microárea inválido: de 1 a ${MICRO_AREA_NAME_MAX} caracteres`,
  active: "situação da microárea inválida — recarregue"
};

function bodyString(err: unknown, key: string): string | null {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return null;
  const value = (err.body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function territoryError(err: unknown): string {
  if (featureDisabledKey(err) !== null) return TERRITORY_DISABLED;
  const code = errorCode(err);
  if (code === "invalid_micro_area") return MICRO_AREA_FIELD[bodyString(err, "field") ?? ""] ?? CHECK_FIELD;
  if (code === "invalid_registration" && PLACE_PATHS.has(bodyString(err, "path") ?? "")) return PLACE_CHANGED;
  if (code && Object.prototype.hasOwnProperty.call(ERRORS, code)) return ERRORS[code];
  if (err instanceof ApiError) {
    if ((err.status === 422 || err.status === 409) && !bodyString(err, "message")) return REFUSED;
    // Fora do mapa: o padrão do SensitiveAction (frase, nunca o código cru).
    const described = describeActionError(err);
    if ("message" in described) return described.message;
    return `não foi possível concluir (${err.status}) — tente de novo`;
  }
  return "sem conexão com o servidor — tente de novo";
}

// Caminho do campo recusado (`path` do cadastro e do domicílio; `field` da microárea): a tela foca nele.
export function errorPath(err: unknown): string | null {
  return bodyString(err, "path") ?? bodyString(err, "field");
}

export function isStale(err: unknown): boolean { return errorCode(err) === "stale_version"; }
