// src/modules/vectorControl/HouseholdsPanel.tsx
// Imóveis do bairro na vigilância ambiental (módulo 35a, F-35.1; contrato §2; Q2). GET /vector_control/households grava a
// trilha `territory_registry` com os imóveis mostrados: leitura NOMINAL (lida ao abrir e relida só por ação, nunca sozinha).
// Filtro "sem quarteirão" (padrão) ou por quarteirão — este sem o bairro, para o imóvel que mudou de bairro e ficou com o
// quarteirão do anterior aparecer (marcado). Nunca morador: endereço curto, tipo, microárea, quarteirão, risco e a última
// visita trabalhada, como o api devolve. Atribuir em lote (até 200 ids, só no corpo; tudo ou nada: a recusa com path
// `household_ids[i]` marca aquele imóvel e a seleção fica) e editar o perfil (quarteirão e risco; a resposta do PATCH, que
// também grava a trilha, entra no lugar da linha — sem reler a lista).
import { useState } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  assignHouseholdsBlock, listVectorHouseholds, updateHouseholdProfile, type CityBlock, type RiskClass, type VectorControlDomains,
  type VectorHousehold
} from "../../lib/api";
import { fmtDay } from "../../lib/homeVisits";
import { dictLabel } from "../../lib/territoryDictionaries";
import {
  RISK_CLASSES, VC_BLOCKS_KEY, VC_HOUSEHOLDS_KEY, domainLabel, isVectorStale, riskTone, vectorError, vectorRefusals
} from "../../lib/vectorControl";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import { useActionMessage } from "../../lib/useActionMessage";
import { PagedBody, usePaged, type Page } from "../homeVisits/usePaged";
import { useBlocks } from "./BlocksPanel";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { EmptyState } from "../../components/EmptyState";
import { ActionButton } from "../../components/ActionButton";
import { ActionMessage } from "../../components/ActionMessage";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, muted, row, stack } from "../exams/styles";

// Catalog::ASSIGN_BATCH.
export const ASSIGN_MAX = 200;
const WITHOUT = "without";
export const OTHER_NEIGHBORHOOD_TAG = "quarteirão de outro bairro";
// Com quarteirão e sem bairro na versão atual do 24a: o perfil não recebe quarteirão novo (household_without_neighborhood).
export const NO_NEIGHBORHOOD_TAG = "imóvel sem bairro no cadastro";
const HOUSEHOLD_PATH = /^household_ids\[(\d+)\]$/;

