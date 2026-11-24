// src/modules/ZooShelter.tsx
// Tela "Canil e gatil" do centro de zoonoses (módulo 35b, F-35.16): estadas abertas por unidade de vigilância ambiental (a contagem
// não tem limite), entrada, saída, e, para o veterinário (papel da equipe e perfil de `GET /professionals/me`, Q12), a castração e a
// eutanásia com step-up. Sem o perfil: a frase ZOO_NOT_VET e nenhum botão. Estada, animal e eutanásia nunca levam tutor, microchip
// nem contato para a lista; a ficha do animal (NOMINAL_QUERY) só é lida ao abrir e depois de uma ação.
import { useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorCode, getAnimal, getMyProfessional, listShelterStays, recordNeutering, type AnimalHistory, type ShelterStay } from "../lib/api";
import { cityIsoDate } from "../lib/format";
import { fmtDay } from "../lib/homeVisits";
import {
  NOMINAL_QUERY, STATIC_QUERY, animalDisplayName, ZOO_ANIMAL_KEY, ZOO_ME_KEY, ZOO_NOT_VET, ZOO_STAYS_KEY, isVeterinarian, isZoonosesStale, zooLabel, zoonosesError,
  zoonosesRefusals, type ZoonosesRoles
} from "../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import type { Problem } from "../lib/pharmacy";
import type { PsyRefusal } from "../lib/psychosocial";
import { ActionButton } from "../components/ActionButton";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { KeyValue } from "../components/KeyValue";
import { Tag } from "../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { SegmentedControl } from "../shell/SegmentedControl";
import { box, fieldLabel, form, grid, muted, panel, row, stack } from "./exams/styles";
import { useFormProblems } from "./psychosocial/useFormProblems";
import { EuthanasiaForm } from "./zoonoses/EuthanasiaForm";
import { ExitForm, StayForm } from "./zoonoses/StayForm";
import { ZoonosesGate } from "./zoonoses/ZoonosesGate";
import { useZooDomains } from "./zoonoses/useZooDomains";

export const NO_SHELTER_UNIT = "nenhuma unidade de vigilância ambiental ativa";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Tab = "open" | "exits";
const TABS: { key: Tab; label: string }[] = [ { key: "open", label: "No canil" }, { key: "exits", label: "Saídas" } ];

export function ZooShelter({ today, onGoToSecurity }: { today?: string; onGoToSecurity?(): void } = {}) {
  return (
    <ZoonosesGate title="Canil e gatil" sub="zoonoses · canil e gatil" allow={(r) => r.team}>
      {(roles) => <Shelter roles={roles} today={today ?? cityIsoDate()} onGoToSecurity={onGoToSecurity} />}
    </ZoonosesGate>
  );
}

