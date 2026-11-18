// src/modules/vectorControl/BlocksPanel.tsx
// Quarteirões de um bairro (módulo 35a, F-35.1; contrato §2; Q18): todos do bairro, na ordem natural do api, sem cursor e sem
// pessoa (STATIC_QUERY, relida depois de cada ação). Novo quarteirão (número no Catalog::BLOCK_NUMBER, sem caixa único no
// bairro: 422 block_number_taken no campo), vizinhos (o par pode cruzar bairros; remover grava ended_at, o par fica no
// histórico) e desativar (409 block_in_use → a frase e UMA releitura). Nenhum reenvio; botões presos enquanto a chamada corre.
import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addBlockNeighbor, createCityBlock, listCityBlocks, listPanelNeighborhoods, removeBlockNeighbor, updateCityBlock, type CityBlock
} from "../../lib/api";
import { PANEL_NEIGHBORHOODS_KEY } from "../../lib/neighborhoodFilter";
import { sortByName } from "../../lib/territory";
import { STATIC_QUERY, VC_BLOCKS_KEY, blockNumberProblem, isVectorStale, vectorError, vectorRefusals } from "../../lib/vectorControl";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import { useActionMessage } from "../../lib/useActionMessage";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { EmptyState } from "../../components/EmptyState";
import { ActionButton } from "../../components/ActionButton";
import { ActionMessage } from "../../components/ActionMessage";
import { ConfirmButton } from "../../components/ConfirmButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row, stack } from "../exams/styles";

export const blocksKey = (neighborhoodId: string) => [ VC_BLOCKS_KEY, neighborhoodId ];
// Sem releitura ao montar outro leitor da mesma lista (o painel de vizinhos, a aba Imóveis): relida só pelas ações (invalidate).
export const useBlocks = (neighborhoodId: string) =>
  useQuery({ queryKey: blocksKey(neighborhoodId), queryFn: () => listCityBlocks(neighborhoodId), ...STATIC_QUERY, staleTime: Infinity });

// Os quarteirões de todos os bairros já lidos nesta tela (o vizinho pode ser de outro bairro): só o cache, sem leitura nova.
// Assina o cache: quando o bairro de um vizinho é lido (no painel de vizinhos), o número aparece também na tabela.
function useKnownBlocks(): Map<string, CityBlock> {
  const queryClient = useQueryClient();
  const [ , setTick ] = useState(0);
  useEffect(() => queryClient.getQueryCache().subscribe((e) => {
    if (e.type === "updated" && e.query.queryKey[0] === VC_BLOCKS_KEY) setTick((t) => t + 1);
  }), [ queryClient ]);
  const known = new Map<string, CityBlock>();
  for (const [ , list ] of queryClient.getQueriesData<CityBlock[]>({ queryKey: [ VC_BLOCKS_KEY ] })) for (const b of list ?? []) known.set(b.id, b);
  return known;
}

// O rótulo de cada vizinho, distinto entre si. O /blocks traz TODOS os quarteirões do bairro (Q18), então um id fora dos
// bairros lidos é mesmo de outro bairro; o api não manda o número dele (só `neighbor_ids`), e a tela não lê os outros bairros
// sozinha: ele vira "de outro bairro nº k", na ordem de `neighbor_ids`, até o bairro dele ser escolhido.
export function neighborLabels(ids: string[], known: Map<string, CityBlock>, neighborhoodId: string): Map<string, string> {
  const out = new Map<string, string>();
  let k = 0;
  for (const id of ids) {
    const n = known.get(id);
    if (!n) out.set(id, `de outro bairro nº ${++k}`);
    else out.set(id, n.neighborhood.id === neighborhoodId ? n.number : `${n.number} (${n.neighborhood.name})`);
  }
  return out;
}
export const UNKNOWN_NEIGHBOR_HINT = "escolha o bairro do vizinho abaixo para ver o número";

