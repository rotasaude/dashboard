// Histórico de retiradas do paciente (módulo 27a; F-27.5; contrato §7, H12) + "Registrar devolução" (acréscimo da coordenação).
// É leitura NOMINAL (grava trilha por pessoa no api): lê ao abrir, "Carregar mais" pelo cursor e NUNCA relê sozinha (NOMINAL_QUERY,
// gcTime 0); cada abertura do painel é uma leitura nova. O `patient_id` vai na URL (é id); CPF, CNS e nome nunca. A marca
// "receita retida" aparece, o NÚMERO da notificação não. A devolução (só pharmacist/pharmacy_assistant do local da dispensação) troca
// o item na lista com a dispensação que o api devolveu — sem reler a leitura nominal. Nada em storage.
import { useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { listDispensations, listMyPharmacyLocations, type Dispensation, type DispensationPage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtDateTime } from "../../lib/format";
import {
  NOMINAL_QUERY, PH_DISPENSATIONS_KEY, PH_LOCATIONS_KEY, PH_MOVEMENTS_KEY, PH_POSITIONS_KEY, STATIC_QUERY, cents, fmtQuantity, locationRoles, pharmacyError,
  pharmacyRoleLabel, returnRemaining
} from "../../lib/pharmacy";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { disabledButtonStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, okText, row, stack } from "../exams/styles";
import { ReturnForm } from "./ReturnForm";

export const HISTORY_EMPTY = "nenhuma retirada registrada para este paciente";
export const RETURN_SAVED_TEXT = "Devolução registrada.";
const itemList: CSSProperties = { margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 };

interface Returning { dispensationId: string; itemId: string }

export function PatientHistory({ patientId }: { patientId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = [ PH_DISPENSATIONS_KEY, patientId ];
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => listDispensations(patientId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...NOMINAL_QUERY
  });
  // O papel POR LOCAL (mesma chave do LocationPick): sem a lista de locais, ninguém ganha o botão.
  const locations = useQuery({ queryKey: [ PH_LOCATIONS_KEY, user?.id ?? null ], queryFn: listMyPharmacyLocations, enabled: !!user, ...STATIC_QUERY });
  const [ returning, setReturning ] = useState<Returning | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);

  const dispensations = (query.data?.pages ?? []).flatMap((p) => p.dispensations);
  const patientName = dispensations.find((d) => d.patient.display_name)?.patient.display_name ?? null;
  const canReturn = (d: Dispensation): boolean => {
    const loc = (locations.data ?? []).find((l) => l.id === d.location.id);
    if (!loc) return false;
    const r = locationRoles(loc);
    return r.pharmacist || r.assistant;
  };

  const target = returning ? dispensations.find((d) => d.id === returning.dispensationId) : undefined;
  const targetItem = target?.items.find((i) => i.id === returning?.itemId);

  // Troca a dispensação na lista que já está na tela (sem nova leitura nominal); o saldo do local mudou, então posições e extrato ficam velhos.
  function returned(updated: Dispensation) {
    queryClient.setQueryData<InfiniteData<DispensationPage, string | null>>(queryKey, (cur) => cur && ({
      ...cur, pages: cur.pages.map((pg) => ({ ...pg, dispensations: pg.dispensations.map((d) => (d.id === updated.id ? updated : d)) }))
    }));
    void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ PH_MOVEMENTS_KEY ] });
    setReturning(null);
    setNotice(RETURN_SAVED_TEXT);
  }

  return (
    <section aria-label="Histórico de retiradas" style={stack}>
      <strong>{patientName ? `Histórico de retiradas de ${patientName}` : "Histórico de retiradas"}</strong>
      {query.isPending && <p className="mono" style={muted}>carregando o histórico…</p>}
      {query.isError && !query.data && <p role="alert" style={alert}>{pharmacyError(query.error)}</p>}
      {notice && <p role="status" style={okText}>{notice}</p>}
      {query.data && (
        <DataTable<Dispensation>
          cols={[
            { label: "Quando", w: "1fr", card: "title", render: (d) => fmtDateTime(d.at) },
            { label: "Local", w: "1.2fr", render: (d) => d.location.name },
            { label: "Itens", w: "3fr", card: "pair", render: (d) => (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <ul style={itemList}>
                {d.items.map((i) => (
                  <li key={i.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>{`${i.item.name} — ${fmtQuantity(i.quantity)} (lote ${i.lot.lot_number})`}</span>
                    <span style={row}>
                      {cents(i.returned_total) > 0 && <small style={muted}>{`devolvido ${fmtQuantity(i.returned_total)}`}</small>}
                      {i.mapped_from_free_text && <small style={muted}>item da receita em texto livre</small>}
                      {canReturn(d) && returnRemaining(i) > 0 && (
                        <button type="button" style={secondaryButtonStyle} aria-label={`Registrar devolução de ${i.item.name}`}
                          onClick={() => { setNotice(null); setReturning({ dispensationId: d.id, itemId: i.id }); }}>
                          Registrar devolução
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {d.retention && <span style={row}><Tag tone="warn" mono={false}>receita retida</Tag></span>}
              </div>
            ) },
            { label: "Por", w: "1.2fr", render: (d) => `${d.by.name} · ${pharmacyRoleLabel(d.by.role)}` }
          ]}
          rows={dispensations}
          rowKey={(d) => d.id}
          empty={HISTORY_EMPTY}
        />
      )}
      {query.hasNextPage && (
        <div>
          <button type="button" disabled={query.isFetchingNextPage} style={query.isFetchingNextPage ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => void query.fetchNextPage()}>
            Carregar mais
          </button>
        </div>
      )}
      {query.isError && query.data && <p role="alert" style={alert}>{pharmacyError(query.error)}</p>}
      {target && targetItem && (
        <ReturnForm key={targetItem.id} dispensation={target} item={targetItem} onDone={returned} onCancel={() => setReturning(null)} />
      )}
    </section>
  );
}
