// "Pendências do envio à BNAFAR" (módulo 27b; contrato §3, Q16, Q22, Q33, Q45, Q46; F-03, F-09, F-11, F-13, F-14, F-33): o que fica fora do
// envio de amanhã, por código, com o complemento do lote DENTRO desta tela e os atalhos para quem resolve o resto. Abre sem o `bnafar`
// (só o estoque). O api não manda o tipo do local: no `location_without_cnes` o admin vê os dois atalhos (central e rede de frio) e todos
// veem a frase da unidade. Tudo sem pessoa: leitura ao abrir, depois de salvar o lote e no "Atualizar"; nenhum polling.
import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, listBnafarPendencies, type BnafarPendency, type LotBnafarState } from "../lib/api";
import { BNAFAR_FIELD_LABEL, BNAFAR_NO_ROLE, BNAFAR_PENDENCIES_KEY, STATIC_QUERY, bnafarError, pendencyLabel } from "../lib/bnafar";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { SegmentedControl } from "../shell/SegmentedControl";
import { alert, muted, row, stack } from "./exams/styles";
import { BnafarGate } from "./bnafar/BnafarGate";
import { LotBnafarForm } from "./bnafar/LotBnafarForm";

const KNOWN = [ "lot_incomplete", "lot_number_too_long", "location_without_cnes", "product_without_code", "fractional_balance", "exit_type_missing", "domain_off" ];
const CNES_UNIT = "o CNES deste local vem da unidade de saúde — confira o cadastro da unidade";
const NO_VMP = "o VMP vem do catálogo de medicamentos da plataforma — peça à equipe do Rota Saúde";
const NO_OBM = "o código OBM vem do catálogo de imunobiológicos — peça à equipe do Rota Saúde";

type Nav = { onGoToLocations?: () => void; onGoToColdChain?: () => void; onGoToVectorProducts?: () => void; onGoToAdjustments?: () => void };

export function BnafarPending(props: Nav & { onGoToSecurity?: () => void }) {
  return (
    <BnafarGate title="Pendências do envio à BNAFAR" sub="o que fica fora do envio de amanhã e como resolver" needs="stock" allow={(r) => r.reader}>
      {(roles) => <PendingBody admin={roles.admin} {...props} />}
    </BnafarGate>
  );
}

// Código desconhecido aparece cru, nunca some.
const codeTitle = (c: string) => KNOWN.includes(c) ? pendencyLabel(c) : c;
const lotLabel = (p: BnafarPendency) => p.lot_number ?? p.item_label;
const fieldsText = (p: BnafarPendency) => p.fields.map((f) => BNAFAR_FIELD_LABEL[f] ?? f).join(", ");

