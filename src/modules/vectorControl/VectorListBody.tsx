// src/modules/vectorControl/VectorListBody.tsx
// O corpo de uma lista paginada do 35a (ovitrampas, amostras): a recusa pela tabela do 35a (nunca o código cru), carregando, a frase
// do cursor, os itens e "Carregar mais".
import type { ReactNode } from "react";
import { vectorError } from "../../lib/vectorControl";
import type { Paged } from "../homeVisits/usePaged";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, stack } from "../exams/styles";

export function VectorListBody<T>({ list, children }: { list: Paged<T>; children(items: T[]): ReactNode }) {
  if (list.error) return <p role="alert" style={alert}>{vectorError(list.error)}</p>;
  if (!list.items) return <p role="status" style={muted}>Carregando…</p>;
  return (
    <div style={stack}>
      {list.note && <p role="status" style={muted}>{list.note}</p>}
      {children(list.items)}
      {list.hasMore && (
        <div>
          <button type="button" style={secondaryButtonStyle} disabled={list.loadingMore} onClick={() => void list.more()}>
            {list.loadingMore ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
