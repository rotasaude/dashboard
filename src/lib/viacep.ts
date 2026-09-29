// Consulta de CEP direto do navegador (módulo 11, ADR 0023, D6). O api nunca
// chama serviço de CEP. Falhar é normal e barato: {erro: true}, rede, HTTP
// fora de 2xx, corpo estranho ou timeout viram { ok: false }, e a tela deixa
// o endereço para o preenchimento à mão. Nunca rejeita.
export const VIACEP_TIMEOUT_MS = 5000;

export type CepResult = { ok: true; street: string; neighborhood: string } | { ok: false };

export async function lookupCep(cep: string, timeoutMs: number = VIACEP_TIMEOUT_MS): Promise<CepResult> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return { ok: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // credentials: "omit": o cookie da cidade não tem o que fazer num terceiro.
    // Sem cabeçalho próprio, para não disparar preflight de CORS.
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal, credentials: "omit" });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { erro?: unknown; logradouro?: unknown; bairro?: unknown };
    if (body.erro === true || body.erro === "true") return { ok: false };
    return {
      ok: true,
      street: typeof body.logradouro === "string" ? body.logradouro : "",
      neighborhood: typeof body.bairro === "string" ? body.bairro : ""
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
