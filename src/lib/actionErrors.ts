// Tradução, num lugar só, das respostas da API da cidade a uma ação sensível
// (spec do dashboard §6). Nenhuma tela lê status HTTP: todas perguntam isto.
// A mensagem de domínio (`message` dos commands) sai verbatim; um código cru
// (`invalid_state`, `http_500`) nunca chega ao usuário.
import { ApiError } from "./api";

export type ActionError =
  | { kind: "mfa_required" }
  | { kind: "invalid_code"; code: string; message: string }
  | { kind: "forbidden"; message: string }
  | { kind: "rejected"; code?: string; message: string }
  | { kind: "session_expired"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "failed"; message: string };

const GENERIC = "não foi possível concluir — tente de novo";
const GENERIC_STALE = "a versão em uso mudou enquanto você lia. Confira e decida de novo.";

function bodyField(body: unknown, key: string): string | null {
  if (body && typeof body === "object" && typeof (body as Record<string, unknown>)[key] === "string") {
    return (body as Record<string, string>)[key];
  }
  return null;
}

export function describeActionError(err: unknown): ActionError {
  if (!(err instanceof ApiError)) return { kind: "failed", message: GENERIC };
  const code = bodyField(err.body, "error");

  if (err.status === 401 && code === "mfa_required") return { kind: "mfa_required" };
  if (err.status === 401) return { kind: "session_expired", message: "sessão expirada — entre de novo" };
  // Erros do campo do código (a matrícula em duas etapas da API: spec do
  // autenticador pendente §4). `code` viaja junto para a tela escolher a
  // frase sem reler status HTTP.
  if (err.status === 422 && code === "invalid_code") {
    return { kind: "invalid_code", code, message: "código inválido" };
  }
  if (err.status === 422 && code === "code_reused") {
    return { kind: "invalid_code", code, message: "código já usado — espere o próximo" };
  }
  if (err.status === 422 && code === "enrollment_expired") {
    return { kind: "rejected", code, message: "cadastro expirado — comece de novo" };
  }
  // D2: no retry de uma resposta perdida, a confirmação anterior na verdade
  // deu certo (o pendente já foi promovido e limpo) — o 422 genérico não diz
  // isso, e sugere tentar de novo algo que já terminou.
  if (err.status === 422 && code === "no_pending_enrollment") {
    return { kind: "rejected", code, message: "este cadastro já foi concluído — recarregue a página" };
  }
  // 409 da reversão: não é "tente de novo", é "o mundo mudou entre a leitura e
  // o clique". A mensagem do servidor nomeia a versão em uso agora e sai
  // verbatim — é ela que deixa a pessoa decidir com o dado certo. O `code`
  // viaja junto porque a tela precisa saber que deve RELER a lista, coisa que
  // o 409 genérico logo abaixo não diz.
  if (err.status === 409 && code === "current_version_changed") {
    return { kind: "rejected", code, message: bodyField(err.body, "message") ?? GENERIC_STALE };
  }
  if (err.status === 403) return { kind: "forbidden", message: "seu papel não permite esta ação" };
  if (err.status === 429) return { kind: "rate_limited", message: "muitas tentativas — aguarde alguns minutos" };
  if (err.status === 422 || err.status === 409) {
    return { kind: "rejected", message: bodyField(err.body, "message") ?? "a API recusou a ação" };
  }
  return { kind: "failed", message: GENERIC };
}
