// src/modules/homeVisits/InspectionSection.tsx
// Boletim do agente de endemias dentro da nova visita (módulo 35a, F-35.2, F-35.3; contrato §3): cartões empilhados para o celular
// (375 px) — atividade, tipo de trabalho, situação, entrada e saída, depósitos por grupo, medidas, amostras, ação educativa,
// quarteirão e risco. O rascunho guarda texto (`InspectionDraft`); o formulário converte, confere e envia. A poda
// (`pruneInspection`) só roda na troca da situação ou do método (quem chama, com `prune`), nunca a cada tecla. A etiqueta das
// amostras é PROVISÓRIA (nasce do `client_uuid`, que troca depois de qualquer 4xx); a definitiva é a da visita gravada.
// Nenhum dado de pessoa: o imóvel só pelo tipo e pelo perfil vetorial.
import { useId, useState, type ReactNode } from "react";
import type { CityBlock, DepositGroup, HomeVisit, HouseholdVectorProfile, MeasureMethod, VectorControlDomains } from "../../lib/api";
import { domainLabel, riskTone } from "../../lib/vectorControl";
import { VECTOR_ERRORS } from "../../lib/vectorErrors";
import { IE_PROPERTIES, PE_PROPERTY, measureQuantity, sampleLabel, type InspectionDraft } from "../../lib/vectorInspection";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { Tag } from "../../components/Tag";
import { alert, checkLabel, fieldLabel, fieldset, legend, muted, row } from "../exams/styles";

export const BULLETIN_NEEDS_HOUSEHOLD =
  "o boletim exige um domicílio do cadastro territorial — cadastre o imóvel não residencial em Território da equipe";
export const PROVISIONAL_LABEL = "(provisória até gravar)";
export const BLOCK_FROM_PROFILE = "o imóvel já tem quarteirão no perfil — só a coordenação de endemias troca";
const SAMPLE_NEEDS_LARVAE = "amostra só de grupo com larva";
const ROOT = "vector_inspection";
const COUNTERS = [
  [ "existing", "Existentes" ], [ "with_water", "Com água" ], [ "with_larvae", "Com larva" ], [ "eliminated", "Eliminados" ], [ "treated", "Tratados" ]
] as const;

type Aria = { "aria-invalid"?: true; "aria-describedby"?: string };
// `prune`: a troca é de situação ou de método (o formulário poda e diz o quê); `cleared`: o que a própria seção tirou.
export type InspectionChange = { clear?: string[]; prune?: boolean; cleared?: string[] };

// Depois do 201: as etiquetas DEFINITIVAS, as da visita gravada (D-12), nunca as da prévia.
export function tubeLabelsText(v: HomeVisit): string | null {
  const samples = v.vector_inspection?.samples ?? [];
  return samples.length > 0 ? `Etiquete os tubitos: ${samples.map((s) => s.label).join(", ")}` : null;
}

const decimal = (s: string) => s.replace(".", ",");
// Texto → número como o rascunho (vírgula aceita); outra coisa → null.
const parse = (s: string): number | null => (/^\d+([.,]\d+)?$/.test(s.trim()) ? Number(s.trim().replace(",", ".")) : null);

// Atividades oferecidas: LIRAa e bloqueio só com o vínculo do atalho; PE só em ponto estratégico, IE só em imóvel especial.
// A atividade já escolhida fica na lista (o tipo do imóvel pode chegar depois; a regra recusa se não valer).
export function offeredActivities(domains: VectorControlDomains, draft: InspectionDraft, propertyType: string) {
  return domains.activities.filter((a) => {
    if (a.code === draft.activity) return true;
    if (a.code === "liraa") return draft.liraaDrawItemId !== null;
    if (a.code === "transmission_block") return draft.transmissionBlockId !== null;
    if (a.code === "pe") return propertyType === PE_PROPERTY;
    if (a.code === "ie") return (IE_PROPERTIES as readonly string[]).includes(propertyType);
    return true;
  });
}

