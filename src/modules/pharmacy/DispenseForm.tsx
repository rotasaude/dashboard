// Dispensação item a item (módulo 27a; F-27.5 e F-27.6; contrato §7, H3, H12, D11, D14, D20). Por item da receita: o texto (descrição,
// quantidade prescrita, posologia, marcas, o que já saiu), o BLOQUEIO do item no lugar dos campos (completo, vencido, contínuo antes do
// dia, controlado ou texto livre sem farmacêutico) ou os campos — no texto livre o farmacêutico escolhe o item do catálogo; o lote vem
// pré-escolhido (o que vence primeiro, nunca troca a escolha da pessoa); quantidade; "dispensado por completo".
// A retenção é UMA marca ("Receita retida na farmácia"): o número é o do documento, nunca digitado aqui. Ela aparece quando algum item
// preenchido a pede (`retention_required`, do api), ou quando o api recusou com `retention_required` (texto livre mapeado: o item não
// traz a marca antes da escolha). Todas as recusas de uma vez numa lista `role="alert"`; as do api voltam por `problems`, cujo
// `items[i]` é o índice no CORPO ENVIADO (só as linhas com quantidade), nunca o da receita. Sem step-up; sem reenvio sozinho.
// Nada de CPF, nome, medicamento ou número de notificação em URL, log ou storage.
import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import {
  listPositions, recordDispensation, type Dispensation, type PharmacyLocation, type PrescriptionItemView, type PrescriptionView, type StockItem
} from "../../lib/api";
import { todayInCity } from "../../lib/campaigns";
import { fmtDay } from "../../lib/exams";
import {
  EMPTY_DISPENSE, PH_POSITIONS_KEY, STATIC_QUERY, availableLots, cents, dispenseBody, dispenseProblems, filledLines, fmtQuantity, itemBlock,
  locationRoles, lotOptionLabel, needsRetention, pharmacyError, pharmacyRefusals, problemItemIndex, suggestedLotId, type DispenseDraft,
  type DispenseLine
} from "../../lib/pharmacy";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, muted, row, title } from "../exams/styles";
import { ItemSearch } from "./ItemSearch";

// A receita mudou por baixo da tela: a tela fecha e a pessoa busca de novo.
const STALE_CODES = new Set([ "prescription_cancelled", "prescription_expired", "prescription_not_found", "not_found" ]);
// O saldo ou a validade do lote mudou: os lotes são relidos e o digitado fica.
const REREAD_CODES = new Set([ "insufficient_balance", "lot_expired", "expired_lot" ]);

interface Row { key: string; text: string; item?: string }
const EMPTY_LINE: DispenseLine = { catalogItemId: null, lotId: "", quantity: "", complete: false };

