// Cadeia de frio (módulo 29; F-29.6; contrato §8; §15 V14, V24; ADR 0047). Local por VaccineLocationPick (onde a pessoa tem papel:
// vacinador, responsável pela sala ou almoxarife da rede de frio; as salas com `roles: []` que o almoxarife recebe não entram).
// - Situação (GET status; lida ao abrir e no "Atualizar", sem polling): um cartão por equipamento ativo com tipo, faixa, última leitura e
//   "leituras de hoje: N de 2" (aviso depois do meio-dia com menos de 2 — o texto diz o número, a cor só reforça); "Registrar
//   temperatura — <equipamento>" para qualquer da equipe.
// - Excursões abertas: a conduta (ExcursionDecision) é do `room_lead` na sala e do `stock_keeper` na rede de frio; os demais veem os
//   lotes bloqueados e quem decide.
// - Equipamentos (lista com os inativos): "Novo equipamento"/"Editar", só de quem decide a conduta.
// Depois da leitura e da conduta, relê a situação e a posição do estoque (o bloqueio muda a posição e o registro da dose). As frases de
// sucesso ficam aqui, fora dos formulários que fecham, e recebem o foco. O relógio é lido a cada render (a prop `now` é só dos testes).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getColdChainStatus, listEquipments, type ColdChainEquipment, type ColdChainExcursion, type ColdChainReading, type ColdChainStatus,
  type ReadingResult, type VaccineLocation
} from "../lib/api";
import { cityDateFormat, fmtDateTime } from "../lib/format";
import { PH_POSITIONS_KEY } from "../lib/pharmacy";
import {
  STATIC_QUERY, VAC_COLD_KEY, VAC_EQUIPMENTS_KEY, VAC_VIALS_KEY, equipmentKindLabel, fmtCelsius, locationAbilities, vaccinationError
} from "../lib/vaccination";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { DataTable } from "../components/DataTable";
import { buttonStyle, secondaryButtonStyle } from "../components/formStyles";
import { alert, box, muted, okText, row, stack, title } from "./exams/styles";
import { EquipmentForm } from "./vaccination/EquipmentForm";
import { ExcursionDecision } from "./vaccination/ExcursionDecision";
import { ReadingForm, fmtRange } from "./vaccination/ReadingForm";
import { VaccinationGate } from "./vaccination/VaccinationGate";
import { VaccineLocationPick } from "./vaccination/VaccineLocationPick";

export const READINGS_PER_DAY = 2;
export const WAITING_ROOM_LEAD = "Lotes bloqueados — aguarda a conduta do responsável pela sala.";
export const WAITING_KEEPER = "Lotes bloqueados — aguarda a conduta do almoxarife da rede de frio.";
export const READING_SAVED = "Leitura registrada.";
export const EQUIPMENT_SAVED = "Equipamento salvo.";

export function readingSavedText(r: ReadingResult): string {
  if (!r.excursion_id) return READING_SAVED;
  if (r.blocked_lots === 0) return "Temperatura fora da faixa registrada: não havia lote a bloquear.";
  return r.blocked_lots === 1 ? "Excursão aberta: 1 lote bloqueado." : `Excursão aberta: ${r.blocked_lots} lotes bloqueados.`;
}

export function VaccinationColdChain({ now, onGoToSecurity }: { now?: Date; onGoToSecurity?(): void } = {}) {
  return (
    <VaccinationGate title="Cadeia de frio" sub="equipamentos, temperatura duas vezes ao dia e conduta" allow={(r) => r.professional || r.keeper}>
      {() => (
        <VaccineLocationPick allow={(a) => a.vaccinate || a.keeper}>
          {(loc) => <ColdChainBody location={loc} now={now} onGoToSecurity={onGoToSecurity} />}
        </VaccineLocationPick>
      )}
    </VaccinationGate>
  );
}

