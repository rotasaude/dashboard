// src/modules/vectorControl/ProductsPanel.tsx
// Produtos de campo (inseticidas e larvicidas) da coordenação de endemias (módulo 35a, F-35.3; contrato §4; Q15). Lista `{ items }`
// com ativos e inativos, por código; novo e editar com os limites do VectorControl::SaveProduct (código 1–10 e nome 1–80 depois do
// strip, unidade g/ml/un, carga em TEXTO até 8 inteiros e 2 casas e > 0, usos não vazios entre focal/perifocal/spatial). A edição manda
// só o que mudou (PATCH). Produto em uso (lote ou medida) trava unidade e carga; o 409 product_in_use da corrida diz a frase e relê UMA
// vez. Depois de gravar, relê também os domínios (o boletim tira de lá os produtos ativos). Sem dado de pessoa.
import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createVectorProduct, getVectorDomains, listVectorProducts, updateVectorProduct, type VectorProduct, type VectorProductInput } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import {
  STATIC_QUERY, VC_DOMAINS_KEY, VC_PRODUCTS_KEY, VECTOR_USES, ZOONOSES_USES, domainLabel, isVectorStale, vectorError, vectorProductUses, vectorRefusals
} from "../../lib/vectorControl";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import { useActionMessage } from "../../lib/useActionMessage";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { Tag } from "../../components/Tag";
import { EmptyState } from "../../components/EmptyState";
import { ActionButton } from "../../components/ActionButton";
import { ActionMessage } from "../../components/ActionMessage";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, fieldset, legend, muted, row, stack } from "../exams/styles";

type Use = VectorProductInput["uses"][number];
const USES: Use[] = [ ...VECTOR_USES, ...ZOONOSES_USES ];
// Módulo 35b (Q11): a vacina e a coleira são uma finalidade só, em "un" e carga 1,00, e nunca se misturam com os usos vetoriais.
const isZooUse = (u: string) => (ZOONOSES_USES as readonly string[]).includes(u);
const ZOO_LABEL: Record<string, string> = { rabies_vaccine: "vacina antirrábica animal", collar: "coleira" };
const ZOO_UNIT = "un";
const ZOO_CHARGE = "1,00";
const UNITS: { code: VectorProductInput["unit"]; label: string }[] = [
  { code: "g", label: "g (gramas)" }, { code: "ml", label: "ml (mililitros)" }, { code: "un", label: "un (unidades)" }
];

export type ProductDraft = { code: string; name: string; unit: string; charge: string; uses: string[] };
export type ProductProblem = { path: "code" | "name" | "unit" | "charge_size" | "uses"; text: string };

const TEXT = {
  code: "código: de 1 a 10 caracteres, sem repetir o de outro produto (maiúsculas e minúsculas contam igual)",
  name: "nome: de 1 a 80 caracteres",
  unit: "escolha a unidade: g, ml ou un",
  charge_size: "tamanho da carga: maior que zero, até 8 dígitos inteiros e 2 casas (use vírgula)",
  uses: "marque ao menos um uso",
  mixed: "vacina antirrábica e coleira são finalidades à parte: marque uma só, sem os usos de controle vetorial",
  zoo_unit: "vacina e coleira são em unidades (un)",
  zoo_charge: "vacina e coleira têm carga 1,00"
} as const;
// Catalog::PRODUCT_CODE / PRODUCT_NAME contam caracteres (code points) depois do strip; SaveProduct::CHARGE_SIZE com vírgula ou ponto.
const length = (s: string) => [ ...s.trim() ].length;
const CHARGE = /^\d{1,8}([.,]\d{1,2})?$/;
export const chargeText = (raw: string): string => raw.trim().replace(",", ".");
const chargeOk = (raw: string) => CHARGE.test(raw.trim()) && Number(chargeText(raw)) > 0;
const fmtCharge = (charge: string) => charge.replace(".", ",");

