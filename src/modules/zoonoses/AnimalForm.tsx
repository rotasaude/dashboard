// src/modules/zoonoses/AnimalForm.tsx
// Cadastro e edição do animal (módulo 35b, F-35.11; contrato §1, Q20, Q22, Q25, Q31).
// - O tutor só vem da busca de pessoa (`PersonLookup`): o nome digitado nunca vale. Tutor e "comunitário" não vão juntos; nenhum dos dois
//   é "tutor não identificado" (Q22). O domicílio é opcional e só vem da busca de pessoa: o do tutor ou o de outro morador (que não
//   vira tutor).
// - Microchip e registro só na criação; a espécie não muda. A edição manda só o que mudou, com `expected_version`.
// - 409 animal_changed (e os demais "tela velha"): a frase, o pai relê UMA vez, nada é reenviado.
// - Situação (`AnimalStatusChange`): só os `nextAnimalStatuses`, com a data (opcional; omitida se não mexida) e confirmação. Com estada
//   aberta no canil o controle fica desabilitado (ruling T8); se o api recusar mesmo assim (409 invalid_transition path status), a
//   frase do canil, sem releitura.
import { useState } from "react";
import { createAnimal, updateAnimal, type Animal, type AnimalHistory, type AnimalInput, type AnimalPatch, type AnimalSex, type AnimalSize, type AnimalSpecies, type AnimalStatus, type ZooPerson } from "../../lib/api";
import { cityIsoDate } from "../../lib/format";
import { animalProblems, isZoonosesStale, nextAnimalStatuses, zooLabel, zoonosesError, zoonosesRefusals } from "../../lib/zoonoses";
import { ANIMAL_STAY_OPEN, ZOONOSES_ERRORS } from "../../lib/zoonosesErrors";
import { useActionMessage } from "../../lib/useActionMessage";
import { ActionMessage } from "../../components/ActionMessage";
import { ConfirmButton } from "../../components/ConfirmButton";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { box, checkLabel, fieldLabel, form, muted, row } from "../exams/styles";
import { useFormProblems } from "../psychosocial/useFormProblems";
import { hasOpenStay } from "./AnimalHistory";
import { NO_HOUSEHOLD, PersonLookup } from "./PersonLookup";
import { useZooDomains } from "./useZooDomains";

const OWN = [ "species", "name", "sex", "size", "coat", "breed", "birth_estimate_on", "microchip", "registry_number", "community", "tutor_patient_id", "household_id" ];
type HouseholdChoice = "keep" | "none" | "tutor" | "other";
const NOTHING_CHANGED = "nada mudou";

const asPerson = (a: AnimalHistory | undefined): ZooPerson | null => (a?.tutor ? { patient: { id: a.tutor.id, display_name: a.tutor.display_name }, household: null } : null);

