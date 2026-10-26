// src/modules/territory/HouseholdList.tsx
// Domicílios de uma microárea (contrato §4; preflight C6): do último salvo ao
// mais antigo, 50 por vez, com o cursor opaco do api repassado como veio. A
// lista é NOMINAL e GRAVA trilha: lida ao abrir a microárea e em "Carregar
// mais", nunca sozinha (NOMINAL_QUERY). A lista não traz moradia nem condição
// de ninguém — só endereço, tipo de imóvel, famílias e situação.
import { useInfiniteQuery } from "@tanstack/react-query";
import { listHouseholds, type Household } from "../../lib/api";
import { HOUSEHOLDS_KEY, NOMINAL_QUERY, fmtDay, territoryError } from "../../lib/territoryRegistry";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, stack } from "../exams/styles";

// Tipo de logradouro DNE (texto). Só os comuns até a tabela completa do §15
// (tipo_logradouro) chegar com os dicionários; código desconhecido aparece cru.
const STREET_TYPE: Record<string, string> = { "081": "Rua", "008": "Avenida" };
export const NO_ADDRESS = "domicílio sem endereço";

// "Rua das Flores, 120" / "Rua das Flores, s/n"; recusa sem endereço ({}) → NO_ADDRESS.
export function addressLine(address: Household["address"]): string {
  if (!address.street) return NO_ADDRESS;
  const type = address.street_type ? STREET_TYPE[address.street_type] ?? address.street_type : "";
  const street = type ? `${type} ${address.street}` : address.street;
  if (address.no_number) return `${street}, s/n`;
  return address.number ? `${street}, ${address.number}` : street;
}

export function householdStatus(h: Pick<Household, "refused" | "status">): { label: string; tone: string } {
  if (h.refused) return { label: "recusou o cadastro", tone: "neutral" };
  return h.status === "active" ? { label: "ativo", tone: "ok" } : { label: "inativo", tone: "neutral" };
}

export function HouseholdList({ microAreaId, onOpen }: { microAreaId: string; onOpen(id: string): void }) {
  const query = useInfiniteQuery({
    queryKey: [ HOUSEHOLDS_KEY, microAreaId ],
    queryFn: ({ pageParam }) => listHouseholds({ microAreaId, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  const rows = (query.data?.pages ?? []).flatMap((p) => p.households);
  const cols: Column<Household>[] = [
    { label: "Endereço", w: "2fr", card: "title", render: (h) => addressLine(h.address) },
    // Rótulo do tipo de imóvel vem com os dicionários do §15; até lá, o código.
    { label: "Tipo de imóvel", w: "120px", render: (h) => h.property_type },
    { label: "Famílias", w: "90px", render: (h) => String(h.families.filter((f) => !f.moved_out).length) },
    { label: "Situação", w: "150px", render: (h) => { const s = householdStatus(h); return <Tag tone={s.tone}>{s.label}</Tag>; } },
    { label: "Cadastrado em", w: "120px", render: (h) => fmtDay(h.registered_at) },
    {
      label: "Ação", w: "100px", card: "actions",
      render: (h) => <button type="button" style={secondaryButtonStyle} aria-label={`Abrir ${addressLine(h.address)}`} onClick={() => onOpen(h.id)}>Abrir</button>
    }
  ];
  return (
    <div style={stack}>
      {query.isPending && <p className="mono" style={muted}>carregando…</p>}
      {query.isError && <p role="alert" style={alert}>{territoryError(query.error)}</p>}
      {query.data && <DataTable<Household> cols={cols} rows={rows} rowKey={(h) => h.id} empty="nenhum domicílio cadastrado nesta microárea" />}
      {query.hasNextPage && (
        <div>
          <button type="button" style={secondaryButtonStyle} disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            Carregar mais
          </button>
        </div>
      )}
    </div>
  );
}