// Regra de teclado: depois de uma escrita, o foco vai à frase de sucesso.
function Notice({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, [ lines ]);
  return (
    <div ref={ref} tabIndex={-1} role="status">
      {lines.map((l) => <p key={l} style={okText}>{l}</p>)}
    </div>
  );
}

const cityHour = (at: Date): number =>
  Number(cityDateFormat({ hourCycle: "h23", hour: "2-digit" }, "en-US").formatToParts(at).find((p) => p.type === "hour")?.value ?? 0) % 24;

function readingText(r: ColdChainReading): string {
  return `${fmtCelsius(r.current_c)} em ${fmtDateTime(r.read_at)} (mín. ${fmtCelsius(r.min_c)}, máx. ${fmtCelsius(r.max_c)})${r.by?.name ? ` — ${r.by.name}` : ""}`;
}

function ColdChainBody({ location, now, onGoToSecurity }: { location: VaccineLocation; now?: Date; onGoToSecurity?(): void }) {
  const client = useQueryClient();
  const abilities = locationAbilities(location);
  const manager = location.kind === "cold_chain_central" ? abilities.keeper : abilities.lead;
  const status = useQuery({ queryKey: [ VAC_COLD_KEY, location.id ], queryFn: () => getColdChainStatus(location.id), ...STATIC_QUERY });
  const [ notice, setNotice ] = useState<string[] | null>(null);
  const [ reading, setReading ] = useState<string | null>(null);

  const reload = () => Promise.all([
    client.invalidateQueries({ queryKey: [ VAC_COLD_KEY, location.id ] }), client.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY ] }),
    client.invalidateQueries({ queryKey: [ VAC_VIALS_KEY ] })
  ]);
  const data: ColdChainStatus | undefined = status.data;
  const at = now ?? new Date();
  const afternoon = cityHour(at) >= 12;
  const nameOf = (id: string) => data?.equipments.find((e) => e.id === id)?.name ?? "equipamento";
  const readingEquipment = data?.equipments.find((e) => e.id === reading) ?? null;

  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Local: ${location.name}`}</p>
      {notice && <Notice lines={notice} />}
      <Panel title="Situação" sub="temperatura duas vezes ao dia, na faixa do equipamento"
        right={<button type="button" style={secondaryButtonStyle} onClick={() => { setNotice(null); void status.refetch(); }}>Atualizar</button>}>
        <div style={{ ...stack, padding: 16 }}>
          {status.isPending && <p className="mono" style={muted}>carregando…</p>}
          {status.isError && !data && <p role="alert" style={alert}>{vaccinationError(status.error)}</p>}
          {data && data.equipments.length === 0 && <p style={muted}>nenhum equipamento ativo neste local</p>}
          {data?.equipments.map((eq) => {
            const late = eq.readings_today < READINGS_PER_DAY && afternoon;
            return (
              <article key={eq.id} aria-label={eq.name} style={box}>
                <h4 style={title}>{eq.name}</h4>
                <small className="mono" style={muted}>{`${equipmentKindLabel(eq.kind)} · faixa ${fmtRange(eq)}`}</small>
                <p style={{ margin: 0, fontSize: 12.5 }}>{eq.last_reading ? `última leitura: ${readingText(eq.last_reading)}` : "nenhuma leitura registrada"}</p>
                <div style={row}>
                  <Tag tone={late ? "warn" : "neutral"}>{`leituras de hoje: ${eq.readings_today} de ${READINGS_PER_DAY}`}</Tag>
                  {eq.last_reading?.out_of_range && <Tag tone="down">última leitura fora da faixa</Tag>}
                </div>
                {reading !== eq.id && (
                  <div style={row}>
                    <button type="button" style={buttonStyle} onClick={() => { setNotice(null); setReading(eq.id); }}>{`Registrar temperatura — ${eq.name}`}</button>
                  </div>
                )}
                {reading === eq.id && readingEquipment && (
                  <ReadingForm equipment={readingEquipment} now={now} onCancel={() => setReading(null)}
                    onSaved={(r) => { setReading(null); setNotice([ readingSavedText(r) ]); void reload(); }} />
                )}
              </article>
            );
          })}
        </div>
      </Panel>
      {data && data.open_excursions.length > 0 && (
        <Panel title="Excursões abertas" sub="lotes bloqueados até a conduta, lote a lote">
          <div style={{ ...stack, padding: 16 }}>
            {data.open_excursions.map((ex) => (
              <div key={ex.id} style={stack}>
                <p style={{ margin: 0, fontSize: 12.5 }}>{`${nameOf(ex.equipment_id)}: ${readingText(ex.reading)}`}</p>
                {manager ? (
                  <ExcursionDecision key={ex.id} excursion={ex} equipmentName={nameOf(ex.equipment_id)} onGoToSecurity={onGoToSecurity}
                    onRefresh={() => void reload()} onDone={(lines) => { setNotice(lines); void reload(); }} />
                ) : (
                  <BlockedLots excursion={ex} central={location.kind === "cold_chain_central"} />
                )}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {manager && <EquipmentsPanel location={location} onSaved={() => setNotice([ EQUIPMENT_SAVED ])} onStart={() => setNotice(null)} />}
    </div>
  );
}

function BlockedLots({ excursion, central }: { excursion: ColdChainExcursion; central: boolean }) {
  return (
    <div style={box}>
      <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{central ? WAITING_KEEPER : WAITING_ROOM_LEAD}</p>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
        {excursion.lots.map((l) => (
          <li key={l.lot_id}>{`${l.immunobiological.name ?? l.immunobiological.code} — lote ${l.number}${l.pending_adjustment_id ? " (aguardando aprovação do descarte)" : ""}`}</li>
        ))}
      </ul>
    </div>
  );
}

function EquipmentsPanel({ location, onSaved, onStart }: { location: VaccineLocation; onSaved(): void; onStart(): void }) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: [ VAC_EQUIPMENTS_KEY, location.id ], queryFn: () => listEquipments(location.id), ...STATIC_QUERY });
  const [ editing, setEditing ] = useState<ColdChainEquipment | "new" | null>(null);
  const open = (e: ColdChainEquipment | "new") => { onStart(); setEditing(e); };

  return (
    <Panel title="Equipamentos" sub="geladeiras, câmaras e freezers do local; desative em vez de apagar">
      <div style={{ ...stack, padding: 16 }}>
        {list.isPending && <p className="mono" style={muted}>carregando…</p>}
        {list.isError && !list.data && <p role="alert" style={alert}>{vaccinationError(list.error)}</p>}
        {list.data && (
          <DataTable<ColdChainEquipment>
            cols={[
              { label: "Nome", w: "1.4fr", card: "title", render: (e) => e.name },
              { label: "Tipo", w: "1fr", render: (e) => equipmentKindLabel(e.kind) },
              { label: "Faixa", w: "1fr", render: (e) => <span className="mono">{fmtRange(e)}</span> },
              { label: "Situação", w: "1fr", card: "pair", render: (e) => <Tag tone={e.active ? "ok" : "neutral"}>{e.active ? "ativo" : "inativo"}</Tag> },
              { label: "", w: "auto", card: "actions", render: (e) => (
                <button type="button" style={secondaryButtonStyle} onClick={() => open(e)}>{`Editar — ${e.name}`}</button>
              ) }
            ]}
            rows={list.data} rowKey={(e) => e.id} empty="nenhum equipamento cadastrado"
          />
        )}
        {editing === null && <div style={row}><button type="button" style={buttonStyle} onClick={() => open("new")}>Novo equipamento</button></div>}
        {editing !== null && (
          <EquipmentForm key={editing === "new" ? "new" : editing.id} locationId={location.id} initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null); onSaved();
              void client.invalidateQueries({ queryKey: [ VAC_EQUIPMENTS_KEY, location.id ] });
              void client.invalidateQueries({ queryKey: [ VAC_COLD_KEY, location.id ] });
            }} />
        )}
      </div>
    </Panel>
  );
}
