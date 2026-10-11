// src/lib/oauthReturn.ts
// Retorno de um fluxo OAuth na mesma aba (assinatura do 19b; SNCR do 19d):
// leitura da URL de volta sob a base do dashboard e o destino seguro depois
// dela. Puras: quem chama passa a URL e a base (nos testes,
// import.meta.env.BASE_URL é "/"). Nada daqui guarda ou registra os valores.
import { ApiError } from "./api";

// Os parâmetros `keys` da URL, só no caminho `path` sob a base (barra final
// tolerada); parâmetro ausente ou em branco vira null.
export function readReturnParams<K extends string>(
  path: string, keys: readonly K[], pathname: string, search: string, base: string
): Record<K, string | null> | null {
  if (pathname.replace(/\/+$/, "") !== `${base}${path}`) return null;
  const params = new URLSearchParams(search);
  const out = {} as Record<K, string | null>;
  for (const key of keys) {
    const value = params.get(key);
    out[key] = value && value.trim() !== "" ? value : null;
  }
  return out;
}

// Só caminho local de módulo (`/x…`): nada de `//host`, `/\host`, URL absoluta ou "/".
export function safeReturnTo(value: unknown, fallback: string): string {
  return typeof value === "string" && /^\/[^/\\]/.test(value) ? value : fallback;
}

// O api devolve o return_to guardado com o state também nas recusas depois de
// achar o state do próprio usuário (ex.: 409 authorization_expired).
export function errorReturnTo(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return null;
  const returnTo = (err.body as { return_to?: unknown }).return_to;
  return typeof returnTo === "string" ? returnTo : null;
}
