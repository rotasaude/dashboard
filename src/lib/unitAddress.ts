// Endereço da unidade (módulo 11, spec 2026-09-28 §3.3): texto livre +
// CEP de 8 dígitos + bairro da lista da cidade. Os campos da tela são
// strings; o payload troca vazio por null (null apaga na API).
import type { UnitAddress } from "./api";
import { onlyDigits } from "./attendance";

export interface AddressFields { street: string; number: string; complement: string; zip: string; neighborhoodId: string }

export const EMPTY_ADDRESS_FIELDS: AddressFields = { street: "", number: "", complement: "", zip: "", neighborhoodId: "" };
export const EMPTY_ADDRESS: UnitAddress = {
  address_street: null, address_number: null, address_complement: null, address_zip: null, neighborhood_id: null
};

export function maskCep(input: string): string {
  const d = onlyDigits(input).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function zipError(zip: string): string | null {
  const d = onlyDigits(zip);
  return d.length === 0 || d.length === 8 ? null : "CEP precisa ter 8 dígitos";
}

export function addressFieldsFrom(unit: Partial<UnitAddress>): AddressFields {
  return {
    street: unit.address_street ?? "",
    number: unit.address_number ?? "",
    complement: unit.address_complement ?? "",
    zip: unit.address_zip ? maskCep(unit.address_zip) : "",
    neighborhoodId: unit.neighborhood_id ?? ""
  };
}

const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

export function addressPayload(fields: AddressFields): UnitAddress {
  const zip = onlyDigits(fields.zip);
  return {
    address_street: orNull(fields.street),
    address_number: orNull(fields.number),
    address_complement: orNull(fields.complement),
    address_zip: zip === "" ? null : zip,
    neighborhood_id: fields.neighborhoodId || null
  };
}

export function formatAddress(unit: Partial<UnitAddress>, neighborhoodName?: string | null): string {
  const street = [ unit.address_street, unit.address_number ].filter(Boolean).join(", ");
  const line = [ street, unit.address_complement ].filter(Boolean).join(" — ");
  const parts = [ line, neighborhoodName ?? "", unit.address_zip ? maskCep(unit.address_zip) : "" ].filter((p) => p.trim() !== "");
  return parts.length > 0 ? parts.join(" · ") : "—";
}