// Os `path` que a seção mostra no campo; o resto (índice que não existe mais) vai à frase geral do formulário.
export function inspectionPaths(draft: InspectionDraft): Set<string> {
  const out = [ ROOT, ...[ "activity", "work_type", "situation", "educational_action", "entered_at", "left_at", "liraa_draw_item_id",
    "transmission_block_id", "city_block_id", "risk_class", "deposits", "measures", "samples" ].map((k) => `${ROOT}.${k}`) ];
  draft.deposits.forEach((_, i) => {
    const p = `${ROOT}.deposits[${i}]`;
    out.push(p, `${p}.group`, ...COUNTERS.map(([ k ]) => `${p}.${k}`));
  });
  draft.measures.forEach((_, i) => { const p = `${ROOT}.measures[${i}]`; out.push(p, `${p}.method`, `${p}.vector_product_id`, `${p}.charges`); });
  draft.samples.forEach((_, i) => { const p = `${ROOT}.samples[${i}]`; out.push(p, `${p}.number`, `${p}.deposit_group`, `${p}.larvae_collected`); });
  return new Set(out);
}

export function InspectionSection({ draft, onChange, domains, household, profile, blocks, uuid, disabled, cleared, aria, errNode }: {
  draft: InspectionDraft; onChange(next: InspectionDraft, o?: InspectionChange): void; domains: VectorControlDomains;
  household: { property_type: string };
  // O perfil vetorial do imóvel e os quarteirões do bairro (só lidos quando o perfil não tem quarteirão).
  profile: { data: HouseholdVectorProfile | undefined; error: string | null };
  blocks: { data: CityBlock[] | undefined; error: string | null } | null;
  uuid: string; disabled: boolean; cleared: string | null; aria(path: string): Aria; errNode(path: string): ReactNode;
}) {
  const uid = useId();
  const [ groupToAdd, setGroupToAdd ] = useState("");
  const [ methodToAdd, setMethodToAdd ] = useState("");
  const [ sampleGroup, setSampleGroup ] = useState("");
  const p = (k: string) => `${ROOT}.${k}`;
  const set = (patch: Partial<InspectionDraft>, ...clear: string[]) => onChange({ ...draft, ...patch }, { clear });
  const worked = draft.situation === null || draft.situation === "worked";
  const activities = offeredActivities(domains, draft, household.property_type);
  const usedGroups = new Set(draft.deposits.map((d) => d.group));
  const freeGroups = domains.deposit_groups.filter((g) => !usedGroups.has(g.code));
  const larvaeGroups = draft.deposits.filter((d) => (parse(d.with_larvae) ?? 0) > 0).map((d) => d.group);
  const vector = profile.data?.vector ?? null;

  function setDeposit(i: number, key: (typeof COUNTERS)[number][0], v: string) {
    set({ deposits: draft.deposits.map((d, j) => (j === i ? { ...d, [key]: v } : d)) }, p(`deposits[${i}].${key}`), p(`deposits[${i}]`), p("samples"));
  }
  function setMeasure(i: number, patch: Partial<InspectionDraft["measures"][number]>, ...clear: string[]) {
    set({ measures: draft.measures.map((m, j) => (j === i ? { ...m, ...patch } : m)) }, p(`measures[${i}]`), ...clear);
  }
  // Trocar o método passa pela poda (a mecânica perde produto e cargas); o produto que não serve ao método novo sai, e se diz.
  function setMethod(i: number, method: MeasureMethod) {
    const m = draft.measures[i];
    const product = domains.products.find((x) => x.id === m.productId);
    const fits = method === "mechanical" || !product || (product.uses as string[]).includes(method);
    const next = { ...draft, measures: draft.measures.map((x, j) => (j === i ? { ...x, method, ...(fits ? {} : { productId: null }) } : x)) };
    onChange(next, { prune: true, cleared: fits ? [] : [ `produto da medida ${i + 1}` ],
      clear: [ p(`measures[${i}]`), p(`measures[${i}].method`), p(`measures[${i}].vector_product_id`), p(`measures[${i}].charges`) ] });
  }

  return (
    <section aria-label="Boletim do agente de endemias" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>Boletim do agente de endemias</p>
      {errNode(ROOT)}
      {cleared && <p role="status" style={muted}>{cleared}</p>}

      <fieldset style={fieldset}>
        <legend style={legend}>Atividade e trabalho</legend>
        <label style={fieldLabel}>
          Atividade
          <select value={draft.activity ?? ""} disabled={disabled} style={inputStyle} {...aria(p("activity"))}
            onChange={(e) => set({ activity: (e.target.value || null) as InspectionDraft["activity"] }, p("activity"), p("liraa_draw_item_id"), p("transmission_block_id"))}>
            <option value="">— escolha —</option>
            {activities.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
          </select>
        </label>
        {errNode(p("activity"))}
        {errNode(p("liraa_draw_item_id"))}
        {errNode(p("transmission_block_id"))}
        <div role="radiogroup" aria-label="Tipo de trabalho" style={row}>
          {domains.work_types.map((w) => (
            <label key={w.code} style={checkLabel}>
              <input type="radio" name={`${uid}-work`} checked={draft.workType === w.code} disabled={disabled}
                onChange={() => set({ workType: w.code }, p("work_type"))} />
              {w.label}
            </label>
          ))}
        </div>
        {errNode(p("work_type"))}
      </fieldset>

      <fieldset style={fieldset} {...aria(p("situation"))}>
        <legend style={legend}>Situação do imóvel</legend>
        <div style={row}>
          {domains.situations.map((o) => (
            <label key={o.code} style={checkLabel}>
              <input type="radio" name={`${uid}-situation`} checked={draft.situation === o.code} disabled={disabled}
                onChange={() => onChange({ ...draft, situation: o.code }, { prune: true, clear: [ p("situation"), p("deposits"), p("measures"), p("samples"), p("educational_action") ] })} />
              {o.label}
            </label>
          ))}
        </div>
        {errNode(p("situation"))}
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>Entrada e saída</legend>
        <div style={row}>
          <label style={{ ...fieldLabel, flex: "1 1 110px" }}>
            Entrada
            <input type="time" value={draft.enteredAt} disabled={disabled} style={inputStyle} {...aria(p("entered_at"))}
              onChange={(e) => set({ enteredAt: e.target.value }, p("entered_at"), p("left_at"))} />
          </label>
          <label style={{ ...fieldLabel, flex: "1 1 110px" }}>
            Saída
            <input type="time" value={draft.leftAt} disabled={disabled} style={inputStyle} {...aria(p("left_at"))}
              onChange={(e) => set({ leftAt: e.target.value }, p("entered_at"), p("left_at"))} />
          </label>
        </div>
        <span style={muted}>Opcionais: preencha os dois ou nenhum.</span>
        {errNode(p("entered_at"))}
        {errNode(p("left_at"))}
      </fieldset>

      {worked && (
        <fieldset style={fieldset} {...aria(p("deposits"))}>
          <legend style={legend}>Depósitos</legend>
          {errNode(p("deposits"))}
          {draft.deposits.map((d, i) => {
            const dp = `${ROOT}.deposits[${i}]`;
            return (
              <fieldset key={d.group} style={{ ...fieldset, padding: 8 }} {...aria(dp)}>
                <legend style={{ ...legend, fontWeight: 500 }}>{domainLabel(domains.deposit_groups, d.group)}</legend>
                {errNode(dp)}
                {errNode(`${dp}.group`)}
                <div style={row}>
                  {COUNTERS.map(([ key, label ]) => (
                    <label key={key} style={{ ...fieldLabel, flex: "1 1 90px" }}>
                      {label}
                      <input type="text" inputMode="numeric" value={d[key]} disabled={disabled} style={inputStyle} {...aria(`${dp}.${key}`)}
                        onChange={(e) => setDeposit(i, key, e.target.value)} />
                    </label>
                  ))}
                </div>
                {COUNTERS.map(([ key ]) => <div key={key}>{errNode(`${dp}.${key}`)}</div>)}
                <div>
                  <button type="button" disabled={disabled} style={secondaryButtonStyle}
                    onClick={() => set({ deposits: draft.deposits.filter((_, j) => j !== i) }, p("deposits"))}>Retirar grupo</button>
                </div>
              </fieldset>
            );
          })}
          {freeGroups.length > 0 && (
            <div style={{ ...row, alignItems: "flex-end" }}>
              <label style={{ ...fieldLabel, flex: "1 1 200px" }}>
                Grupo do depósito
                <select value={groupToAdd} disabled={disabled} style={inputStyle} onChange={(e) => setGroupToAdd(e.target.value)}>
                  <option value="">— escolha —</option>
                  {freeGroups.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}
                </select>
              </label>
              <button type="button" disabled={disabled || groupToAdd === ""} style={secondaryButtonStyle}
                onClick={() => {
                  setGroupToAdd("");
                  set({ deposits: [ ...draft.deposits, { group: groupToAdd as DepositGroup, existing: "0", with_water: "0", with_larvae: "0", eliminated: "0", treated: "0" } ] }, p("deposits"));
                }}>Adicionar grupo</button>
            </div>
          )}
        </fieldset>
      )}

      {worked && (
        <fieldset style={fieldset} {...aria(p("measures"))}>
          <legend style={legend}>Medidas de controle</legend>
          {errNode(p("measures"))}
          {draft.measures.map((m, i) => {
            const mp = `${ROOT}.measures[${i}]`;
            const products = domains.products.filter((x) => (x.uses as string[]).includes(m.method) || x.id === m.productId);
            const product = domains.products.find((x) => x.id === m.productId);
            const charges = parse(m.charges);
            return (
              <fieldset key={i} style={{ ...fieldset, padding: 8 }} {...aria(mp)}>
                <legend style={{ ...legend, fontWeight: 500 }}>{`Medida ${i + 1}`}</legend>
                {errNode(mp)}
                <label style={fieldLabel}>
                  Método
                  <select value={m.method} disabled={disabled} style={inputStyle} {...aria(`${mp}.method`)}
                    onChange={(e) => setMethod(i, e.target.value as MeasureMethod)}>
                    {domains.measure_methods.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
                  </select>
                </label>
                {errNode(`${mp}.method`)}
                {m.method !== "mechanical" && (
                  <>
                    <label style={fieldLabel}>
                      Produto
                      <select value={m.productId ?? ""} disabled={disabled} style={inputStyle} {...aria(`${mp}.vector_product_id`)}
                        onChange={(e) => setMeasure(i, { productId: e.target.value || null }, `${mp}.vector_product_id`)}>
                        <option value="">— escolha —</option>
                        {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                      </select>
                    </label>
                    {errNode(`${mp}.vector_product_id`)}
                    <div style={{ ...row, alignItems: "flex-end" }}>
                      <label style={{ ...fieldLabel, flex: "1 1 110px" }}>
                        Cargas
                        <input type="text" inputMode="decimal" value={m.charges} disabled={disabled} style={inputStyle} {...aria(`${mp}.charges`)}
                          onChange={(e) => setMeasure(i, { charges: e.target.value }, `${mp}.charges`)} />
                      </label>
                      {product && charges !== null && charges > 0 && (
                        <span style={muted}>{`= ${decimal(measureQuantity(charges, product.charge_size))} ${product.unit}`}</span>
                      )}
                    </div>
                    {errNode(`${mp}.charges`)}
                  </>
                )}
                <div>
                  <button type="button" disabled={disabled} style={secondaryButtonStyle}
                    onClick={() => set({ measures: draft.measures.filter((_, j) => j !== i) }, p("measures"))}>Retirar medida</button>
                </div>
              </fieldset>
            );
          })}
          <div style={{ ...row, alignItems: "flex-end" }}>
            <label style={{ ...fieldLabel, flex: "1 1 200px" }}>
              Método da medida
              <select value={methodToAdd} disabled={disabled} style={inputStyle} onChange={(e) => setMethodToAdd(e.target.value)}>
                <option value="">— escolha —</option>
                {domains.measure_methods.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
              </select>
            </label>
            <button type="button" disabled={disabled || methodToAdd === "" || draft.measures.length >= domains.limits.measures_max} style={secondaryButtonStyle}
              onClick={() => {
                setMethodToAdd("");
                set({ measures: [ ...draft.measures, { method: methodToAdd as MeasureMethod, productId: null, charges: "" } ] }, p("measures"));
              }}>Adicionar medida</button>
          </div>
        </fieldset>
      )}

      {worked && (
        <fieldset style={fieldset} {...aria(p("samples"))}>
          <legend style={legend}>Amostras</legend>
          {errNode(p("samples"))}
          {draft.samples.map((smp, i) => {
            const sp = `${ROOT}.samples[${i}]`;
            return (
              <fieldset key={i} style={{ ...fieldset, padding: 8 }} {...aria(sp)}>
                <legend style={{ ...legend, fontWeight: 500 }}>{`Amostra ${i + 1}`}</legend>
                <span style={muted}>{`grupo ${smp.group}`}</span>
                <label style={fieldLabel}>
                  Larvas coletadas
                  <input type="text" inputMode="numeric" value={smp.larvae} disabled={disabled} style={inputStyle} {...aria(`${sp}.larvae_collected`)}
                    onChange={(e) => set({ samples: draft.samples.map((x, j) => (j === i ? { ...x, larvae: e.target.value } : x)) }, sp, `${sp}.larvae_collected`)} />
                </label>
                <span className="mono" style={{ fontSize: 12.5 }}>{`${sampleLabel(uuid, i + 1)} ${PROVISIONAL_LABEL}`}</span>
                {errNode(sp)}
                {errNode(`${sp}.number`)}
                {errNode(`${sp}.deposit_group`)}
                {errNode(`${sp}.larvae_collected`)}
                <div>
                  <button type="button" disabled={disabled} style={secondaryButtonStyle}
                    onClick={() => set({ samples: draft.samples.filter((_, j) => j !== i) }, p("samples"))}>Retirar amostra</button>
                </div>
              </fieldset>
            );
          })}
          {larvaeGroups.length === 0 ? <span style={muted}>{SAMPLE_NEEDS_LARVAE}</span> : (
            <div style={{ ...row, alignItems: "flex-end" }}>
              <label style={{ ...fieldLabel, flex: "1 1 160px" }}>
                Grupo da amostra
                <select value={sampleGroup} disabled={disabled} style={inputStyle} onChange={(e) => setSampleGroup(e.target.value)}>
                  <option value="">— escolha —</option>
                  {larvaeGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <button type="button" disabled={disabled || sampleGroup === "" || draft.samples.length >= domains.limits.samples_max} style={secondaryButtonStyle}
                onClick={() => {
                  setSampleGroup("");
                  set({ samples: [ ...draft.samples, { group: sampleGroup as DepositGroup, larvae: "" } ] }, p("samples"));
                }}>Adicionar amostra</button>
            </div>
          )}
        </fieldset>
      )}

      {worked && (
        <div>
          <label style={checkLabel}>
            <input type="checkbox" checked={draft.educationalAction} disabled={disabled} {...aria(p("educational_action"))}
              onChange={(e) => set({ educationalAction: e.target.checked }, p("educational_action"))} />
            Ação educativa
          </label>
          {errNode(p("educational_action"))}
        </div>
      )}

      <fieldset style={fieldset}>
        <legend style={legend}>Quarteirão do imóvel</legend>
        {profile.error ? <p role="alert" style={alert}>{profile.error}</p>
          : !profile.data ? <p role="status" style={muted}>Carregando o perfil do imóvel…</p>
          : vector?.city_block_id ? <p style={muted}>{BLOCK_FROM_PROFILE}</p>
          : profile.data.neighborhood_id === null ? <p style={muted}>{VECTOR_ERRORS.household_without_neighborhood}</p>
          : blocks?.error ? <p role="alert" style={alert}>{blocks.error}</p>
          : !blocks?.data ? <p role="status" style={muted}>Carregando os quarteirões…</p>
          : (
            <label style={fieldLabel}>
              Quarteirão
              <select value={draft.cityBlockId ?? ""} disabled={disabled} style={inputStyle} {...aria(p("city_block_id"))}
                onChange={(e) => set({ cityBlockId: e.target.value || null }, p("city_block_id"))}>
                <option value="">— sem quarteirão —</option>
                {blocks.data.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.number}</option>)}
              </select>
            </label>
          )}
        {errNode(p("city_block_id"))}
      </fieldset>

      <fieldset style={fieldset}>
        <legend style={legend}>Risco do imóvel</legend>
        {vector?.risk_class && <span style={muted}>{`atual: ${domainLabel(domains.risk_classes, vector.risk_class)}`}</span>}
        <label style={checkLabel}>
          <input type="radio" name={`${uid}-risk`} checked={draft.riskClass === null} disabled={disabled} onChange={() => set({ riskClass: null }, p("risk_class"))} />
          Sem reclassificar
        </label>
        {domains.risk_classes.map((r) => (
          <label key={r.code} style={checkLabel}>
            <input type="radio" name={`${uid}-risk`} checked={draft.riskClass === r.code} disabled={disabled} onChange={() => set({ riskClass: r.code }, p("risk_class"))} />
            <Tag tone={riskTone(r.code)} mono={false}>{r.label}</Tag>
          </label>
        ))}
        {errNode(p("risk_class"))}
      </fieldset>
    </section>
  );
}