export function DispenseForm({ location, prescription: p, today = todayInCity(), delayMs, onDone, onStale, onCancel }: {
  location: PharmacyLocation; prescription: PrescriptionView; today?: string; delayMs?: number;
  onDone(d: Dispensation): void; onStale(): void; onCancel(): void;
}) {
  const queryClient = useQueryClient();
  const pharmacist = locationRoles(location).pharmacist;
  const [ draft, setDraft ] = useState<DispenseDraft>(EMPTY_DISPENSE);
  const [ picked, setPicked ] = useState<Record<string, StockItem>>({});
  const [ forced, setForced ] = useState<string[]>([]);
  const [ rows, setRows ] = useState<Row[]>([]);
  // Os itens do corpo enviado, na ordem: `items[i]` do api volta para a linha da tela por este índice.
  const sent = useRef<string[]>([]);

  const line = (i: PrescriptionItemView): DispenseLine => draft.lines[i.id] ?? EMPTY_LINE;
  const catalogIdOf = (i: PrescriptionItemView): string | null => i.catalog_item_id ?? line(i).catalogItemId;
  const blockOf = (i: PrescriptionItemView) => itemBlock(i, { pharmacist, today });

  // Uma leitura de posição por item com catálogo (e liberado), filtrada pelo item: os lotes do item neste local.
  const reads = useQueries({
    queries: p.items.map((i) => {
      const catalogItemId = catalogIdOf(i);
      return {
        queryKey: [ PH_POSITIONS_KEY, location.id, catalogItemId ],
        queryFn: () => listPositions({ locationId: location.id, catalogItemId: catalogItemId as string }),
        enabled: catalogItemId !== null && blockOf(i) === null,
        ...STATIC_QUERY
      };
    })
  });
  const positionOf = (index: number) => {
    const wanted = catalogIdOf(p.items[index]);
    return reads[index].data?.positions.find((pos) => pos.item.catalog_item_id === wanted);
  };

  // O lote da linha: a escolha da pessoa (se ainda vale) ou o sugerido; nunca troca uma escolha que ainda vale.
  const lotOf = (i: PrescriptionItemView, index: number): string => {
    const position = positionOf(index);
    const chosen = line(i).lotId;
    if (!position) return chosen;
    if (chosen === "") return suggestedLotId(position, today);
    return availableLots(position, today).some((b) => b.lot.id === chosen) ? chosen : "";
  };

  const balances: Record<string, string> = {};
  p.items.forEach((_, index) => { for (const b of positionOf(index)?.lots ?? []) balances[b.lot.id] = b.balance; });

  const effectiveDraft: DispenseDraft = {
    ...draft,
    lines: Object.fromEntries(p.items.map((i, index) => [ i.id, { ...line(i), lotId: lotOf(i, index) } ]))
  };
  // A retenção que a tela já sabe: a do api (`retention_required`), o controlado escolhido no texto livre e o que o api recusou.
  const effective: PrescriptionView = {
    ...p,
    items: p.items.map((i) => ({
      ...i, retention_required: i.retention_required || forced.includes(i.id) || (i.catalog_item_id === null && picked[i.id]?.controlled === true)
    }))
  };
  const retention = needsRetention(effectiveDraft, effective);
  // A nota do número só vale para o controlado (lista A/B); o antimicrobiano comum retém sem número.
  const filledControlled = filledLines(effectiveDraft).some(([ id ]) => {
    const i = p.items.find((x) => x.id === id);
    return i !== undefined && (i.controlled || picked[i.id]?.controlled === true);
  });

  const send = useMutation({
    gcTime: 0,
    mutationFn: (body: ReturnType<typeof dispenseBody>) => recordDispensation(body),
    onSuccess: (saved) => { void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] }); onDone(saved); },
    onError: (err) => refused(err)
  });

  function refused(err: unknown) {
    const found = pharmacyRefusals(err);
    const out: Row[] = [];
    const retain: string[] = [];
    found.forEach((r, n) => {
      const index = problemItemIndex(r.path);
      const itemId = index !== null ? sent.current[index] : undefined;
      const item = p.items.find((i) => i.id === itemId);
      out.push({ key: `${n}-${r.path}-${r.code}`, text: r.text, item: item?.printed_description });
      if (r.code === "retention_required") {
        // Sem índice: vale para as linhas do texto livre preenchidas (ou, não havendo, para todas as preenchidas).
        const filled = filledLines(effectiveDraft).map(([ id ]) => id);
        const free = filled.filter((id) => p.items.find((i) => i.id === id)?.catalog_item_id === null);
        retain.push(...(itemId ? [ itemId ] : free.length > 0 ? free : filled));
      }
    });
    setRows(out);
    if (retain.length > 0) setForced((cur) => [ ...new Set([ ...cur, ...retain ]) ]);
    if (found.some((r) => REREAD_CODES.has(r.code))) void queryClient.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY, location.id ] });
    if (found.some((r) => STALE_CODES.has(r.code))) onStale();
  }

  const touch = () => setRows([]);
  const patchLine = (i: PrescriptionItemView, over: Partial<DispenseLine>) => {
    touch();
    setDraft((cur) => ({ ...cur, lines: { ...cur.lines, [i.id]: { ...(cur.lines[i.id] ?? EMPTY_LINE), ...over } } }));
  };
  function pick(i: PrescriptionItemView, item: StockItem) {
    setPicked((cur) => ({ ...cur, [i.id]: item }));
    patchLine(i, { catalogItemId: item.catalog_item_id, lotId: "" });
  }
  function unpick(i: PrescriptionItemView) {
    setPicked((cur) => { const next = { ...cur }; delete next[i.id]; return next; });
    patchLine(i, { catalogItemId: null, lotId: "", quantity: "", complete: false });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (send.isPending) return;
    const found = dispenseProblems(effectiveDraft, effective, { pharmacist, today, balances });
    if (found.length > 0) { setRows(found.map((f, n) => ({ key: `${n}-${f.path}`, text: f.text }))); return; }
    const body = dispenseBody(effectiveDraft, effective, location.id);
    sent.current = body.items.map((it) => it.prescription_item_id);
    // Congela o lote enviado: se o saldo mudar e o lote sumir, a releitura não troca para outro lote por baixo da pessoa.
    setDraft(effectiveDraft);
    setRows([]);
    send.mutate(body);
  }

  return (
    <form aria-label="Registrar dispensação" style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }} onSubmit={submit} noValidate>
      <h3 style={title}>{`Dispensar em ${location.name}`}</h3>
      {p.items.map((i, index) => {
        const block = blockOf(i);
        const position = positionOf(index);
        const read = reads[index];
        const chosenItem = picked[i.id];
        const catalogItem = position?.item ?? chosenItem;
        const unit = catalogItem?.dispensing_unit ?? i.quantity_unit;
        const controlledList = catalogItem?.controlled_list ?? null;
        const lots = availableLots(position, today);
        const suggested = suggestedLotId(position, today);
        const free = i.catalog_item_id === null;
        const missingCatalog = free && !line(i).catalogItemId;
        return (
          <div key={i.id} style={box}>
            <div style={row}>
              <strong>{i.printed_description}</strong>
              {i.continuous && <Tag tone="info">uso contínuo</Tag>}
              {(i.controlled || chosenItem?.controlled) && <Tag tone="warn">{controlledList ? `controlado · lista ${controlledList}` : "controlado"}</Tag>}
            </div>
            <small style={muted}>{`Prescrito: ${fmtQuantity(i.quantity)} ${i.quantity_unit}`}</small>
            {i.dosage_instructions && <small style={muted}>{i.dosage_instructions}</small>}
            {cents(i.dispensed_total) > 0 && (
              <small style={muted}>{`Já dispensado: ${fmtQuantity(i.dispensed_total)}${i.last_dispensed_on ? ` · última retirada ${fmtDay(i.last_dispensed_on)}` : ""}`}</small>
            )}
            {block ? <p style={alert}>{block}</p> : (
              <>
                {free && !chosenItem && <ItemSearch label={`Item do catálogo para ${i.printed_description}`} delayMs={delayMs} onPick={(item) => pick(i, item)} />}
                {free && chosenItem && (
                  <div style={row}>
                    <span>{`Item do catálogo: ${chosenItem.name} · ${chosenItem.dispensing_unit}`}</span>
                    <button type="button" style={secondaryButtonStyle} onClick={() => unpick(i)}>Trocar item</button>
                  </div>
                )}
                {!missingCatalog && (
                  <>
                    {read.isPending && read.fetchStatus !== "idle" && <small className="mono" style={muted}>carregando lotes…</small>}
                    {read.isError && <p role="alert" style={alert}>{pharmacyError(read.error)}</p>}
                    <div style={row}>
                      <label style={{ ...fieldLabel, flex: "2 1 32ch" }}>
                        {`Lote — ${i.printed_description}`}
                        <select value={lotOf(i, index)} style={inputStyle} onChange={(e) => patchLine(i, { lotId: e.target.value })}>
                          <option value="">{position && lots.length === 0 ? "nenhum lote com saldo neste local" : "Escolha o lote"}</option>
                          {lots.map((b) => <option key={b.lot.id} value={b.lot.id}>{lotOptionLabel(b, b.lot.id === suggested)}</option>)}
                        </select>
                      </label>
                      <label style={{ ...fieldLabel, flex: "1 1 18ch" }}>
                        {`Quantidade — ${i.printed_description} (${unit})`}
                        <input value={line(i).quantity} inputMode="decimal" style={inputStyle} autoComplete="off"
                          onChange={(e) => patchLine(i, { quantity: e.target.value })} />
                      </label>
                    </div>
                    <label style={checkLabel}>
                      <input type="checkbox" checked={line(i).complete} onChange={(e) => patchLine(i, { complete: e.target.checked })} />
                      {`Dispensado por completo — ${i.printed_description}`}
                    </label>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}

      {retention && (
        <div style={box}>
          <label style={checkLabel}>
            <input type="checkbox" checked={draft.retained} onChange={(e) => { touch(); setDraft((cur) => ({ ...cur, retained: e.target.checked })); }} />
            Receita retida na farmácia
          </label>
          {filledControlled && <small style={muted}>O número da notificação é o do próprio documento da receita; não se digita aqui.</small>}
        </div>
      )}

      {rows.length > 0 && (
        <div role="alert" style={alert}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {rows.map((r) => <li key={r.key}>{r.item && <span>{`${r.item}: `}</span>}{r.text}</li>)}
          </ul>
        </div>
      )}

      <div style={row}>
        <button type="submit" style={send.isPending ? disabledButtonStyle : buttonStyle} disabled={send.isPending}>Registrar dispensação</button>
        <button type="button" style={secondaryButtonStyle} disabled={send.isPending} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
