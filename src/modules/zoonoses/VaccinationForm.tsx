// src/modules/zoonoses/VaccinationForm.tsx
// Registrar dose antirrábica (módulo 35b, F-35.12; api-shapes §2.4). Posto fixo e casa a casa levam a campanha aberta; a rotina vale
// sempre e nunca leva a chave `campaign_id` (o api recusa até o null). Posto fixo aceita animal cadastrado ou só a espécie (sem
// nome nem tutor, Q4; o animal escolhido vem do resultado da busca, sem leitura nominal); rotina e casa a casa exigem o animal; casa a casa só com a visita domiciliar e animal com domicílio, e sem
// `household_id` nem unidade no corpo. A segunda dose na campanha só o api barra (422 already_vaccinated_in_campaign): a frase fica
// no animal e o formulário também. Falta de saldo não recusa: o pai mostra a frase da conciliação.
import { useState } from "react";
import { recordVaccination, type Animal, type HealthUnit, type RabiesCampaign, type RabiesVaccination, type VaccinationInput } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { canUseHomeVisits } from "../../lib/homeVisits";
import { isZoonosesStale, vaccinationProblems, zooLabel, zoonosesRefusals } from "../../lib/zoonoses";
import { ActionButton } from "../../components/ActionButton";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";
import { box, checkLabel, fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { AnimalSearch } from "./AnimalSearch";
import { useZooDomains } from "./useZooDomains";

export const EATAV_REMINDER = "Notifique o evento adverso no formulário do Ministério da Saúde (EATAV).";
export const STOCK_SHORTFALL_NOTE = "dose registrada; faltou saldo no local — a coordenação concilia em Faltas de insumo de campo";
type Modality = "house" | "fixed_post" | "routine";
const OWN = [ "modality", "species", "animal_id", "health_unit_id", "vector_product_id", "vaccinated_on", "adverse_note" ];

export function VaccinationForm({ campaign, today, units, onRecorded, onStale }: {
  campaign: RabiesCampaign | null; today: string; units: HealthUnit[]; onRecorded(v: RabiesVaccination): void; onStale(text: string): void;
}) {
  const { user } = useAuth();
  const domains = useZooDomains().data;
  const fieldUsable = canUseHomeVisits(user);
  const f = useFormProblems({
    refusals: (err) => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isZoonosesStale(err)
  });
  const [ chosen, setChosen ] = useState<Modality | null>(null);
  const [ picked, setPicked ] = useState<Animal | null>(null);
  const animalId = picked?.id ?? null;
  const [ search, setSearch ] = useState(false);
  const [ species, setSpecies ] = useState("");
  const [ unit, setUnit ] = useState("");
  const [ on, setOn ] = useState(today);
  const [ product, setProduct ] = useState("");
  const [ adverse, setAdverse ] = useState(false);
  const [ note, setNote ] = useState("");

  // Sem campanha aberta só a rotina vale; casa a casa só com a visita domiciliar.
  const wanted: Modality = chosen ?? (campaign ? "fixed_post" : "routine");
  const mod: Modality = wanted === "routine" || !campaign ? "routine" : wanted === "house" && !fieldUsable ? "fixed_post" : wanted;
  const products = (domains?.products ?? []).filter((p) => p.use === "rabies_vaccine");
  const productId = product || (products.length === 1 ? products[0].id : "");
  const needsAnimal = mod !== "fixed_post";
  const picking = !animalId && (needsAnimal || search);

  const modalities: { code: Modality; label: string }[] = [
    ...(campaign ? [ { code: "fixed_post" as const, label: zooLabel(domains?.modalities, "fixed_post") } ] : []),
    ...(campaign && fieldUsable ? [ { code: "house" as const, label: zooLabel(domains?.modalities, "house") } ] : []),
    { code: "routine", label: zooLabel(domains?.modalities, "routine") }
  ];

  function check() {
    return vaccinationProblems(
      {
        modality: mod, animalId, species: animalId ? null : species === "dog" || species === "cat" ? species : null, vaccinatedOn: on, adverse,
        adverseNote: note, householdId: picked?.household_id ?? null
      },
      { campaign, fieldUsable }, today
    ).concat(productId ? [] : [ { code: null, path: "vector_product_id", text: "escolha o produto" } ]);
  }

  function body(): VaccinationInput {
    return {
      modality: mod, vaccinated_on: on, vector_product_id: productId, adverse_event: adverse,
      ...(animalId ? { animal_id: animalId } : { species: species as "dog" | "cat" }),
      ...(mod !== "routine" && campaign ? { campaign_id: campaign.id } : {}),
      ...(mod !== "house" && unit ? { health_unit_id: unit } : {}),
      ...(adverse && note.trim() ? { adverse_note: note.trim() } : {})
    };
  }

  const busy = f.busy;
  const submit = (ev: React.FormEvent) => void f.submit(ev, {
    check, call: () => recordVaccination(body()), ok: onRecorded,
    stale: (text) => { f.show([ { path: "", text } ]); onStale(text); },
    refused: (rs) => rs.map((r) => ({ path: r.code === "already_vaccinated_in_campaign" ? "animal_id" : r.path, text: r.text }))
  });

  return (
    <div style={form}>
      {picking && (
        <div style={box}>
          <AnimalSearch onOpen={(_id, a) => { setPicked(a); setSearch(false); f.clear("animal_id", "species"); }} />
        </div>
      )}
      <form ref={f.formRef} noValidate style={form} aria-label="Registrar dose" onSubmit={submit}>
        <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Registrar dose</p>
        <label style={fieldLabel}>
          Modalidade
          <select value={mod} disabled={busy} style={inputStyle} {...f.aria("modality")} onChange={(e) => { setChosen(e.target.value as Modality); f.clear("modality", "animal_id", "species"); }}>
            {modalities.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
          </select>
        </label>
        {f.errNode("modality")}

        {animalId ? (
          <div style={row}>
            <span>Animal: {`${picked?.name ?? "sem nome"} · ${zooLabel(domains?.species, picked?.species ?? "")}`}</span>
            <ActionButton variant="secondary" onClick={() => setPicked(null)}>Trocar animal</ActionButton>
          </div>
        ) : mod === "fixed_post" ? (
          <>
            <label style={fieldLabel}>
              Espécie
              <select value={species} disabled={busy} style={inputStyle} {...f.aria("species")} onChange={(e) => { setSpecies(e.target.value); f.clear("species"); }}>
                <option value="">Escolha</option>
                {[ "dog", "cat" ].map((c) => <option key={c} value={c}>{zooLabel(domains?.species, c)}</option>)}
              </select>
            </label>
            {f.errNode("species")}
            {!search && <div style={row}><ActionButton variant="secondary" onClick={() => setSearch(true)}>Informar animal cadastrado</ActionButton></div>}
          </>
        ) : <span style={muted}>Busque e abra o animal acima.</span>}
        {f.errNode("animal_id")}

        {mod !== "house" && (
          <>
            <label style={fieldLabel}>
              Unidade
              <select value={unit} disabled={busy} style={inputStyle} {...f.aria("health_unit_id")} onChange={(e) => { setUnit(e.target.value); f.clear("health_unit_id"); }}>
                <option value="">—</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
            {f.errNode("health_unit_id")}
          </>
        )}
        <label style={fieldLabel}>
          Data da vacinação
          <input type="date" value={on} max={today} disabled={busy} style={inputStyle} {...f.aria("vaccinated_on")} onChange={(e) => { setOn(e.target.value); f.clear("vaccinated_on"); }} />
        </label>
        {f.errNode("vaccinated_on")}
        <label style={fieldLabel}>
          Produto
          <select value={productId} disabled={busy} style={inputStyle} {...f.aria("vector_product_id")} onChange={(e) => { setProduct(e.target.value); f.clear("vector_product_id"); }}>
            <option value="">Escolha</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {f.errNode("vector_product_id")}
        <label style={checkLabel}>
          <input type="checkbox" checked={adverse} disabled={busy} onChange={(e) => { setAdverse(e.target.checked); f.clear("adverse_note"); }} />
          Evento adverso
        </label>
        {adverse && (
          <>
            <p style={muted}>{EATAV_REMINDER}</p>
            <label style={fieldLabel}>
              Nota do evento adverso
              <textarea value={note} rows={3} disabled={busy} style={inputStyle} {...f.aria("adverse_note")} onChange={(e) => { setNote(e.target.value); f.clear("adverse_note"); }} />
            </label>
            {f.errNode("adverse_note")}
          </>
        )}
        {f.top((p) => OWN.includes(p))}
        <div style={row}>
          <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Registrar dose</button>
        </div>
      </form>
    </div>
  );
}