export function AnimalForm({ animal, onSaved, onStale, onCancel }: {
  animal?: AnimalHistory; onSaved(a: Animal): void; onStale?(text: string): void; onCancel?(): void;
}) {
  const domains = useZooDomains().data;
  const edit = !!animal;
  const f = useFormProblems({
    refusals: (err) => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null })),
    isStale: (err) => isZoonosesStale(err)
  });
  const [ species, setSpecies ] = useState<string>(animal?.species ?? "");
  const [ name, setName ] = useState(animal?.name ?? "");
  const [ sex, setSex ] = useState<string>(animal?.sex ?? "");
  const [ size, setSize ] = useState<string>(animal?.size ?? "");
  const [ coat, setCoat ] = useState(animal?.coat ?? "");
  const [ breed, setBreed ] = useState(animal?.breed ?? "");
  const [ birth, setBirth ] = useState(animal?.birth_estimate_on?.slice(0, 7) ?? "");
  const [ microchip, setMicrochip ] = useState("");
  const [ registry, setRegistry ] = useState(animal?.registry_number ?? "");
  const [ tutor, setTutor ] = useState<ZooPerson | null>(asPerson(animal));
  const [ community, setCommunity ] = useState(animal?.community ?? false);
  const [ choice, setChoice ] = useState<HouseholdChoice>(edit ? "keep" : "none");
  const [ other, setOther ] = useState<ZooPerson | null>(null);

  const householdId: string | null =
    choice === "keep" ? animal?.household_id ?? null : choice === "tutor" ? tutor?.household?.id ?? null : choice === "other" ? other?.household?.id ?? null : null;
  const birthDate = birth ? `${birth}-01` : "";
  const sl = (list: { code: string; label: string }[] | undefined, fallback: { code: string; label: string }[]) => (list && list.length > 0 ? list : fallback);

  function pickTutor(p: ZooPerson | null) {
    setTutor(p);
    if (p) setCommunity(false);
    f.clear("community", "tutor_patient_id");
  }
  function pickCommunity(on: boolean) {
    setCommunity(on);
    if (on) setTutor(null);
    f.clear("community", "tutor_patient_id");
  }

  function check() {
    const out = animalProblems({
      species, name, sex, size, coat, breed, birthEstimateOn: birthDate, microchip: edit ? "" : microchip, registryNumber: registry,
      householdId, tutorId: tutor?.patient.id ?? null, community
    });
    return out.map((p) => ({ path: p.path, text: p.text }));
  }

  function createBody(): AnimalInput {
    const t = (v: string) => v.trim();
    return {
      species: species as AnimalSpecies, sex: sex as AnimalSex, community,
      ...(t(name) ? { name: t(name) } : {}), ...(size ? { size: size as AnimalSize } : {}), ...(t(coat) ? { coat: t(coat) } : {}),
      ...(t(breed) ? { breed: t(breed) } : {}), ...(birthDate ? { birth_estimate_on: birthDate } : {}), ...(microchip ? { microchip } : {}),
      ...(t(registry) ? { registry_number: t(registry) } : {}), ...(tutor ? { tutor_patient_id: tutor.patient.id } : {}),
      ...(householdId ? { household_id: householdId } : {})
    };
  }

  // Só o que mudou; campo que tinha valor e ficou vazio vai como `null` (o api limpa).
  function patchBody(a: AnimalHistory): AnimalPatch {
    const t = (v: string) => v.trim();
    const p: AnimalPatch = { expected_version: a.version };
    const text = (key: "name" | "coat" | "breed", v: string) => {
      const was = a[key] ?? "";
      if (t(v) === was) return;
      if (t(v)) p[key] = t(v);
      else if (was) p[key] = null;
    };
    text("name", name);
    text("coat", coat);
    text("breed", breed);
    if (sex !== a.sex) p.sex = sex as AnimalSex;
    if (size !== (a.size ?? "")) p.size = size ? (size as AnimalSize) : null;
    if (birthDate !== (a.birth_estimate_on ?? "")) p.birth_estimate_on = birthDate || null;
    const was = a.tutor?.id ?? null;
    const now = tutor?.patient.id ?? null;
    if (now !== was) p.tutor_patient_id = now;
    if (community !== a.community) p.community = community;
    if (choice !== "keep" && householdId !== a.household_id) p.household_id = householdId;
    return p;
  }

  function submit(ev: React.FormEvent) {
    if (animal) {
      void f.submit(ev, {
        check: () => {
          const local = check();
          if (local.length > 0) return local;
          return Object.keys(patchBody(animal)).length === 1 ? [ { path: "", text: NOTHING_CHANGED } ] : [];
        },
        call: () => updateAnimal(animal.id, patchBody(animal)),
        ok: onSaved,
        stale: (text) => { f.show([ { path: "", text } ]); onStale?.(text); }
      });
    } else {
      void f.submit(ev, { check, call: () => createAnimal(createBody()), ok: onSaved });
    }
  }

  const busy = f.busy;
  const heading = edit ? "Editar animal" : "Cadastrar animal";
  const select = (path: string, label: string, value: string, set: (v: string) => void, options: { code: string; label: string }[], optional: boolean, disabled = false) => (
    <>
      <label style={fieldLabel}>
        {label}
        <select value={value} disabled={busy || disabled} style={inputStyle} {...f.aria(path)} onChange={(e) => { set(e.target.value); f.clear(path); }}>
          <option value="">{optional ? "—" : "Escolha"}</option>
          {options.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
      </label>
      {f.errNode(path)}
    </>
  );
  const text = (path: string, label: string, value: string, set: (v: string) => void, extra: { disabled?: boolean; numeric?: boolean } = {}) => (
    <>
      <label style={fieldLabel}>
        {label}
        <input value={value} autoComplete="off" disabled={busy || extra.disabled} inputMode={extra.numeric ? "numeric" : undefined} style={inputStyle}
          {...f.aria(path)} onChange={(e) => { set(e.target.value); f.clear(path); }} />
      </label>
      {f.errNode(path)}
    </>
  );

  return (
    <form ref={f.formRef} noValidate style={form} aria-label={heading} onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>{heading}</p>
      {select("species", "Espécie", species, setSpecies, sl(domains?.species, []), false, edit)}
      {text("name", "Nome", name, setName)}
      {select("sex", "Sexo", sex, setSex, sl(domains?.sexes, []), false)}
      {select("size", "Porte", size, setSize, sl(domains?.sizes, []), true)}
      {text("coat", "Pelagem", coat, setCoat)}
      {text("breed", "Raça", breed, setBreed)}
      <label style={fieldLabel}>
        Mês de nascimento (estimado)
        <input type="month" value={birth} disabled={busy} style={inputStyle} {...f.aria("birth_estimate_on")}
          onChange={(e) => { setBirth(e.target.value); f.clear("birth_estimate_on"); }} />
      </label>
      {f.errNode("birth_estimate_on")}
      {!edit && text("microchip", "Microchip (15 dígitos)", microchip, setMicrochip, { numeric: true })}
      {!edit && text("registry_number", "Número de registro", registry, setRegistry)}
      {edit && animal?.registry_number && <span style={muted}>Registro: {animal.registry_number}</span>}

      <fieldset style={box}>
        <legend>Quem responde pelo animal</legend>
        <PersonLookup value={tutor} onChange={pickTutor} label="Tutor" />
        <label style={checkLabel}>
          <input type="checkbox" checked={community} disabled={busy} onChange={(e) => pickCommunity(e.target.checked)} />
          Comunitário (ninguém responde pelo animal)
        </label>
        {!tutor && !community && <span style={muted}>Sem tutor e sem comunitário: tutor não identificado.</span>}
        {f.errNode("community")}
        {f.errNode("tutor_patient_id")}
      </fieldset>

      <fieldset style={box}>
        <legend>Domicílio (opcional)</legend>
        {edit && (
          <label style={checkLabel}>
            <input type="radio" name="household" checked={choice === "keep"} onChange={() => setChoice("keep")} />
            {animal?.household_id ? "Manter o domicílio atual" : "Manter sem domicílio"}
          </label>
        )}
        <label style={checkLabel}>
          <input type="radio" name="household" checked={choice === "none"} onChange={() => setChoice("none")} />
          {edit ? "Tirar o domicílio" : "Sem domicílio"}
        </label>
        {tutor?.household && (
          <label style={checkLabel}>
            <input type="radio" name="household" checked={choice === "tutor"} onChange={() => setChoice("tutor")} />
            Usar o domicílio do tutor ({tutor.household.address_short})
          </label>
        )}
        <label style={checkLabel}>
          <input type="radio" name="household" checked={choice === "other"} onChange={() => setChoice("other")} />
          Buscar o domicílio por outro morador
        </label>
        {choice === "other" && <PersonLookup value={other} onChange={setOther} label="Outro morador" />}
        {choice === "tutor" && tutor && !tutor.household && <span style={muted}>{NO_HOUSEHOLD}</span>}
        {f.errNode("household_id")}
      </fieldset>

      {f.top((p) => OWN.includes(p))}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>
          {edit ? "Salvar alterações" : "Cadastrar animal"}
        </button>
        {onCancel && (
          <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
            onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
        )}
      </div>
    </form>
  );
}

