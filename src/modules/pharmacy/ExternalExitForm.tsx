// Saída externa de estoque (módulo 27b; contrato Q16, Q21, Q28, Q29, F-16): devolução ao fornecedor, remanejamento, doação ou empréstimo
// para fora da rede, de QUALQUER domínio (medicamento, insumo de campo ou vacina). Molde do TransferForm: o lote é escolhido entre os
// lotes com saldo do local (posições lidas ao abrir) e a quantidade é INTEIRA, até o saldo (a vacina, em doses e em múltiplo do frasco,
// o api confere). "Registrar saída" confere tudo antes (`externalExitProblems`) e só então abre o SensitiveAction (step-up), que fica FORA
// do <form>. A recusa do api (`problems`) aparece na linha dela e o digitado fica; nada é reenviado sozinho. `insufficient_balance` (outra
// pessoa tirou do lote) relê as posições UMA vez. Nada em URL, log ou storage; o motivo vai só no corpo.
import { useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, listPositions, recordExternalExit, type BnafarDomains, type LotBalance } from "../../lib/api";
import {
  EXTERNAL_EXITS_KEY, bnafarError, bnafarProblems, exitTypeLabel, externalExitBody, externalExitProblems, type ExternalExitDraft
} from "../../lib/bnafar";
import { fmtDay } from "../../lib/exams";
import { PH_POSITIONS_KEY, STATIC_QUERY, lotsWithBalance, pharmacyRefusals, problemItemIndex } from "../../lib/pharmacy";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, title } from "../exams/styles";
import type { ExitLocation } from "./ExitLocationPick";

const FALLBACK_TYPES = [ "S-DF", "S-TR", "S-D", "S-E" ];
const MAX_LINES = 100;
interface Line { key: string; lotId: string; quantity: string }
type Shown = { key: string; text: string };