// Os problemas na ordem do formulário. `others`: os códigos dos outros produtos (o próprio, na edição, fica fora).
export function productProblems(d: ProductDraft, others: string[]): ProductProblem[] {
  const out: ProductProblem[] = [];
  const code = d.code.trim().toLowerCase();
  if (length(d.code) < 1 || length(d.code) > 10 || others.some((o) => o.toLowerCase() === code)) out.push({ path: "code", text: TEXT.code });
  if (length(d.name) < 1 || length(d.name) > 80) out.push({ path: "name", text: TEXT.name });
  const zoo = d.uses.some(isZooUse);
  if (!UNITS.some((u) => u.code === d.unit)) out.push({ path: "unit", text: TEXT.unit });
  else if (zoo && d.unit !== ZOO_UNIT) out.push({ path: "unit", text: TEXT.zoo_unit });
  if (!chargeOk(d.charge)) out.push({ path: "charge_size", text: TEXT.charge_size });
  else if (zoo && Number(chargeText(d.charge)) !== 1) out.push({ path: "charge_size", text: TEXT.zoo_charge });
  if (d.uses.length === 0 || !d.uses.every((u) => (USES as string[]).includes(u))) out.push({ path: "uses", text: TEXT.uses });
  else if (zoo && (d.uses.length > 1)) out.push({ path: "uses", text: TEXT.mixed });
  return out;
}
export const NOTHING_CHANGED = "nada mudou neste produto";
const FIELD_PATHS: string[] = [ "code", "name", "unit", "charge_size", "uses" ];

const cell = { display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-start" } as const;

type Editing = { kind: "new" } | { kind: "edit"; product: VectorProduct };

export function ProductsPanel() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const offered = vectorProductUses(user);
  const products = useQuery({ queryKey: [ VC_PRODUCTS_KEY ], queryFn: listVectorProducts, ...STATIC_QUERY });
  // Só os rótulos dos usos; sem os domínios (falha), o código aparece cru.
  const domains = useQuery({ queryKey: [ VC_DOMAINS_KEY ], queryFn: getVectorDomains, ...STATIC_QUERY });
  const [ editing, setEditing ] = useState<Editing | null>(null);
  const msg = useActionMessage();
  const methods = domains.data?.measure_methods ?? [];
  const useLabel = (u: string) => ZOO_LABEL[u] ?? domainLabel(methods, u);

  const list = products.data ?? [];
  return (
    <Panel title="Produtos de campo" sub="inseticidas e larvicidas do boletim">
      <div style={stack}>
        {products.isError ? <p role="alert" style={alert}>{vectorError(products.error)}</p>
          : !products.data ? <p role="status" style={muted}>Carregando…</p>
          : list.length === 0 ? <EmptyState title="nenhum produto cadastrado" />
          : (
            <DataTable label="Produtos de campo" rows={list} rowKey={(p) => p.id} cols={[
              { label: "Código", card: "title", render: (p) => <strong>{p.code}</strong> },
              { label: "Nome", w: "2fr", render: (p) => p.name },
              { label: "Unidade", render: (p) => p.unit },
              { label: "Carga", align: "right", render: (p) => fmtCharge(p.charge_size) },
              { label: "Usos", w: "2fr", render: (p) => p.uses.map(useLabel).join(", ") },
              { label: "Ativo", render: (p) => (
                <span style={row}>
                  <Tag tone={p.active ? "ok" : "neutral"} mono={false}>{p.active ? "ativo" : "inativo"}</Tag>
                  {p.in_use && <Tag tone="neutral" mono={false}>em uso</Tag>}
                </span>
              ) },
              { label: "Ações", card: "actions", render: (p) => (
                <button type="button" style={secondaryButtonStyle} aria-label={`Editar ${p.code}`}
                  onClick={() => { msg.start(); setEditing({ kind: "edit", product: p }); }}>Editar</button>
              ) }
            ]} />
          )}
        <ActionMessage message={msg.message} />
        {editing ? (
          <ProductForm key={editing.kind === "edit" ? editing.product.id : "new"} editing={editing} products={list} useLabel={useLabel} offered={offered}
            onCancel={() => setEditing(null)}
            onSaved={async (p) => {
              setEditing(null);
              msg.ok(`produto ${p.code} salvo`);
              await Promise.all([ queryClient.invalidateQueries({ queryKey: [ VC_PRODUCTS_KEY ] }), queryClient.invalidateQueries({ queryKey: [ VC_DOMAINS_KEY ] }) ]);
            }}
            onStale={async (err) => {
              // Produto que entrou em uso ou sumiu entre a leitura e o envio: a frase e uma releitura; nada é reenviado.
              setEditing(null);
              msg.fail(vectorError(err));
              await queryClient.invalidateQueries({ queryKey: [ VC_PRODUCTS_KEY ] });
            }} />
        ) : (
          <div><button type="button" style={secondaryButtonStyle} onClick={() => { msg.start(); setEditing({ kind: "new" }); }}>Novo produto</button></div>
        )}
      </div>
    </Panel>
  );
}