// ─── Situação ────────────────────────────────────────────────────────────────
export function AnimalStatusChange({ animal, today = cityIsoDate(), onSaved, onStale }: {
  animal: AnimalHistory; today?: string; onSaved(a: Animal): void; onStale(text: string): void;
}) {
  const domains = useZooDomains().data;
  const msg = useActionMessage();
  const options = nextAnimalStatuses(animal.status);
  const [ next, setNext ] = useState<string>("");
  const [ on, setOn ] = useState(today);
  const [ touched, setTouched ] = useState(false);
  if (options.length === 0) return null;
  const min = cityIsoDate(new Date(animal.created_at));
  const stay = hasOpenStay(animal);
  const final = next === "deceased" || next === "transferred";
  const reason = stay ? ANIMAL_STAY_OPEN : !next ? "escolha a nova situação" : null;

  async function confirm() {
    msg.start();
    if (touched && (on < min || on > today)) { msg.fail(ZOONOSES_ERRORS.date_out_of_range); return; }
    try {
      const saved = await updateAnimal(animal.id, { status: next as AnimalStatus, ...(touched ? { status_on: on } : {}), expected_version: animal.version });
      msg.ok("Situação alterada.");
      setNext("");
      onSaved(saved);
    } catch (err) {
      msg.fail(zoonosesError(err, "animal_status"));
      if (isZoonosesStale(err, "animal_status")) onStale(zoonosesError(err, "animal_status"));
    }
  }

  return (
    <section aria-label="Mudar situação" style={box}>
      <strong>Mudar situação</strong>
      <label style={fieldLabel}>
        Nova situação
        <select value={next} disabled={stay} style={inputStyle} onChange={(e) => setNext(e.target.value)}>
          <option value="">Escolha</option>
          {options.map((s) => <option key={s} value={s}>{zooLabel(domains?.animal_statuses, s)}</option>)}
        </select>
      </label>
      <label style={fieldLabel}>
        Data da mudança
        <input type="date" value={on} min={min} max={today} disabled={stay} style={inputStyle}
          onChange={(e) => { setOn(e.target.value); setTouched(true); }} />
      </label>
      <ConfirmButton label="Mudar situação" disabledReason={reason} onConfirm={confirm}
        question={final ? "Confirmar? A situação não volta a ativo." : "Confirmar a mudança de situação?"} />
      <ActionMessage message={msg.message} />
    </section>
  );
}