export function BlocksPanel({ neighborhoodId }: { neighborhoodId: string }) {
  const queryClient = useQueryClient();
  const blocks = useBlocks(neighborhoodId);
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, ...STATIC_QUERY });
  const known = useKnownBlocks();
  const msg = useActionMessage();
  const [ openId, setOpenId ] = useState<string | null>(null);
  const reread = () => queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_KEY ] });

  const neighborText = (b: CityBlock) => {
    if (b.neighbor_ids.length === 0) return "—";
    const labels = neighborLabels(b.neighbor_ids, known, neighborhoodId);
    return b.neighbor_ids.map((id) => labels.get(id)).join(", ");
  };

  // Desativar e reativar: a frase do código, uma releitura no estado velho (409 block_in_use, 404), nenhum reenvio.
  async function setActive(b: CityBlock, active: boolean) {
    msg.start();
    try {
      await updateCityBlock(b.id, { active });
      msg.ok(`quarteirão ${b.number} ${active ? "reativado" : "desativado"}`);
      await reread();
    } catch (err) {
      msg.fail(vectorError(err));
      if (isVectorStale(err)) await reread();
    }
  }

  const neighborhood = neighborhoods.data?.find((n) => n.id === neighborhoodId);
  const open = blocks.data?.find((b) => b.id === openId) ?? null;
  return (
    <div style={stack}>
      <Panel title="Quarteirões">
        <div style={stack}>
          {blocks.isError ? <p role="alert" style={alert}>{vectorError(blocks.error)}</p>
            : !blocks.data ? <p role="status" style={muted}>Carregando…</p>
            : blocks.data.length === 0 ? <EmptyState title="nenhum quarteirão neste bairro" />
            : (
              <DataTable label="Quarteirões do bairro" rows={blocks.data} rowKey={(b) => b.id} cols={[
                { label: "Número", card: "title", render: (b) => <strong>{b.number}</strong> },
                { label: "Imóveis ativos", align: "right", render: (b) => String(b.households_count) },
                { label: "Vizinhos", w: "2fr", render: (b) => neighborText(b) },
                { label: "Ativo", render: (b) => <Tag tone={b.active ? "ok" : "neutral"} mono={false}>{b.active ? "ativo" : "inativo"}</Tag> },
                { label: "Ações", w: "2fr", card: "actions", render: (b) => (
                  <div style={row}>
                    <button type="button" style={secondaryButtonStyle} aria-expanded={openId === b.id}
                      onClick={() => setOpenId(openId === b.id ? null : b.id)}>Vizinhos</button>
                    {b.active
                      ? <ConfirmButton label="Desativar" question={`desativar o quarteirão ${b.number}?`} onConfirm={() => setActive(b, false)} />
                      : <ConfirmButton label="Reativar" question={`reativar o quarteirão ${b.number}?`} onConfirm={() => setActive(b, true)} />}
                  </div>
                ) }
              ]} />
            )}
          <ActionMessage message={msg.message} />
        </div>
      </Panel>
      {open && <NeighborsPanel key={open.id} block={open} neighborhoodId={neighborhoodId} />}
      {neighborhood && !neighborhood.active
        ? <p style={muted}>bairro inativo — não recebe quarteirão novo</p>
        : <NewBlockForm neighborhoodId={neighborhoodId} existing={blocks.data ?? []} />}
    </div>
  );
}

function NewBlockForm({ neighborhoodId, existing }: { neighborhoodId: string; existing: CityBlock[] }) {
  const queryClient = useQueryClient();
  const [ number, setNumber ] = useState("");
  const [ problem, setProblem ] = useState<string | null>(null);
  const msg = useActionMessage();
  const errorId = useId();

  async function create() {
    msg.start();
    const local = blockNumberProblem(number)?.text
      ?? (existing.some((b) => b.number.toLowerCase() === number.toLowerCase()) ? VECTOR_ERRORS.block_number_taken : null);
    setProblem(local);
    if (local) return;
    try {
      const created = await createCityBlock({ neighborhood_id: neighborhoodId, number });
      setNumber("");
      msg.ok(`quarteirão ${created.number} criado`);
      await queryClient.invalidateQueries({ queryKey: blocksKey(neighborhoodId) });
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      if (refusal.path === "number") setProblem(refusal.text);
      else msg.fail(refusal.text);
    }
  }

  return (
    <Panel title="Novo quarteirão">
      <div style={stack}>
        <label style={{ ...fieldLabel, maxWidth: 240 }}>
          Número do quarteirão
          <input value={number} style={inputStyle} aria-invalid={problem ? true : undefined} aria-describedby={problem ? errorId : undefined}
            onChange={(e) => { setNumber(e.target.value); setProblem(null); }} />
        </label>
        {problem && <p id={errorId} role="alert" style={alert}>{problem}</p>}
        <div><ActionButton onClick={create}>Criar quarteirão</ActionButton></div>
        <ActionMessage message={msg.message} />
      </div>
    </Panel>
  );
}

