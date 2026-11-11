// Faltas da UPA (módulo 32b; F-32.8; D16/D17): medicação dada na UPA sem saldo no estoque, para o farmacêutico ou almoxarife
// conferir e CONCILIAR (o ajuste do saldo é feito à parte, na posição/ajustes; aqui só se registra a conciliação com uma nota).
// Só o interruptor `pharmacy` (a tela existe com `urgency_care` desligado: falta antiga continua visível). A lista não grava trilha e
// não tem dado pessoal (só senha, hora, item e quantidade; nunca o paciente): leitura simples, relida depois de cada escrita, sem
// polling. Local de unidade → `location_id`; o almoxarife do central lê também SEM local (as `no_location` de todas as UPAs, Q7);
// ninguém mais lê sem `location_id`. Páginas por cursor (`next_before`), da mais nova para a mais antiga.
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listUrgencyShortfalls, reconcileUrgencyShortfall, type PharmacyLocation, type ShortfallState, type UrgencyShortfall } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { PH_ALERTS_KEY, STATIC_QUERY, fmtQuantity, locationRoles, pharmacyError } from "../lib/pharmacy";
import { SHORTFALL_NO_PATIENT, URGENCY_SHORTFALLS_KEY, shortfallCauseLabel } from "../lib/urgencyObservation";
import { useActionMessage } from "../lib/useActionMessage";
import { ActionMessage } from "../components/ActionMessage";
import { ConfirmButton } from "../components/ConfirmButton";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { SegmentedControl } from "../shell/SegmentedControl";
import { alert, box, checkLabel, fieldLabel, muted, row, stack } from "./exams/styles";
import { LocationPick } from "./pharmacy/LocationPick";
import { PharmacyGate } from "./pharmacy/PharmacyGate";

const TABS: { key: ShortfallState; label: string }[] = [ { key: "open", label: "Abertas" }, { key: "reconciled", label: "Conciliadas" } ];
const NOTE_PROBLEM = "a nota tem de 10 a 500 caracteres";
const noteProblem = (text: string): string | null => (text.trim().length >= 10 && text.trim().length <= 500 ? null : NOTE_PROBLEM);
const WRONG_KIND = "as faltas da UPA ficam no local de farmácia da unidade";

export function PharmacyUrgencyShortfalls() {
  return (
    <PharmacyGate title="Faltas da UPA" sub="medicação dada na UPA sem saldo no estoque" allow={(r) => r.pharmacist || r.keeper}>
      {() => (
        <LocationPick allow={(r) => r.pharmacist || r.keeper}>
          {(loc) => <Body location={loc} />}
        </LocationPick>
      )}
    </PharmacyGate>
  );
}

function Body({ location }: { location: PharmacyLocation }) {
  const roles = locationRoles(location);
  // O central só lê sem local quando é almoxarife; o api recusa de novo para qualquer outro.
  const central = location.kind === "central" && roles.keeper;
  const [ own, setOwn ] = useState(false);
  if (location.kind !== "unit" && !central) return <EmptyState title={WRONG_KIND} />;
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{central && !own ? "Sem local (todas as UPAs)" : `Local: ${location.name}`}</p>
      {central && (
        <label style={checkLabel}>
          <input type="checkbox" checked={!own} onChange={(e) => setOwn(!e.target.checked)} />
          Sem local (todas as UPAs)
        </label>
      )}
      <Shortfalls scope={central && !own ? null : location.id} />
    </div>
  );
}

const unitOf = (s: UrgencyShortfall) => `${fmtQuantity(s.quantity)} ${s.catalog_item.dispensing_unit}`;

function Shortfalls({ scope }: { scope: string | null }) {
  const queryClient = useQueryClient();
  const [ state, setState ] = useState<ShortfallState>("open");
  const [ target, setTarget ] = useState<UrgencyShortfall | null>(null);
  const [ note, setNote ] = useState("");
  const msg = useActionMessage();

  const list = useInfiniteQuery({
    queryKey: [ URGENCY_SHORTFALLS_KEY, scope, state ],
    queryFn: ({ pageParam }) => listUrgencyShortfalls({ locationId: scope, state, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const rows = (list.data?.pages ?? []).flatMap((p) => p.items);
  const reread = () => {
    void queryClient.invalidateQueries({ queryKey: [ URGENCY_SHORTFALLS_KEY ] });
    void queryClient.invalidateQueries({ queryKey: [ PH_ALERTS_KEY ] });
  };

  async function reconcile() {
    if (!target) return;
    const problem = noteProblem(note);
    if (problem) { msg.fail(problem); return; }
    msg.start();
    try {
      await reconcileUrgencyShortfall(target.shortfall_id, note.trim());
      msg.ok("Falta conciliada.");
      setTarget(null); setNote("");
    } catch (err) {
      msg.fail(pharmacyError(err));
      if (errorCode(err) === "already_reconciled") setTarget(null);
    }
    reread();
  }

  return (
    <Panel title="Faltas da UPA" sub={SHORTFALL_NO_PATIENT}>
      <div style={stack}>
        <SegmentedControl options={TABS} value={state} onChange={(s) => { setState(s); setTarget(null); setNote(""); msg.start(); }} />
        {list.isPending && <p className="mono" style={muted}>carregando…</p>}
        {list.isError && !list.data && <p role="alert" style={alert}>{pharmacyError(list.error)}</p>}
        {list.data && (
          <DataTable<UrgencyShortfall>
            cols={[
              { label: "Item", w: "2fr", card: "title", render: (s) => s.catalog_item.name },
              { label: "Quantidade", w: "1fr", render: (s) => unitOf(s) },
              { label: "Causa", w: "1.4fr", render: (s) => shortfallCauseLabel(s.cause) },
              { label: "Administração", w: "1.4fr", render: (s) => `${s.administration.ticket ?? "—"} · ${fmtDateTime(s.administration.administered_at)}` },
              ...(state === "reconciled" ? [ {
                label: "Conciliada", w: "1.6fr", render: (s: UrgencyShortfall) => `${fmtDateTime(s.reconciled_at)} · ${s.reconciled_by?.name ?? "—"}`
              } ] : [ {
                label: "", w: "auto", card: "actions" as const, render: (s: UrgencyShortfall) => (
                  <button type="button" style={secondaryButtonStyle} aria-label={`Conciliar falta de ${s.catalog_item.name}`}
                    disabled={target !== null} onClick={() => { msg.start(); setNote(""); setTarget(s); }}>Conciliar</button>
                )
              } ])
            ]}
            rows={rows} rowKey={(s) => s.shortfall_id} empty={state === "open" ? "nenhuma falta aberta" : "nenhuma falta conciliada"}
          />
        )}
        {list.data && list.hasNextPage && (
          <div style={row}>
            <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
            </button>
          </div>
        )}
        {target && (
          <div style={box}>
            <strong>{`Conciliar falta de ${target.catalog_item.name} (${unitOf(target)})`}</strong>
            <label style={fieldLabel}>
              Nota da conciliação
              <textarea style={inputStyle} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <span style={row}>
              <ConfirmButton label="Conciliar" variant="primary" question="Registrar a conciliação desta falta? Não dá para desfazer." onConfirm={reconcile} />
              <button type="button" style={secondaryButtonStyle} onClick={() => { setTarget(null); setNote(""); msg.start(); }}>Cancelar</button>
            </span>
          </div>
        )}
        <ActionMessage message={msg.message} />
      </div>
    </Panel>
  );
}