function ProductForm({ editing, products, useLabel, offered, onCancel, onSaved, onStale }: {
  editing: Editing; products: VectorProduct[]; useLabel(u: string): string; offered: Use[];
  onCancel(): void; onSaved(p: VectorProduct): Promise<void>; onStale(err: unknown): Promise<void>;
}) {
  const product = editing.kind === "edit" ? editing.product : null;
  const locked = !!product?.in_use;
  const [ d, setD ] = useState<ProductDraft>(() => product
    ? { code: product.code, name: product.name, unit: product.unit, charge: fmtCharge(product.charge_size), uses: [ ...product.uses ] }
    : { code: "", name: "", unit: "", charge: "", uses: [] });
  const [ active, setActive ] = useState(product ? product.active : true);
  const [ problems, setProblems ] = useState<ProductProblem[]>([]);
  const msg = useActionMessage();
  const uid = useId();
  const errId = (path: string) => `${uid}-${path}`;
  const problem = (path: string) => problems.find((p) => p.path === path)?.text ?? null;
  const aria = (path: string) => (problem(path) ? { "aria-invalid": true as const, "aria-describedby": errId(path) } : {});
  const err = (path: string) => (problem(path) ? <span id={errId(path)} role="alert" style={alert}>{problem(path)}</span> : null);
  const set = (patch: Partial<ProductDraft>) => {
    setD((prev) => ({ ...prev, ...patch }));
    setProblems((list) => list.filter((p) => !(Object.keys(patch) as string[]).some((k) => (k === "charge" ? "charge_size" : k) === p.path)));
  };
  const toggleUse = (u: Use) => {
    if (d.uses.includes(u)) { set(isZooUse(u) && !product ? { uses: [], unit: "", charge: "" } : { uses: d.uses.filter((x) => x !== u) }); return; }
    set(isZooUse(u) ? { uses: [ u ], unit: ZOO_UNIT, charge: ZOO_CHARGE } : { uses: USES.filter((x) => x === u || d.uses.includes(x)) });
  };
  // Q11: a família do produto nunca muda (vetor ↔ zoonoses). Uso fora do portão aparece marcado e desabilitado, nunca some.
  const zooProduct = !!product && product.uses.some(isZooUse);
  const zooPicked = d.uses.some(isZooUse);
  const vectorPicked = d.uses.some((u) => !isZooUse(u));
  const useDisabled = (u: Use): boolean => {
    if (!offered.includes(u)) return true;
    if (product) return zooProduct || isZooUse(u);
    return isZooUse(u) ? vectorPicked || (zooPicked && !d.uses.includes(u)) : zooPicked;
  };
  const shownUses = [ ...USES.filter((u) => offered.includes(u)), ...(product?.uses ?? []).filter((u) => !offered.includes(u)) ];
  const fixedZoo = zooPicked;

  // O corpo: tudo no novo; só o que mudou na edição (unidade e carga nunca, com o produto em uso).
  function body(): Partial<VectorProductInput> {
    const full: VectorProductInput = {
      code: d.code.trim(), name: d.name.trim(), unit: d.unit as VectorProductInput["unit"], charge_size: chargeText(d.charge), uses: d.uses as Use[], active
    };
    if (!product) return full;
    const out: Partial<VectorProductInput> = {};
    if (full.code !== product.code) out.code = full.code;
    if (full.name !== product.name) out.name = full.name;
    if (!locked && full.unit !== product.unit) out.unit = full.unit;
    if (!locked && Number(full.charge_size) !== Number(product.charge_size)) out.charge_size = full.charge_size;
    if (full.uses.length !== product.uses.length || full.uses.some((u) => !product.uses.includes(u))) out.uses = full.uses;
    if (active !== product.active) out.active = active;
    return out;
  }

  async function save() {
    msg.start();
    const found = productProblems(d, products.filter((p) => p.id !== product?.id).map((p) => p.code));
    setProblems(found);
    if (found.length > 0) return;
    const sent = body();
    if (product && Object.keys(sent).length === 0) { msg.fail(NOTHING_CHANGED); return; }
    try {
      const saved = product ? await updateVectorProduct(product.id, sent) : await createVectorProduct(sent as VectorProductInput);
      await onSaved(saved);
    } catch (e) {
      if (isVectorStale(e)) { await onStale(e); return; }
      const refusals = vectorRefusals(e);
      const mine = refusals.filter((r) => FIELD_PATHS.includes(r.path));
      if (mine.length > 0) setProblems(mine.map((r) => ({ path: r.path as ProductProblem["path"], text: TEXT[r.path as ProductProblem["path"]] })));
      else msg.fail(refusals[0].text);
    }
  }

  return (
    <div style={box}>
      <strong>{product ? `Editar ${product.code}` : "Novo produto"}</strong>
      <div style={row}>
        <div style={cell}>
          <label style={fieldLabel}>
            Código
            <input value={d.code} style={inputStyle} onChange={(e) => set({ code: e.target.value })} {...aria("code")} />
          </label>
          {err("code")}
        </div>
        <div style={{ ...cell, flex: 1, minWidth: 220 }}>
          <label style={fieldLabel}>
            Nome
            <input value={d.name} style={inputStyle} onChange={(e) => set({ name: e.target.value })} {...aria("name")} />
          </label>
          {err("name")}
        </div>
      </div>
      <div style={row}>
        <div style={cell}>
          <label style={fieldLabel}>
            Unidade
            <select value={d.unit} style={inputStyle} disabled={locked || fixedZoo} onChange={(e) => set({ unit: e.target.value })} {...aria("unit")}>
              <option value="">escolha</option>
              {UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
            </select>
          </label>
          {err("unit")}
        </div>
        <div style={cell}>
          <label style={fieldLabel}>
            Tamanho da carga
            <input value={d.charge} inputMode="decimal" style={inputStyle} disabled={locked || fixedZoo} onChange={(e) => set({ charge: e.target.value })} {...aria("charge_size")} />
          </label>
          {err("charge_size")}
        </div>
      </div>
      {locked && <p style={muted}>{VECTOR_ERRORS.product_in_use}</p>}
      <fieldset style={fieldset} {...aria("uses")}>
        <legend style={legend}>Usos</legend>
        <div style={row}>
          {shownUses.map((u) => (
            <label key={u} style={checkLabel}>
              <input type="checkbox" checked={d.uses.includes(u)} disabled={useDisabled(u)} onChange={() => toggleUse(u)} />
              {useLabel(u)}
            </label>
          ))}
        </div>
        {err("uses")}
      </fieldset>
      <label style={checkLabel}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Ativo
      </label>
      <div style={row}>
        <ActionButton onClick={save}>Salvar produto</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
      <ActionMessage message={msg.message} />
    </div>
  );
}
