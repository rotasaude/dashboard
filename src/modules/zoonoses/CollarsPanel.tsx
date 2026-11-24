// src/modules/zoonoses/CollarsPanel.tsx
// "Coleiras a trocar" (módulo 35b, F-35.15): as coleiras ativas de cães ativos que vencem em até 15 dias (`GET /zoonoses/collars?due=1`,
// o api ordena e filtra), a troca e a retirada. Colocar coleira num cão com coleira ativa troca a anterior (o api grava `replaced`);
// a retirada manual só tem perdida, óbito e outro, sem `expected_version` (a coleira não tem versão). 409 collar_changed: a frase e
// UMA releitura. A falta de saldo da coleira só aparece em "Faltas de insumo de campo" (o api não manda a flag aqui).
// A lista traz o nome e a espécie do animal (desvio 2 da Task 10) e não grava trilha; só o clique no nome lê o histórico (com trilha).
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listDueCollars, placeCollar, removeCollar, type Animal, type Collar, type CollarRemovalReason, type DueCollar } from "../../lib/api";
import { fmtDay } from "../../lib/homeVisits";
import { STATIC_QUERY, ZOO_COLLARS_KEY, isZoonosesStale, zooLabel, zoonosesError, zoonosesRefusals } from "../../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../../lib/zoonosesErrors";
import type { Problem } from "../../lib/pharmacy";
import { ActionButton } from "../../components/ActionButton";
import { DataTable, type Column } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row, stack } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { AnimalSearch } from "./AnimalSearch";
import { AnimalHistory } from "./AnimalHistory";
import { animalRefusal, dogProblems, staleButAnimal } from "./TestsPanel";
import { useZooDomains } from "./useZooDomains";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;
const MANUAL_REASONS: CollarRemovalReason[] = [ "lost", "death", "other" ];
export const REPLACES_ACTIVE = "a coleira ativa sai como trocada";
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const refusals = (err: unknown) => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null }));

type DueAnimal = { id: string; name: string | null };
type Placing = { animal: DueAnimal | null } | null;
export const NO_NAME_DOG = "Cão sem nome";
const dogName = (a: DueAnimal): string => a.name ?? NO_NAME_DOG;