function NeighborsPanel({ block, neighborhoodId }: { block: CityBlock; neighborhoodId: string }) {
  const queryClient = useQueryClient();
  const known = useKnownBlocks();
  const neighborhoods = useQuery({ queryKey: PANEL_NEIGHBORHOODS_KEY, queryFn: listPanelNeighborhoods, ...STATIC_QUERY });
  const [ otherId, setOtherId ] = useState(neighborhoodId);
  const [ pickedId, setPickedId ] = useState("");
  const candidates = useBlocks(otherId);
  const msg = useActionMessage();
  const reread = () => queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_KEY ] });
  // Nem ele mesmo (invalid_neighbor) nem quem já é vizinho; só os ativos (o raio em anéis ignora os inativos).
  const options = (candidates.data ?? []).filter((b) => b.active && b.id !== block.id && !block.neighbor_ids.includes(b.id));
  const labels = neighborLabels(block.neighbor_ids, known, neighborhoodId);
  const label = (id: string) => labels.get(id) ?? id;
  const anyUnknown = block.neighbor_ids.some((id) => !known.has(id));

  async function run(action: () => Promise<unknown>, ok: string) {
    msg.start();
    try {
      await action();
      msg.ok(ok);
      setPickedId("");
      await reread();
    } catch (err) {
      msg.fail(vectorError(err));
      // Quarteirão sumido (404) ou vizinho que não existe mais (invalid_request no neighbor_block_id): uma releitura.
      const r = vectorRefusals(err)[0];
      if (isVectorStale(err) || (r.code === "invalid_request" && r.path === "neighbor_block_id")) await reread();
    }
  }

  return (
    <Panel title={`Vizinhos do quarteirão ${block.number}`}>
      <div style={stack}>
        {block.neighbor_ids.length === 0 ? <p style={muted}>sem vizinhos</p> : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
            {block.neighbor_ids.map((id) => (
              <li key={id} style={row}>
                <span>{known.has(id) ? label(id) : `vizinho ${label(id)}`}</span>
                <ConfirmButton label={`Remover o vizinho ${label(id)}`} question={`remover o vizinho ${label(id)}? o par fica no histórico`}
                  onConfirm={() => run(() => removeBlockNeighbor(block.id, id), "vizinho removido — o par fica no histórico")} />
              </li>
            ))}
          </ul>
        )}
        {anyUnknown && <p style={muted}>{UNKNOWN_NEIGHBOR_HINT}</p>}
        <div style={box}>
          <div style={row}>
            <label style={fieldLabel}>
              Bairro do vizinho
              <select value={otherId} style={inputStyle} onChange={(e) => { setOtherId(e.target.value); setPickedId(""); }}>
                {!neighborhoods.data && <option value={neighborhoodId}>bairro selecionado</option>}
                {sortByName(neighborhoods.data ?? []).map((n) => <option key={n.id} value={n.id}>{n.active ? n.name : `${n.name} (inativo)`}</option>)}
              </select>
            </label>
            <label style={fieldLabel}>
              Quarteirão vizinho
              <select value={pickedId} style={inputStyle} disabled={!candidates.data} onChange={(e) => setPickedId(e.target.value)}>
                <option value="">escolha o número</option>
                {options.map((b) => <option key={b.id} value={b.id}>{b.number}</option>)}
              </select>
            </label>
          </div>
          {candidates.isError && <p role="alert" style={alert}>{vectorError(candidates.error)}</p>}
          <div>
            <ActionButton variant="secondary" disabledReason={pickedId ? null : "escolha o quarteirão vizinho"}
              onClick={() => run(() => addBlockNeighbor(block.id, pickedId), "vizinho adicionado")}>Adicionar vizinho</ActionButton>
          </div>
        </div>
        <ActionMessage message={msg.message} />
      </div>
    </Panel>
  );
}