export function ExternalExitForm({ location, today, domains, onDone, onGoToSecurity }: {
  location: ExitLocation; today: string; domains: BnafarDomains | null; onDone(): void; onGoToSecurity?(): void;
}) {
  const client = useQueryClient();
  const positions = useInfiniteQuery({
    queryKey: [ PH_POSITIONS_KEY, location.id, "external-exit" ],
    queryFn: ({ pageParam }) => listPositions({ locationId: location.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const [ exitType, setExitType ] = useState("");
  const [ destinationKind, setDestinationKind ] = useState<"cnes" | "cnpj">("cnes");
  const [ destination, setDestination ] = useState("");
  const [ reason, setReason ] = useState("");
  const [ lines, setLines ] = useState<Line[]>([ { key: "line-0", lotId: "", quantity: "" } ]);
  const [ counter, setCounter ] = useState(1);
  const [ shown, setShown ] = useState<Shown[]>([]);
  const [ confirming, setConfirming ] = useState(false);

  const offered = (positions.data?.pages ?? []).flatMap((p) => p.positions).flatMap((p) => lotsWithBalance(p));
  const byId = new Map(offered.map((b) => [ b.lot.id, b ]));
  const types = (domains?.exit_types.map((t) => t.code as string) ?? FALLBACK_TYPES);
  const many = lines.length > 1;
  const vaccine = location.kind === "vaccine_room" || location.kind === "cold_chain_central";
  const qtyLabel = vaccine ? "Quantidade (doses, inteira)" : "Quantidade (inteira)";
  const flagged = new Set(shown.map((s) => s.key));

  const draft = (): ExternalExitDraft => ({
    exitType, destinationKind, destination, reason,
    lines: lines.map((l) => ({ key: l.key, lot: byId.get(l.lotId) ?? null, quantity: l.quantity }))
  });
  // Qualquer mudança no digitado desfaz a conferência: o SensitiveAction só abre para o que foi conferido.
  const edit = (fn: () => void) => { fn(); setConfirming(false); };
  const patch = (key: string, over: Partial<Line>) => edit(() => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...over } : l))));
  const add = () => edit(() => { setLines((cur) => [ ...cur, { key: `line-${counter}`, lotId: "", quantity: "" } ]); setCounter((n) => n + 1); });
  const remove = (key: string) => edit(() => setLines((cur) => cur.filter((l) => l.key !== key)));

  const prefix = (i: number | null) => (many && i !== null ? `Linha ${i + 1}: ` : "");
  function review() {
    const found = externalExitProblems(draft(), today).map((p): Shown => {
      const i = problemItemIndex(p.path);
      return { key: i !== null && lines[i] ? lines[i].key : p.path, text: `${prefix(i)}${p.text}` };
    });
    setShown(found);
    setConfirming(found.length === 0);
  }

  function fromApi(err: unknown, sent: Line[]): Shown[] {
    return bnafarProblems(err).map((p) => {
      const i = problemItemIndex(p.path);
      const line = i === null ? undefined : sent[i];
      return { key: line ? line.key : p.path, text: `${prefix(i)}${p.text}` };
    });
  }

  async function run() {
    const sent = lines;
    try {
      await recordExternalExit(externalExitBody(draft(), location.id));
    } catch (err) {
      // 422/409: a recusa é da tela (na linha, com o digitado); o resto (step-up, rede) é do SensitiveAction.
      if (err instanceof ApiError && (err.status === 422 || err.status === 409)) {
        setConfirming(false);
        setShown(fromApi(err, sent));
        if (pharmacyRefusals(err).some((r) => r.code === "insufficient_balance")) void positions.refetch();
      }
      throw err;
    }
  }

  function done() {
    setConfirming(false); setShown([]);
    setExitType(""); setDestinationKind("cnes"); setDestination(""); setReason("");
    setLines([ { key: `line-${counter}`, lotId: "", quantity: "" } ]); setCounter((n) => n + 1);
    void client.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY, location.id ] });
    void client.invalidateQueries({ queryKey: [ EXTERNAL_EXITS_KEY, "list", location.id ] });
    onDone();
  }

  const lotLabel = (b: LotBalance) => {
    const whole = Math.trunc(Number(b.balance));
    const flags = b.blocked ? " — bloqueado" : b.lot.expires_on < today ? " — vencido" : "";
    return `${b.lot.item.name} — lote ${b.lot.lot_number} (vence ${fmtDay(b.lot.expires_on)}, saldo ${whole})${flags}`;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <form aria-label="Registrar saída externa" noValidate style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => { e.preventDefault(); review(); }}>
        <h3 style={title}>{`Saída externa de ${location.name}`}</h3>
        <div style={row}>
          <label style={fieldLabel}>
            Tipo de saída
            <select value={exitType} style={{ ...inputStyle, ...(flagged.has("exit_type") ? flaggedStyle : null) }} onChange={(e) => edit(() => setExitType(e.target.value))}>
              <option value="">Escolha o tipo</option>
              {types.map((code) => <option key={code} value={code}>{exitTypeLabel(domains, code)}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Destino
            <select value={destinationKind} style={inputStyle} onChange={(e) => edit(() => setDestinationKind(e.target.value as "cnes" | "cnpj"))}>
              <option value="cnes">CNES (estabelecimento de saúde)</option>
              <option value="cnpj">CNPJ</option>
            </select>
          </label>
          <label style={fieldLabel}>
            Código do destino
            <input value={destination} style={{ ...inputStyle, ...(flagged.has("destination_code") ? flaggedStyle : null) }} onChange={(e) => edit(() => setDestination(e.target.value))} />
          </label>
        </div>
        <label style={fieldLabel}>
          Motivo
          <textarea rows={3} value={reason} style={{ ...inputStyle, ...(flagged.has("reason") ? flaggedStyle : null) }} onChange={(e) => edit(() => setReason(e.target.value))} />
        </label>

        {positions.isPending && <p className="mono" style={muted}>carregando os lotes…</p>}
        {positions.isError && !positions.data && <p role="alert" style={alert}>{bnafarError(positions.error)}</p>}
        {positions.data && offered.length === 0 && <p style={muted}>nenhum lote com saldo neste local</p>}
        {lines.map((l, i) => {
          const named = (base: string) => (many ? `${base} ${i + 1}` : base);
          const shownLot = byId.get(l.lotId);
          return (
            <div key={l.key} style={{ ...box, ...(flagged.has(l.key) || flagged.has(`items[${i}].lot_id`) ? flaggedStyle : null) }}>
              <div style={row}>
                <label style={fieldLabel}>
                  {named("Lote")}
                  <select value={shownLot ? l.lotId : ""} style={inputStyle} aria-label={named("Lote")} onChange={(e) => patch(l.key, { lotId: e.target.value })}>
                    <option value="">Escolha o lote</option>
                    {offered.map((b) => <option key={b.lot.id} value={b.lot.id}>{lotLabel(b)}</option>)}
                  </select>
                </label>
                <label style={fieldLabel}>
                  {named(qtyLabel)}
                  <input value={l.quantity} inputMode="numeric" style={inputStyle} aria-label={named(qtyLabel)}
                    onChange={(e) => patch(l.key, { quantity: e.target.value })} />
                </label>
                {many && <button type="button" style={secondaryButtonStyle} aria-label={`Remover linha ${i + 1}`} onClick={() => remove(l.key)}>Remover</button>}
              </div>
            </div>
          );
        })}
        <div style={row}>
          <button type="button" style={secondaryButtonStyle} disabled={lines.length >= MAX_LINES} onClick={add}>Acrescentar lote</button>
          {positions.hasNextPage && (
            <button type="button" style={secondaryButtonStyle} disabled={positions.isFetchingNextPage} onClick={() => void positions.fetchNextPage()}>
              {positions.isFetchingNextPage ? "Carregando…" : "Carregar mais lotes"}
            </button>
          )}
        </div>

        {shown.length > 0 && (
          <div role="alert" style={alert}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>{shown.map((s, i) => <li key={`${s.key}-${i}`}>{s.text}</li>)}</ul>
          </div>
        )}
        {!confirming && (
          <div style={row}>
            <button type="submit" style={buttonStyle}>Registrar saída</button>
          </div>
        )}
      </form>
      {confirming && (
        <SensitiveAction
          title="Registrar a saída externa"
          description="A saída baixa o saldo dos lotes agora e não pode ser desfeita; ela vai à BNAFAR no próximo envio."
          requiresStepUp
          confirmLabel="Confirmar saída"
          run={run}
          onDone={done}
          onCancel={() => setConfirming(false)}
          onGoToSecurity={onGoToSecurity}
          translateError={(err) => bnafarError(err)}
        />
      )}
    </div>
  );
}

const flaggedStyle: CSSProperties = { borderColor: "var(--down)" };