export function CollarsPanel({ today }: { today: string }) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const q = useQuery({ queryKey: [ ZOO_COLLARS_KEY, "due" ], queryFn: listDueCollars, ...STATIC_QUERY });
  const [ placing, setPlacing ] = useState<Placing>(null);
  const [ removing, setRemoving ] = useState<DueCollar | null>(null);
  const [ notice, setNotice ] = useState<string | null>(null);
  const [ viewing, setViewing ] = useState<string | null>(null);
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_COLLARS_KEY ] });
  const product = (id: string) => domains?.products.find((p) => p.id === id)?.name ?? id;
  const stale = (text: string) => { setNotice(text); setPlacing(null); setRemoving(null); void reread(); };
  const start = (p: Placing, r: DueCollar | null) => { setNotice(null); setPlacing(p); setRemoving(r); };

  const cols: Column<DueCollar>[] = [
    // Nome (ou "Cão sem nome"), nunca o tutor; o clique abre o histórico do animal.
    { label: "Animal", w: "0.9fr", card: "title", render: (c) => (
      <ActionButton variant="secondary" onClick={() => setViewing(c.animal.id)}>{dogName(c.animal)}</ActionButton>
    ) },
    { label: "Produto", w: "1.2fr", render: (c) => product(c.vector_product_id) },
    { label: "Colocada", w: "0.8fr", render: (c) => fmtDay(c.placed_on) },
    { label: "Vence", w: "0.8fr", render: (c) => fmtDay(c.due_on) },
    {
      label: "Prazo", w: "0.9fr", render: (c) => {
        const n = days(today, c.due_on);
        return n < 0 ? <Tag tone="down">vencida</Tag> : <Tag tone="warn">{n === 0 ? "vence hoje" : n === 1 ? "vence em 1 dia" : `vence em ${n} dias`}</Tag>;
      }
    },
    {
      label: "Ações", w: "1.4fr", card: "actions", render: (c) => (
        <span style={row}>
          <ActionButton variant="secondary" onClick={() => start({ animal: c.animal }, null)}>Trocar coleira</ActionButton>
          <ActionButton variant="secondary" onClick={() => start(null, c)}>Retirar</ActionButton>
        </span>
      )
    }
  ];

  return (
    <div style={stack}>
      {!placing && <div style={row}><ActionButton onClick={() => start({ animal: null }, null)}>Nova coleira</ActionButton></div>}
      {placing && (
        <PlaceForm key={placing.animal?.id ?? "new"} fixed={placing.animal} today={today} onCancel={() => setPlacing(null)} onStale={stale}
          onPlaced={(c) => { setPlacing(null); setNotice(`Coleira colocada; vence em ${fmtDay(c.due_on)}.`); void reread(); }} />
      )}
      {removing && (
        <RemoveForm key={removing.id} collar={removing} today={today} onCancel={() => setRemoving(null)} onStale={stale}
          onRemoved={() => { setRemoving(null); setNotice("Coleira retirada."); void reread(); }} />
      )}
      {notice && <p role="status" style={muted}>{notice}</p>}
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <p role="alert" style={alert}>{zoonosesError(q.error)}</p>}
      {q.data && <DataTable<DueCollar> label="Coleiras a trocar" cols={cols} rows={q.data} rowKey={(c) => c.id} empty="nenhuma coleira a trocar" />}
      {viewing && (
        <div style={stack}>
          {/* Só leitura: a edição do cadastro é da tela Animais. */}
          <AnimalHistory key={viewing} id={viewing} onEdit={() => undefined} editor={() => <></>} />
          <div style={row}><ActionButton variant="secondary" onClick={() => setViewing(null)}>Fechar histórico</ActionButton></div>
        </div>
      )}
    </div>
  );
}