function Shelter({ roles, today, onGoToSecurity }: { roles: ZoonosesRoles; today: string; onGoToSecurity?(): void }) {
  const client = useQueryClient();
  const domainsQuery = useZooDomains();
  const domains = domainsQuery.data;
  const me = useQuery({ queryKey: [ ZOO_ME_KEY ], queryFn: getMyProfessional, ...STATIC_QUERY });
  const [ tab, setTab ] = useState<Tab>("open");
  const [ unitId, setUnitId ] = useState("");
  const [ picked, setPicked ] = useState<string | null>(null);
  const [ entering, setEntering ] = useState(false);
  const [ notice, setNotice ] = useState<string | null>(null);

  // Q41: as unidades de vigilância ambiental ativas vêm dos domínios (`/attendance/units` é fechado à equipe de zoonoses).
  const shelters = domains?.units ?? [];
  const unit = shelters.find((u) => u.id === unitId) ?? shelters[0] ?? null;
  const q = useInfiniteQuery({
    queryKey: [ ZOO_STAYS_KEY, tab, unit?.id ?? "" ], ...STATIC_QUERY, enabled: !!unit, initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listShelterStays({ open: tab === "open", healthUnitId: unit!.id, before: pageParam }),
    getNextPageParam: (last) => last.next_before ?? undefined
  });
  // A aba "Saídas" lê todas as estadas da unidade e fica com as fechadas (o api não filtra só as fechadas).
  const all = q.data?.pages.flatMap((p) => p.items) ?? [];
  const rows = tab === "open" ? all : all.filter((s) => s.exited_on !== null);
  const occupancy = q.data?.pages[0]?.occupancy.find((o) => o.health_unit_id === unit?.id)?.open_stays ?? 0;
  const stay = tab === "open" ? rows.find((s) => s.id === picked) ?? null : null;
  const vet = isVeterinarian(me.data, roles);

  const rereadStays = () => client.invalidateQueries({ queryKey: [ ZOO_STAYS_KEY ] });
  const stale = (text: string) => { setNotice(text); setEntering(false); setPicked(null); void rereadStays(); };
  const kind = (code: string) => zooLabel(domains?.entry_kinds, code);
  const animalName = (s: ShelterStay) => animalDisplayName(s.animal.name, s.animal.species);

  const openCols: Column<ShelterStay>[] = [
    { label: "Animal", w: "1fr", card: "title", render: animalName },
    { label: "Entrada", w: "1fr", render: (s) => kind(s.entry_kind) },
    { label: "Desde", w: "0.8fr", render: (s) => fmtDay(s.entered_on) },
    { label: "Observação", w: "0.8fr", render: (s) => (s.bite_observation_id ? <Tag tone="neutral">entrada por observação</Tag> : "—") },
    { label: "Ações", w: "1fr", card: "actions", render: (s) => <ActionButton variant="secondary" onClick={() => { setNotice(null); setEntering(false); setPicked(s.id); }}>Abrir animal</ActionButton> }
  ];
  const exitCols: Column<ShelterStay>[] = [
    { label: "Animal", w: "1fr", card: "title", render: animalName },
    { label: "Entrada", w: "1.2fr", render: (s) => `${kind(s.entry_kind)} em ${fmtDay(s.entered_on)}` },
    { label: "Saída", w: "1.2fr", render: (s) => `${zooLabel(domains?.exit_kinds, s.exit_kind ?? "")} em ${fmtDay(s.exited_on ?? "")}` }
  ];

  if (domainsQuery.isLoading) return <p style={muted}>carregando…</p>;
  if (domainsQuery.isError) return <EmptyState title={zoonosesError(domainsQuery.error)} />;
  if (!unit) return <EmptyState title={NO_SHELTER_UNIT} />;

  return (
    <div style={stack}>
      <div style={row}>
        {shelters.length > 1 ? (
          <label style={fieldLabel}>
            Unidade
            <select value={unit.id} style={inputStyle} onChange={(e) => { setUnitId(e.target.value); setPicked(null); }}>
              {shelters.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        ) : <strong>{unit.name}</strong>}
        <Tag tone="neutral">{occupancy === 1 ? "1 animal no canil" : `${occupancy} animais no canil`}</Tag>
      </div>
      <SegmentedControl<Tab> options={TABS} value={tab} onChange={(t) => { setTab(t); setPicked(null); setEntering(false); }} />
      {tab === "open" && !entering && <div style={row}><ActionButton onClick={() => { setNotice(null); setPicked(null); setEntering(true); }}>Registrar entrada</ActionButton></div>}
      {entering && (
        <StayForm unit={unit} today={today} onCancel={() => setEntering(false)} onStale={stale}
          onEntered={() => { setEntering(false); setNotice("Entrada registrada."); void rereadStays(); }} />
      )}
      {notice && <p role="status" style={muted}>{notice}</p>}
      {q.isLoading && <p style={muted}>carregando…</p>}
      {q.isError && <EmptyState title={zoonosesError(q.error)} />}
      {q.data && (
        <DataTable<ShelterStay> label={tab === "open" ? "Estadas abertas" : "Saídas"} cols={tab === "open" ? openCols : exitCols} rows={rows}
          rowKey={(s) => s.id} empty={tab === "open" ? "nenhum animal no canil" : "nenhuma saída"} />
      )}
      {q.hasNextPage && <div style={row}><ActionButton variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Carregar mais</ActionButton></div>}
      {stay && (
        <StayDetail key={stay.id} stay={stay} today={today} vet={vet} meLoaded={!me.isLoading} me={me.data ?? null} onGoToSecurity={onGoToSecurity}
          onStale={stale} onNotice={setNotice} onExited={() => { setPicked(null); setNotice("Saída registrada."); void rereadStays(); }} />
      )}
    </div>
  );
}

const refusals = (err: unknown): PsyRefusal[] => zoonosesRefusals(err).map((r) => ({ ...r, participantIndex: null }));

type Mode = "neuter" | "euthanasia" | "exit" | null;

// A ficha do animal da estada (lida ao abrir e depois de cada ação) e as ações dela.
function StayDetail({ stay, today, vet, meLoaded, me, onGoToSecurity, onStale, onNotice, onExited }: {
  stay: ShelterStay; today: string; vet: boolean; meLoaded: boolean; me: Awaited<ReturnType<typeof getMyProfessional>>;
  onGoToSecurity?(): void; onStale(text: string): void; onNotice(text: string): void; onExited(): void;
}) {
  const client = useQueryClient();
  const domains = useZooDomains().data;
  const [ mode, setMode ] = useState<Mode>(null);
  const q = useQuery({ queryKey: [ ZOO_ANIMAL_KEY, stay.animal_id ], queryFn: () => getAnimal(stay.animal_id), ...NOMINAL_QUERY });
  const reread = () => client.invalidateQueries({ queryKey: [ ZOO_ANIMAL_KEY, stay.animal_id ] });
  if (q.isLoading) return <p style={muted}>carregando…</p>;
  if (q.isError || !q.data) return <EmptyState title={zoonosesError(q.error)} />;
  const a: AnimalHistory = q.data;
  const living = a.status === "active" || a.status === "missing";
  const openObservation = a.observations.find((o) => o.state === "open") ?? null;
  const e = a.euthanasia;

  return (
    <article aria-label={`Animal ${a.name ?? "sem nome"}`} style={panel}>
      <div style={row}>
        <strong>{a.name ?? "sem nome"}</strong>
        <Tag tone={a.status === "active" ? "ok" : "neutral"}>{zooLabel(domains?.animal_statuses, a.status)}</Tag>
        {a.neutered && <Tag tone="neutral">castrado</Tag>}
      </div>
      <div style={grid}>
        <KeyValue k="Espécie" v={zooLabel(domains?.species, a.species)} mono={false} />
        <KeyValue k="Sexo" v={zooLabel(domains?.sexes, a.sex)} mono={false} />
        <KeyValue k="Tutor" v={a.has_tutor ? "com tutor" : a.community ? "comunitário" : "tutor não identificado"} mono={false} />
        <KeyValue k="Entrada" v={`${zooLabel(domains?.entry_kinds, stay.entry_kind)} em ${fmtDay(stay.entered_on)}`} mono={false} />
      </div>
      {e && (
        <section aria-label="Eutanásia registrada" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <strong>Eutanásia</strong>
          <span>
            {fmtDay(e.performed_on)} · {zooLabel(domains?.euthanasia_reasons, e.reason)} · {e.legal_basis.map((b) => zooLabel(domains?.legal_bases, b)).join(", ")}
            {" · "}{e.veterinarian.name} ({e.veterinarian.crmv})
          </span>
        </section>
      )}

      {mode === null && (
        <div style={row}>
          {meLoaded && vet && living && !a.neutered && <ActionButton variant="secondary" onClick={() => setMode("neuter")}>Registrar castração</ActionButton>}
          {meLoaded && vet && living && !e && <ActionButton variant="secondary" onClick={() => setMode("euthanasia")}>Registrar eutanásia</ActionButton>}
          <ActionButton variant="secondary" onClick={() => setMode("exit")}>Registrar saída</ActionButton>
        </div>
      )}
      {meLoaded && !vet && <p style={muted}>{ZOO_NOT_VET}</p>}

      {mode === "neuter" && (
        <NeuteringForm animalId={a.id} stayId={stay.id} today={today} onCancel={() => setMode(null)}
          onStale={(text) => { setMode(null); onNotice(text); void reread(); }}
          onDone={() => {
            // O 201 já vale: grava no histórico lido antes da releitura, para a tela não oferecer a castração de novo.
            client.setQueryData<AnimalHistory>([ ZOO_ANIMAL_KEY, a.id ], { ...a, neutered: true });
            setMode(null); onNotice("Castração registrada."); void reread();
          }} />
      )}
      {mode === "euthanasia" && vet && me && !e && (
        <EuthanasiaForm animal={a} me={me} today={today} stayId={stay.id} observationId={openObservation?.id ?? null}
          onGoToSecurity={onGoToSecurity} onCancel={() => setMode(null)} onRefused={(text) => { setMode(null); onNotice(text); void reread(); }}
          onDone={(done) => {
            // O 201 já vale: o histórico lido passa a ter a eutanásia (só leitura) antes da releitura.
            client.setQueryData<AnimalHistory>([ ZOO_ANIMAL_KEY, a.id ], { ...a, status: "deceased", status_on: done.performed_on, euthanasia: done });
            setMode(null); onNotice("Eutanásia registrada. Feche a estada com a saída por eutanásia."); void reread();
          }} />
      )}
      {mode === "exit" && (
        <ExitForm stay={stay} animal={a} today={today} onCancel={() => setMode(null)} onExited={onExited}
          onStale={(text) => { setMode(null); onStale(text); }} />
      )}
    </article>
  );
}

// Castração: data até hoje; `neutered` não volta (não há desfazer). Só a veterinária (403 veterinarian_required: a frase e uma releitura).
function NeuteringForm({ animalId, stayId, today, onDone, onStale, onCancel }: {
  animalId: string; stayId: string; today: string; onDone(): void; onStale(text: string): void; onCancel(): void;
}) {
  const f = useFormProblems({ refusals, isStale: (err) => isZoonosesStale(err) || errorCode(err) === "veterinarian_required" });
  const [ performedOn, setPerformedOn ] = useState(today);
  const busy = f.busy;
  function check(): Problem[] {
    if (!DATE.test(performedOn)) return [ { path: "performed_on", text: "informe a data da castração" } ];
    return performedOn > today ? [ { path: "performed_on", text: ZOONOSES_ERRORS.date_out_of_range } ] : [];
  }
  const submit = (ev: React.FormEvent) => void f.submit(ev, {
    check, call: () => recordNeutering({ animal_id: animalId, performed_on: performedOn, shelter_stay_id: stayId }), ok: onDone, stale: onStale
  });
  return (
    <form ref={f.formRef} noValidate style={{ ...form, ...box }} aria-label="Castração" onSubmit={submit}>
      <p ref={f.titleRef} tabIndex={-1} style={{ margin: 0, fontWeight: 600 }}>Castração</p>
      <label style={fieldLabel}>
        Data da castração
        <input type="date" value={performedOn} disabled={busy} style={inputStyle} {...f.aria("performed_on")}
          onChange={(e) => { setPerformedOn(e.target.value); f.clear("performed_on"); }} />
      </label>
      {f.errNode("performed_on")}
      {f.top((p) => p === "performed_on")}
      <p style={muted}>A castração não se desfaz.</p>
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>Confirmar castração</button>
        <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => { if (!busy) onCancel(); }}>Cancelar</button>
      </div>
    </form>
  );
}
