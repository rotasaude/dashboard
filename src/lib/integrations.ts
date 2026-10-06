// Integrações da cidade (módulo 16; ADR 0028; spec §3; contratos §2 e §5.1).
// Modo, PEC e IBGE são do operador da plataforma; credenciais são da cidade;
// interruptores são do mantenedor. Aqui só se traduz o estado em português.
import { ApiError, type CityFeatureState, type CredentialCheckStatus, type IntegrationCredential } from "./api";
import { describeActionError } from "./actionErrors";
import { fmtDateTime } from "./format";

export const INTEGRATIONS_KEY = [ "integrations" ] as const;

const RECORD_MODE_LABEL: Record<string, string> = {
  off: "desligado — o Rota Saúde não envia produção",
  integrated: "integrado — o PEC é o prontuário; o Rota Saúde envia o que registra",
  record: "prontuário — o Rota Saúde é o prontuário da cidade"
};

const CREDENTIAL_LABEL: Record<string, string> = { ledi: "e-SUS PEC (envio LEDI)", cadsus: "CADSUS" };

const CHECK_LABEL: Record<CredentialCheckStatus, string> = {
  ok: "conexão ok",
  unauthorized: "usuário ou senha recusados",
  unreachable: "serviço fora do ar ou endereço errado",
  error: "erro no teste"
};

const MESSAGES: Record<string, string> = {
  invalid_credential: "preencha usuário e senha",
  unknown_kind: "tipo de credencial desconhecido — recarregue a página",
  credential_missing: "cadastre a credencial antes de testar"
};

export function recordModeLabel(mode: string): string {
  return RECORD_MODE_LABEL[mode] ?? mode;
}

export function credentialLabel(kind: string): string {
  return CREDENTIAL_LABEL[kind] ?? kind;
}

export function checkLabel(status: CredentialCheckStatus | null): string {
  return status ? CHECK_LABEL[status] ?? status : "nunca testada";
}

export function setSummary(c: IntegrationCredential): string {
  if (!c.set) return "não cadastrada";
  return `cadastrada em ${fmtDateTime(c.set_at)}${c.set_by ? ` por ${c.set_by}` : ""}`;
}

export function checkSummary(c: IntegrationCredential): { text: string; tone: "ok" | "warn" | "down" | "neutral" } {
  if (!c.set) return { text: "não cadastrada", tone: "neutral" };
  if (!c.last_check_status) return { text: "nunca testada", tone: "neutral" };
  const tone = c.last_check_status === "ok" ? "ok" : c.last_check_status === "unauthorized" ? "down" : "warn";
  return { text: `${checkLabel(c.last_check_status)} · ${fmtDateTime(c.last_check_at)}`, tone };
}

// Pré-requisito que falta (contratos §2), dizendo quem resolve. Código novo
// do api aparece cru, nunca some: esconder um motivo deixaria a cidade sem
// saber por que a funcionalidade não anda.
export function missingPhrase(code: string): string {
  const [ head, kind = "" ] = code.split(":");
  switch (head) {
    case "record_mode_off":
      return "o modo de prontuário da cidade ainda está desligado (quem define é o operador da plataforma)";
    case "pec_url_missing":
      return "falta o endereço do PEC da cidade (quem cadastra é o operador da plataforma)";
    case "ibge_code_missing":
      return "falta o código IBGE da cidade (quem cadastra é o operador da plataforma)";
    case "credential_missing":
      return `cadastre a credencial do ${credentialLabel(kind)}, no quadro Credenciais`;
    case "credential_unauthorized":
      return `a credencial do ${credentialLabel(kind)} foi recusada — troque o usuário e a senha e teste de novo`;
    default:
      return `pendência não reconhecida: ${code}`;
  }
}

export function featureState(f: CityFeatureState): { state: "on" | "blocked" | "off"; label: string; tone: "ok" | "warn" | "neutral" } {
  if (f.enabled && f.usable) return { state: "on", label: "ligada e funcionando", tone: "ok" };
  if (f.enabled) return { state: "blocked", label: "ligada, mas parada até resolver o que falta", tone: "warn" };
  return { state: "off", label: "desligada", tone: "neutral" };
}

export function integrationsError(err: unknown): string {
  const code = err instanceof ApiError ? (err.body as { error?: unknown } | null)?.error : null;
  if (typeof code === "string" && MESSAGES[code]) return MESSAGES[code];
  const actionErr = describeActionError(err);
  return "message" in actionErr ? actionErr.message : "não foi possível concluir — tente de novo";
}