// Colocar: o cão da linha (a troca) ou um cão buscado; produto com a finalidade `collar`; data até hoje (padrão hoje).
function PlaceForm({ fixed, today, onPlaced, onStale, onCancel }: {
  fixed: DueAnimal | null; today: string; onPlaced(c: Collar): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems({ refusals, isStale: staleButAnimal });
  const [ dog, setDog ] = useState<Animal | null>(null);
  const [ chosen, setChosen ] = useState("");
  const [ placedOn, setPlacedOn ] = useState(today);
  const busy = f.busy;
  const products = (domains?.products ?? []).filter((p) => p.use === "collar");
  const productId = chosen || (products.length === 1 ? products[0].id : "");
  const target = fixed?.id ?? dog?.id ?? null;

  function check(): Problem[] {
    const out = fixed ? [] : dogProblems(dog);
    if (!productId) out.push({ path: "vector_product_id", text: "escolha a coleira" });
    if (!DATE.test(placedOn)) out.push({ path: "placed_on", text: "informe a data da colocação" });
    else if (placedOn > today) out.push({ path: "placed_on", text: ZOONOSES_ERRORS.date_out_of_range });
    return out;
  }
  const submit = (ev: React.FormEvent) => void f.submit(ev, {
    check, call: () => placeCollar({ animal_id: target!, vector_product_id: productId, placed_on: placedOn }), ok: onPlaced, stale: onStale,
    refused: animalRefusal
  });

  return (
    <div style={form}>
      {!fixed && !dog && <div style={box}><AnimalSearch onOpen={(_id, a) => { setDog(a); f.clear("animal_id"); }} /></div>}
      <form ref={f.formRef} noValidate style={{ ...form, ...box }} aria-label="Colocar coleira" onSubmit={submit}>
        <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>{fixed ? "Trocar coleira" : "Nova coleira"}</p>
        {fixed && <p style={muted}>{dogName(fixed)}</p>}
        {!fixed && (dog ? (
          <div style={row}>
            <span>{dog.name ?? "sem nome"} · {zooLabel(domains?.species, dog.species)}</span>
            <ActionButton variant="secondary" onClick={() => { if (!busy) { setDog(null); f.clear("animal_id"); } }}>Trocar animal</ActionButton>
          </div>
        ) : <p style={muted}>busque o cão acima</p>)}
        {f.errNode("animal_id")}
        <p style={muted}>{fixed ? `O cão já usa coleira: ${REPLACES_ACTIVE}.` : `Se o cão já usar coleira, ${REPLACES_ACTIVE}.`}</p>
        <label style={fieldLabel}>
          Produto
          <select value={productId} disabled={busy} style={inputStyle} {...f.aria("vector_product_id")}
            onChange={(e) => { setChosen(e.target.value); f.clear("vector_product_id"); }}>
            <option value="">escolha</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {f.errNode("vector_product_id")}
        <label style={fieldLabel}>
          Data da colocação
          <input type="date" value={placedOn} disabled={busy} style={inputStyle} {...f.aria("placed_on")}
            onChange={(e) => { setPlacedOn(e.target.value); f.clear("placed_on"); }} />
        </label>
        {f.errNode("placed_on")}
        {f.top((p) => [ "animal_id", "vector_product_id", "placed_on" ].includes(p))}
        <div style={row}>
          <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Colocar coleira</button>
          <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}

// Retirar: motivo manual (perdida, óbito, outro) e data entre a colocação e hoje.
function RemoveForm({ collar, today, onRemoved, onStale, onCancel }: {
  collar: DueCollar; today: string; onRemoved(c: Collar): void; onStale(text: string): void; onCancel(): void;
}) {
  const domains = useZooDomains().data;
  const f = useFormProblems({ refusals, isStale: (err) => isZoonosesStale(err) });
  const [ reason, setReason ] = useState("");
  const [ removedOn, setRemovedOn ] = useState(today);
  const busy = f.busy;

  function check(): Problem[] {
    const out: Problem[] = [];
    if (!MANUAL_REASONS.includes(reason as CollarRemovalReason)) out.push({ path: "reason", text: "escolha o motivo da retirada" });
    if (!DATE.test(removedOn)) out.push({ path: "removed_on", text: "informe a data da retirada" });
    else if (removedOn > today) out.push({ path: "removed_on", text: ZOONOSES_ERRORS.date_out_of_range });
    else if (removedOn < collar.placed_on) out.push({ path: "removed_on", text: "a retirada não pode ser antes da colocação" });
    return out;
  }
  const submit = (ev: React.FormEvent) => void f.submit(ev, {
    check, call: () => removeCollar(collar.id, { reason: reason as CollarRemovalReason, removed_on: removedOn }), ok: onRemoved, stale: onStale
  });

  return (
    <form ref={f.formRef} noValidate style={{ ...form, ...box }} aria-label="Retirar coleira" onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Retirar coleira</p>
      <label style={fieldLabel}>
        Motivo da retirada
        <select value={reason} disabled={busy} style={inputStyle} {...f.aria("reason")} onChange={(e) => { setReason(e.target.value); f.clear("reason"); }}>
          <option value="">escolha</option>
          {MANUAL_REASONS.map((r) => <option key={r} value={r}>{zooLabel(domains?.removal_reasons, r)}</option>)}
        </select>
      </label>
      {f.errNode("reason")}
      <label style={fieldLabel}>
        Data da retirada
        <input type="date" value={removedOn} disabled={busy} style={inputStyle} {...f.aria("removed_on")}
          onChange={(e) => { setRemovedOn(e.target.value); f.clear("removed_on"); }} />
      </label>
      {f.errNode("removed_on")}
      {f.top((p) => [ "reason", "removed_on" ].includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Confirmar retirada</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
