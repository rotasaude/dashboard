// src/lib/territoryAddress.ts
// "Rua das Flores, 120" do domicílio do 24a. Módulo-folha (só tipos do api e o dicionário gerado) para o api.ts, que monta o
// domicílio da visita (módulo 24b), poder usá-lo sem ciclo de importação; o território reexporta de `territoryRegistry`.
import type { Household } from "./api";
import { STRING_DOMAINS } from "./territoryDictionaries.generated";

export const NO_ADDRESS = "domicílio sem endereço";

// Tipo de logradouro DNE pelo dicionário do §15 (vem em caixa alta: "RUA" → "Rua"); código desconhecido aparece cru.
export function streetTypeLabel(code: string): string {
  const label = STRING_DOMAINS.tipo_logradouro.find((e) => String(e.code) === code)?.label ?? code;
  return label.toLocaleLowerCase("pt-BR").replace(/(^|\s)\p{L}/gu, (c) => c.toLocaleUpperCase("pt-BR"));
}

// "Rua das Flores, 120" / "Rua das Flores, s/n", com o complemento quando há ("Rua das Flores, 120 · apto 12": apartamentos do
// mesmo número não se confundem no título, no cartão nem no nome do botão); recusa sem endereço ({}) → NO_ADDRESS.
export function addressLine(address: Household["address"]): string {
  if (!address.street) return NO_ADDRESS;
  const type = address.street_type ? streetTypeLabel(address.street_type) : "";
  const street = type ? `${type} ${address.street}` : address.street;
  const line = address.no_number ? `${street}, s/n` : address.number ? `${street}, ${address.number}` : street;
  return address.complement ? `${line} · ${address.complement}` : line;
}
