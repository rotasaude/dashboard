// 409 qc_blocked na liberação e na retificação (contrato §3; C-E19): nada foi
// liberado. Lista os bloqueios — o api manda UMA linha por bloqueio, então o
// mesmo item pode vir mais de uma vez (release_check.rb:27-32) — com exame,
// analito e aparelho. "Liberar sem os bloqueados" (só na liberação) desmarca
// os itens que ainda têm bloqueio sem exceção; o RT/substituto registra a
// exceção bloqueio a bloqueio e libera de novo. O item só deixa de estar
// pendente quando todos os bloqueios dele têm exceção.
import { useState } from "react";
import { ApiError, type QcBlockedItem } from "../../lib/api";
import { Tag } from "../../components/Tag";
import { secondaryButtonStyle } from "../../components/formStyles";
import { QcExceptionForm } from "./QcExceptionForm";
import { box, list, muted, row } from "../exams/styles";

export const blockKey = (b: Pick<QcBlockedItem, "item_id" | "block_id">) => `${b.item_id}:${b.block_id}`;

export function blockedItems(err: unknown): QcBlockedItem[] {
  const items = err instanceof ApiError ? (err.body as { items?: unknown } | null)?.items : undefined;
  if (!Array.isArray(items)) return [];
  return items.filter((i): i is QcBlockedItem =>
    !!i && typeof i === "object" && typeof (i as QcBlockedItem).item_id === "string" && typeof (i as QcBlockedItem).block_id === "string");
}

// Itens com ao menos um bloqueio sem exceção.
export function stuckItemIds(items: QcBlockedItem[], excepted: string[]): string[] {
  return [ ...new Set(items.filter((b) => !excepted.includes(blockKey(b))).map((b) => b.item_id)) ];
}

export function QcBlockedPanel({ items, itemLabel, analyteLabel, excepted, lead, onSkip, onExcepted, onGoToSecurity }: {
  items: QcBlockedItem[]; itemLabel(itemId: string): string; analyteLabel(itemId: string, key: string): string;
  // Pares `item_id:block_id` com exceção registrada.
  excepted: string[]; lead: boolean; onSkip?(): void; onExcepted(key: string): void; onGoToSecurity?(): void;
}) {
  const [ formFor, setFormFor ] = useState<string | null>(null);
  const stuck = stuckItemIds(items, excepted);
  const exams = new Set(items.map((b) => b.item_id)).size;
  return (
    <div role="group" aria-label="bloqueado pelo controle de qualidade" style={box}>
      <p style={{ margin: 0 }}>{`O controle de qualidade reprovou e bloqueou ${exams === 1 ? "1 exame" : `${exams} exames`} desta requisição. Nada foi liberado.`}</p>
      <ul style={list}>
        {items.map((b) => {
          const key = blockKey(b);
          return (
            <li key={key}>
              <div style={row}>
                <span>{`${itemLabel(b.item_id)} · ${analyteLabel(b.item_id, b.analyte_key)} · ${b.instrument_name || b.instrument_id}`}</span>
                {excepted.includes(key) ? <Tag tone="ok">exceção registrada</Tag> : lead && formFor !== key && (
                  <button type="button" style={secondaryButtonStyle} onClick={() => setFormFor(key)}>Liberar com exceção</button>
                )}
              </div>
              {formFor === key && !excepted.includes(key) && (
                <QcExceptionForm blockId={b.block_id} itemId={b.item_id} onCancel={() => setFormFor(null)} onGoToSecurity={onGoToSecurity}
                  onDone={() => { setFormFor(null); onExcepted(key); }} />
              )}
            </li>
          );
        })}
      </ul>
      {!lead && <p style={muted}>peça a exceção ao responsável técnico ou ao substituto, ou aguarde a corrida aprovada depois da ação corretiva</p>}
      {stuck.length === 0 && <p style={muted}>exceções registradas — confira e libere de novo</p>}
      {stuck.length > 0 && onSkip && <div><button type="button" style={secondaryButtonStyle} onClick={onSkip}>Liberar sem os bloqueados</button></div>}
    </div>
  );
}
