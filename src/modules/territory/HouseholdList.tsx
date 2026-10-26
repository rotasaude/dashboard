// src/modules/territory/HouseholdList.tsx
// Domicílios de uma microárea (contrato §4; preflight C6): do último salvo ao
// mais antigo, 50 por vez, com o cursor opaco do api repassado como veio. A
// lista é NOMINAL e GRAVA trilha: lida ao abrir a microárea e em "Carregar
// mais", nunca sozinha (NOMINAL_QUERY). A lista não traz moradia nem condição
// de ninguém — só endereço, tipo de imóvel, famílias e situação.
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { listHouseholds, type Household } from "../../lib/api";
import { dictLabel } from "../../lib/territoryDictionaries";
import { HOUSEHOLDS_KEY, NOMINAL_QUERY, fmtDay, territoryError } from "../../lib/territoryRegistry";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, muted, okText, row, stack } from "../exams/styles";
import { HouseholdForm } from "./HouseholdForm";

export const NO_ADDRESS = "domicílio sem endereço";
export const HOUSEHOLD_SAVED = "Domicílio salvo. Nova versão enviada ao e-SUS.";

// Tipo de logradouro DNE pelo dicionário do §15 (vem em caixa alta: "RUA" →
// "Rua"); código desconhecido aparece cru.
export function streetTypeLabel(code: string): string {
  return dictLabel("tipo_logradouro", code).toLocaleLowerCase("pt-BR").replace(/(^|\s)\p{L}/gu, (c) => c.toLocaleUpperCase("pt-BR"));
}

// "Rua das Flores, 120" / "Rua das Flores, s/n"; recusa sem endereço ({}) → NO_ADDRESS.
export function addressLine(address: Household["address"]): string {
  if (!address.street) return NO_ADDRESS;
  const type = address.street_type ? streetTypeLabel(address.street_type) : "";
  const street = type ? `${type} ${address.street}` : address.street;
  if (address.no_number) return `${street}, s/n`;
  return address.number ? `${street}, ${address.number}` : street;
}

export function householdStatus(h: Pick<Household, "refused" | "status">): { label: string; tone: string } {
  if (h.refused) return { label: "recusou o cadastro", tone: "neutral" };
  return h.status === "active" ? { label: "ativo", tone: "ok" } : { label: "inativo", tone: "neutral" };
}

// Toda microárea listada é uma em que o profissional grava (can_register): "Novo domicílio" sempre cabe.
export function HouseholdList({ microAreaId, onOpen }: { microAreaId: string; onOpen(id: string): void }) {
  const [ creating, setCreating ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);
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
    { label: "Tipo de imóvel", w: "160px", render: (h) => dictLabel("tipo_de_imovel", h.property_type) },
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
      {creating ? (
        <div style={box}>
          <strong>Novo domicílio</strong>
          <HouseholdForm microAreaId={microAreaId} onCancel={() => setCreating(false)}
            onSaved={() => { setCreating(false); setNotice(HOUSEHOLD_SAVED); }} />
        </div>
      ) : (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setCreating(true); }}>Novo domicílio</button>
          {notice && <p role="status" style={okText}>{notice}</p>}
        </div>
      )}
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