export function HouseholdsPanel({ neighborhoodId, domains }: { neighborhoodId: string; domains: VectorControlDomains | null }) {
  const queryClient = useQueryClient();
  const blocks = useBlocks(neighborhoodId);
  const [ filter, setFilter ] = useState(WITHOUT);
  const key = [ VC_HOUSEHOLDS_KEY, neighborhoodId, filter ];
  const list = usePaged<VectorHousehold>(key, (before) => listVectorHouseholds(filter === WITHOUT
    ? { neighborhoodId, withoutBlock: true, before } : { cityBlockId: filter, before }), true, true, vectorError);
  const [ selected, setSelected ] = useState<string[]>([]);
  const [ refused, setRefused ] = useState<Record<string, string>>({});
  const [ targetId, setTargetId ] = useState("");
  const [ editing, setEditing ] = useState<string | null>(null);
  const msg = useActionMessage();

  const all = blocks.data ?? [];
  const active = all.filter((b) => b.active);
  const items = list.items ?? [];
  const page = items.slice(0, ASSIGN_MAX).map((h) => h.id);
  const pageSelected = page.length > 0 && page.every((id) => selected.includes(id));
  const risks = domains?.risk_classes ?? RISK_CLASSES.map((code) => ({ code, label: code }));

  function changeFilter(value: string) {
    setFilter(value); setSelected([]); setRefused({}); setEditing(null); msg.start();
  }
  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= ASSIGN_MAX ? s : [ ...s, id ]));
  }

  async function assign() {
    msg.start();
    // Na ordem da lista: o índice do path volta ao imóvel certo.
    const ids = items.map((h) => h.id).filter((id) => selected.includes(id));
    const block = active.find((b) => b.id === targetId);
    if (!block) return;
    try {
      const r = await assignHouseholdsBlock(ids, block.id);
      setSelected([]); setRefused({});
      // Uma releitura da primeira página (a lista nominal só relê por ação) e a contagem dos quarteirões.
      await Promise.all([ queryClient.resetQueries({ queryKey: key, exact: true }), queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_KEY ] }) ]);
      msg.ok(`${r.assigned} ${r.assigned === 1 ? "imóvel atribuído" : "imóveis atribuídos"} ao quarteirão ${block.number}`);
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      const m = HOUSEHOLD_PATH.exec(refusal.path);
      const id = m ? ids[Number(m[1])] : undefined;
      if (id) {
        setRefused({ [id]: refusal.text });
        msg.fail("nada foi atribuído — confira o imóvel marcado");
      } else {
        msg.fail(refusal.text);
        // Quarteirão desativado enquanto a tela estava aberta: relê os quarteirões uma vez.
        if (refusal.path === "city_block_id") { setTargetId(""); await queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_KEY ] }); }
      }
    }
  }

  function replaceRow(h: VectorHousehold) {
    queryClient.setQueryData<InfiniteData<Page<VectorHousehold>>>(key, (old) => old && {
      ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === h.id ? h : x)) }))
    });
  }

  const blockOf = (h: VectorHousehold) => {
    if (!h.block) return <span style={muted}>sem quarteirão</span>;
    return (
      <span style={row}>
        <span>{h.block.number}</span>
        {h.neighborhood_id === null
          ? <Tag tone="warn" mono={false}>{NO_NEIGHBORHOOD_TAG}</Tag>
          : h.block.neighborhood_id !== h.neighborhood_id && <Tag tone="warn" mono={false}>{OTHER_NEIGHBORHOOD_TAG}</Tag>}
      </span>
    );
  };
  const editingRow = items.find((h) => h.id === editing) ?? null;
  const assignReason = selected.length === 0 ? "selecione ao menos um imóvel" : !targetId ? "escolha o quarteirão de destino" : null;

  return (
    <div style={stack}>
      <Panel title="Imóveis">
        <div style={stack}>
          <label style={{ ...fieldLabel, maxWidth: 320 }}>
            Mostrar
            <select value={filter} style={inputStyle} onChange={(e) => changeFilter(e.target.value)}>
              <option value={WITHOUT}>Imóveis sem quarteirão</option>
              {all.map((b) => <option key={b.id} value={b.id}>{b.active ? `Quarteirão ${b.number}` : `Quarteirão ${b.number} (inativo)`}</option>)}
            </select>
          </label>
          {list.error ? <p role="alert" style={alert}>{vectorError(list.error)}</p> : (
            <PagedBody list={list}>
              {(rows) => rows.length === 0
                ? <EmptyState title={filter === WITHOUT ? "nenhum imóvel sem quarteirão neste bairro" : "nenhum imóvel neste quarteirão"} />
                : (
                  <div style={stack}>
                    <label style={checkLabel}>
                      <input type="checkbox" checked={pageSelected} onChange={() => setSelected(pageSelected ? [] : page)} />
                      Selecionar a página
                    </label>
                    {rows.length > ASSIGN_MAX && <p style={muted}>no máximo {ASSIGN_MAX} imóveis por vez</p>}
                    <DataTable label="Imóveis do bairro" rows={rows} rowKey={(h) => h.id} cols={[
                      { label: "Seleção", w: "auto", render: (h) => (
                        <input type="checkbox" aria-label={`Selecionar ${h.address_short}`} checked={selected.includes(h.id)}
                          disabled={!selected.includes(h.id) && selected.length >= ASSIGN_MAX} onChange={() => toggle(h.id)} />
                      ) },
                      { label: "Endereço", w: "2fr", card: "title", render: (h) => (
                        <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <span style={{ overflowWrap: "anywhere" }}>{h.address_short}</span>
                          {refused[h.id] && <span role="alert" style={alert}>{refused[h.id]}</span>}
                        </span>
                      ) },
                      { label: "Tipo", render: (h) => dictLabel("tipo_de_imovel", h.property_type) },
                      { label: "Microárea", render: (h) => h.micro_area.code },
                      { label: "Quarteirão", render: blockOf },
                      { label: "Risco", render: (h) => h.risk_class
                        ? <Tag tone={riskTone(h.risk_class)} mono={false}>{domainLabel(risks, h.risk_class)}</Tag> : <span style={muted}>sem classificação</span> },
                      { label: "Última visita trabalhada", render: (h) => (h.last_worked_on ? fmtDay(h.last_worked_on) : "nunca trabalhado") },
                      { label: "Ações", card: "actions", render: (h) => (
                        <button type="button" style={secondaryButtonStyle} aria-expanded={editing === h.id}
                          onClick={() => setEditing(editing === h.id ? null : h.id)}>Editar perfil</button>
                      ) }
                    ]} />
                  </div>
                )}
            </PagedBody>
          )}
          <div style={box}>
            <label style={{ ...fieldLabel, maxWidth: 240 }}>
              Quarteirão de destino
              <select value={targetId} style={inputStyle} onChange={(e) => setTargetId(e.target.value)}>
                <option value="">escolha o quarteirão</option>
                {active.map((b) => <option key={b.id} value={b.id}>{b.number}</option>)}
              </select>
            </label>
            <div><ActionButton disabledReason={assignReason} onClick={assign}>Atribuir ao quarteirão</ActionButton></div>
          </div>
          <ActionMessage message={msg.message} />
        </div>
      </Panel>
      {editingRow && (
        <ProfileEditor key={editingRow.id} household={editingRow} neighborhoodId={neighborhoodId} blocks={active} risks={risks}
          onSaved={replaceRow} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ProfileEditor({ household, neighborhoodId, blocks, risks, onSaved, onClose }: {
  household: VectorHousehold; neighborhoodId: string; blocks: CityBlock[]; risks: { code: string; label: string }[];
  onSaved(h: VectorHousehold): void; onClose(): void;
}) {
  const queryClient = useQueryClient();
  const [ blockId, setBlockId ] = useState(household.block?.id ?? "");
  const [ risk, setRisk ] = useState<string>(household.risk_class ?? "");
  const [ problem, setProblem ] = useState<string | null>(null);
  const msg = useActionMessage();
  // Quarteirão novo só do bairro do domicílio: os da tela, quando o domicílio é deste bairro; senão, manter ou tirar.
  const options = household.neighborhood_id === neighborhoodId ? blocks : [];
  const current = household.block && !options.some((b) => b.id === household.block!.id) ? household.block : null;
  const body: { city_block_id?: string | null; risk_class?: RiskClass | null } = {};
  if (blockId !== (household.block?.id ?? "")) body.city_block_id = blockId || null;
  if (risk !== (household.risk_class ?? "")) body.risk_class = (risk || null) as RiskClass | null;
  const unchanged = Object.keys(body).length === 0;

  async function save() {
    msg.start(); setProblem(null);
    try {
      const saved = await updateHouseholdProfile(household.id, body);
      onSaved(saved);
      msg.ok("perfil do imóvel salvo");
      await queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_KEY ] });
    } catch (err) {
      const refusal = vectorRefusals(err)[0];
      if (refusal.path === "city_block_id") setProblem(refusal.text);
      else msg.fail(refusal.text);
      // Quarteirão desativado (invalid_request no city_block_id) ou imóvel sumido: relê os quarteirões uma vez.
      if (isVectorStale(err) || (refusal.code === "invalid_request" && refusal.path === "city_block_id")) {
        await queryClient.invalidateQueries({ queryKey: [ VC_BLOCKS_KEY ] });
      }
    }
  }

  return (
    <Panel title={`Perfil do imóvel — ${household.address_short}`}>
      <div style={stack}>
        <div style={row}>
          <label style={fieldLabel}>
            Quarteirão do imóvel
            <select value={blockId} style={inputStyle} disabled={household.neighborhood_id === null && !household.block}
              onChange={(e) => { setBlockId(e.target.value); setProblem(null); }}>
              <option value="">sem quarteirão</option>
              {current && <option value={current.id}>{current.neighborhood_id === household.neighborhood_id ? current.number : `${current.number} (outro bairro)`}</option>}
              {options.map((b) => <option key={b.id} value={b.id}>{b.number}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Risco
            <select value={risk} style={inputStyle} onChange={(e) => setRisk(e.target.value)}>
              <option value="">sem classificação</option>
              {risks.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
            </select>
          </label>
        </div>
        {household.neighborhood_id === null && <p style={muted}>{VECTOR_ERRORS.household_without_neighborhood}</p>}
        {problem && <p role="alert" style={alert}>{problem}</p>}
        <div style={row}>
          <ActionButton disabledReason={unchanged ? "nada mudou" : null} onClick={save}>Salvar perfil</ActionButton>
          <button type="button" style={secondaryButtonStyle} onClick={onClose}>Fechar</button>
        </div>
        <ActionMessage message={msg.message} />
      </div>
    </Panel>
  );
}