function PendingBody({ admin, onGoToLocations, onGoToColdChain, onGoToVectorProducts, onGoToAdjustments }: Nav & { admin: boolean }) {
  const qc = useQueryClient();
  const [ code, setCode ] = useState<string>("");
  const [ editing, setEditing ] = useState<BnafarPendency | null>(null);
  const list = useInfiniteQuery({
    queryKey: [ BNAFAR_PENDENCIES_KEY, code ],
    queryFn: ({ pageParam }) => listBnafarPendencies({ code: code || null, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });

  if (errorCode(list.error) === "missing_role") return <EmptyState title={BNAFAR_NO_ROLE} />;

  const items = (list.data?.pages ?? []).flatMap((p) => p.items);
  const totals = list.data?.pages[0]?.totals.by_code ?? {};
  const present = [ ...KNOWN, ...[ ...new Set(items.map((i) => i.code)) ].filter((c) => !KNOWN.includes(c)) ].filter((c) => items.some((i) => i.code === c));

  // Relê a lista e devolve o estado atual do lote (versão e o que falta) para o formulário seguir sem perder o digitado.
  async function reloadLot(p: BnafarPendency): Promise<LotBnafarState | null> {
    const fresh = await list.refetch();
    const again = (fresh.data?.pages ?? []).flatMap((pg) => pg.items).find((i) => i.code === "lot_incomplete" && i.lot_id === p.lot_id);
    return again ? { version: again.lot_version ?? 0, missing: again.fields } : null;
  }

  function action(p: BnafarPendency) {
    const btn = (label: string, fn?: () => void) => <button type="button" style={secondaryButtonStyle} onClick={fn}>{label}</button>;
    switch (p.code) {
      case "lot_incomplete":
        return p.lot_id
          ? <button type="button" style={buttonStyle} onClick={() => setEditing(p)}>{`Completar dados do lote — ${lotLabel(p)}`}</button>
          : <span style={muted}>peça ao almoxarife do local para completar os dados do lote</span>;
      case "location_without_cnes":
        return (
          <div style={{ ...row, alignItems: "flex-start" }}>
            <span style={muted}>{CNES_UNIT}</span>
            {admin && btn("Abrir Locais e configurações", onGoToLocations)}
            {admin && btn("Abrir Salas e rede de frio", onGoToColdChain)}
          </div>
        );
      case "product_without_code": {
        const f = p.fields[0];
        if (f === "catmat_code" || p.item_key.startsWith("vector_control")) return btn("Abrir Produtos e parâmetros", onGoToVectorProducts);
        return <span style={muted}>{f === "obm_vmp" || p.item_key.startsWith("immunobiological") ? NO_OBM : NO_VMP}</span>;
      }
      case "fractional_balance": return btn("Abrir Inventário e ajustes", onGoToAdjustments);
      default: return <span style={muted}>{pendencyLabel(p.code)}</span>;
    }
  }

  const options = [ { key: "", label: "Todas" }, ...KNOWN.map((c) => ({ key: c, label: pendencyLabel(c) })) ];

  return (
    <div style={stack}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <SegmentedControl options={options} value={code} onChange={(c) => { setCode(c); setEditing(null); }} />
        <button type="button" style={secondaryButtonStyle} onClick={() => void list.refetch()}>Atualizar</button>
      </div>
      {list.isPending && <p className="mono" style={muted}>carregando…</p>}
      {list.isError && <p role="alert" style={alert}>{bnafarError(list.error)}</p>}
      {list.data && present.length === 0 && <EmptyState title="nenhuma pendência" sub="tudo o que está no estoque entra no envio" />}

      {present.map((c) => (
        <Panel key={c} title={codeTitle(c)} right={<Tag tone="warn">{String(totals[c] ?? items.filter((i) => i.code === c).length)}</Tag>}>
          <DataTable<BnafarPendency>
            label={codeTitle(c)}
            cols={[
              { label: "Local", w: "1fr", card: "title", render: (p) => p.location_name },
              { label: "Item", w: "1.2fr", render: (p) => p.item_label },
              { label: "Lote", w: "0.8fr", render: (p) => p.lot_number ? <span className="mono">{p.lot_number}</span> : "—" },
              { label: "O que falta", w: "1.4fr", render: (p) => fieldsText(p) || "—" },
              { label: "", w: "1.6fr", card: "actions", render: action }
            ]}
            rows={items.filter((i) => i.code === c)}
            rowKey={(p) => `${p.code}:${p.stock_location_id}:${p.item_key}:${p.stock_lot_id ?? ""}`}
            empty="nenhuma pendência"
          />
        </Panel>
      ))}

      {list.data && list.hasNextPage && (
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage ? "Carregando…" : "Carregar mais"}
          </button>
        </div>
      )}

      {editing && editing.lot_id && (
        <Panel title="Completar dados do lote" sub={`${editing.location_name} · ${editing.item_label}`}>
          <div style={{ padding: 16 }}>
            <LotBnafarForm key={editing.lot_id} lotId={editing.lot_id} lotNumber={lotLabel(editing)} locationId={editing.stock_location_id}
              state={{ version: editing.lot_version ?? 0, missing: editing.fields }}
              hasVmp={editing.vmp_code != null} vmpCode={editing.vmp_code ?? null} vaccine={editing.item_key.startsWith("immunobiological")}
              onSaved={() => { void qc.invalidateQueries({ queryKey: [ BNAFAR_PENDENCIES_KEY ] }); }}
              onCancel={() => setEditing(null)}
              reload={async () => (await reloadLot(editing)) ?? { version: editing.lot_version ?? 0, missing: [] }} />
          </div>
        </Panel>
      )}
    </div>
  );
}
