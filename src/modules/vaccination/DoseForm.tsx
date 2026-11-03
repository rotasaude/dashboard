// Registro da dose aplicada na sala (módulo 29; F-29.3; contrato §5; §15 V5, V20, V22). Lote do estoque da sala (FEFO, sem os
// bloqueados/vencidos), frasco aberto na multidose (ou "Abrir frasco deste lote"), avisos que um motivo libera (marca `overridable`
// do api) e recusas duras. Lote recusado (bloqueado, vencido, de outra vacina, fora da sala, sem saldo) relê a posição e limpa a
// escolha; frasco recusado relê os frascos; o resto do formulário fica e nada é reenviado sozinho. Duplo envio dá uma chamada só
// (`busy` em ref). O api exige a condição maternal para o sexo feminino (a terminologia tem "Nenhuma"). A estratégia fora da rotina
// aceita dose fora do calendário (`dose_not_in_calendar` só na rotina). Nada do formulário vai a storage, URL ou console.
// Os campos (`DoseFields`), o estado do rascunho (`useDoseDraft`), a posição e os frascos (`useDoseStock`), a conferência antes de
// enviar (`doseCheck`) e a recusa do api (`doseRefused`) também servem à substituição do cancelamento (CancelDose, F-29.3).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  listPositions, listVials, openVial, recordImmunization, type CardItem, type CardPatient, type CodeName, type Immunization,
  type VaccinationCatalog, type VaccineLocation, type Vial
} from "../../lib/api";
import { cityIsoDate, parseCityLocal } from "../../lib/format";
import { PH_POSITIONS_KEY, lotOptionLabel, type Problem } from "../../lib/pharmacy";
import {
  STATIC_QUERY, VAC_VIALS_KEY, cityLocalInput, doseBody, doseProblems, lotsForDose, maternalRequired, newDoseDraft, reasonProblem, splitRefusals,
  vaccinationRefusals, vialRemaining, vialsForDose, type DoseDraft, type VaccinationRefusal
} from "../../lib/vaccination";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, list, muted, panel, row, title } from "../exams/styles";

export interface DoseFormProps {
  room: VaccineLocation; patient: CardPatient; catalog: VaccinationCatalog; item: CardItem | null;
  // Só para testes: sem ela, o relógio é lido na hora de usar (abrir, filtrar frascos, conferir antes de enviar).
  now?: Date;
  onSaved(imm: Immunization): void; onCancel(): void;
}

// Recusas que tornam a escolha velha: relê a lista e limpa o campo.
const LOT_CODES = [ "lot_blocked", "lot_expired", "lot_not_in_room", "lot_product_mismatch", "insufficient_balance" ];
const VIAL_CODES = [ "vial_expired", "vial_empty", "vial_lot_mismatch", "vial_closed_out" ];
const FIELDS: (keyof DoseDraft)[] = [
  "immunobiologicalCode", "doseCode", "strategy", "careGroup", "route", "site", "maternalCondition", "appliedAt", "lotId", "vialId", "overrideReason"
];
const PATH: Record<string, string> = {
  immunobiologicalCode: "immunobiological_code", doseCode: "dose_code", strategy: "strategy", careGroup: "care_group", route: "route", site: "site",
  maternalCondition: "maternal_condition", appliedAt: "applied_at", lotId: "lot_id", vialId: "vial_id", overrideReason: "override_reason"
};
const KNOWN_PATHS = FIELDS.map((f) => PATH[f]);
const WARNING_INPUTS: (keyof DoseDraft)[] = [ "immunobiologicalCode", "doseCode", "appliedAt" ];
export const STALE_REFUSAL = "corrija o que o servidor recusou antes de enviar de novo";

// Posição da sala e frascos abertos da vacina do rascunho (sem pessoa: STATIC_QUERY). Quem chama com as mesmas chaves divide o cache.
export function useDoseStock(room: VaccineLocation, catalog: VaccinationCatalog, code: string) {
  const roomId = room.room_id as string;
  const imm = catalog.immunobiologicals.find((i) => i.code === code) ?? null;
  const multidose = !!imm?.multidose;
  const positions = useInfiniteQuery({
    queryKey: [ PH_POSITIONS_KEY, room.id, "dose" ],
    queryFn: ({ pageParam }) => listPositions({ locationId: room.id, before: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_before ?? undefined,
    ...STATIC_QUERY
  });
  const vialsKey = [ VAC_VIALS_KEY, roomId, "open" ];
  const vialsQuery = useQuery({ queryKey: vialsKey, queryFn: () => listVials(roomId, "open"), enabled: multidose, ...STATIC_QUERY });
  const vials = multidose ? vialsQuery.data ?? [] : [];
  const allPositions = positions.data?.pages.flatMap((p) => p.positions) ?? [];
  return { imm, multidose, positions, vialsKey, vials, allPositions };
}
export type DoseStock = ReturnType<typeof useDoseStock>;

// Rascunho, recusas locais e do api. Edição do usuário: some a recusa daquele campo (a estratégia também desfaz "fora do
// calendário"). Os avisos do servidor (intervalo, idade) dependem da vacina, da dose e da hora: mudar qualquer um os descarta.
export function useDoseDraft(init: () => DoseDraft) {
  const [ draft, setDraft ] = useState<DoseDraft>(init);
  const [ problems, setProblems ] = useState<Problem[]>([]);
  const [ refusals, setRefusals ] = useState<VaccinationRefusal[]>([]);
  const { warnings, blocking } = splitRefusals(refusals);

  function set(key: keyof DoseDraft, value: string, extra: Partial<DoseDraft> = {}) {
    setDraft((d) => ({ ...d, ...extra, [key]: value }));
    const keys = [ key, ...Object.keys(extra) ];
    const paths = keys.map((k) => PATH[k]);
    const dropWarnings = keys.some((k) => WARNING_INPUTS.includes(k as keyof DoseDraft));
    setProblems((ps) => ps.filter((p) => !paths.includes(p.path)));
    setRefusals((rs) => rs.filter((r) => splitRefusals([ r ]).warnings.length > 0
      ? !dropWarnings
      : !(paths.includes(r.path) || (key === "strategy" && r.code === "dose_not_in_calendar"))));
  }

  // Problemas por campo (locais e recusas duras do api) e as recusas sem campo conhecido.
  const fieldProblems: Problem[] = [ ...problems, ...blocking.filter((b) => KNOWN_PATHS.includes(b.path)).map((b) => ({ path: b.path, text: b.text })) ];
  const loose = blocking.filter((r) => !KNOWN_PATHS.includes(r.path));
  return { draft, setDraft, set, problems, setProblems, refusals, setRefusals, warnings, blocking, fieldProblems, loose };
}
export type DoseDraftState = ReturnType<typeof useDoseDraft>;

// Conferência antes de enviar, com lotes e frascos recalculados no instante `at`.
export function doseCheck(s: DoseDraftState, stock: DoseStock, catalog: VaccinationCatalog, patient: CardPatient, at: Date): Problem[] {
  const fresh = stock.multidose ? stock.vials : [];
  const found = doseProblems(s.draft, { catalog, lots: lotsForDose(stock.allPositions, s.draft.immunobiologicalCode, cityIsoDate(at), fresh, at),
    vials: fresh, now: at, sex: patient.sex, birthDate: patient.birth_date });
  if (s.warnings.length > 0 && s.draft.overrideReason.trim() === "") found.push({ path: "override_reason", text: reasonProblem("", "o motivo") as string });
  // Recusa dura de campo ainda na tela = o campo não mudou desde a resposta (editar tira a recusa): o motivo não basta.
  // Recusa solta (sem campo, ex.: missing_role) não trava: pode ser passageira.
  if (s.blocking.some((b) => KNOWN_PATHS.includes(b.path))) found.push({ path: "", text: STALE_REFUSAL });
  return found;
}

// Recusa do api (paths já sem prefixo): guarda todas; lote velho relê a posição e limpa lote e frasco; frasco velho relê os frascos.
export function doseRefused(s: DoseDraftState, stock: DoseStock, client: QueryClient, room: VaccineLocation, list: VaccinationRefusal[]) {
  s.setRefusals(list);
  const codes = list.map((r) => r.code);
  if (codes.some((c) => LOT_CODES.includes(c))) {
    s.setDraft((d) => ({ ...d, lotId: "", vialId: "" }));
    void client.invalidateQueries({ queryKey: [ PH_POSITIONS_KEY, room.id ] });
  }
  if (codes.some((c) => VIAL_CODES.includes(c))) {
    s.setDraft((d) => ({ ...d, vialId: "" }));
    void client.invalidateQueries({ queryKey: stock.vialsKey });
  }
}

export function DoseForm({ room, patient, catalog, item, now: fixedNow, onSaved, onCancel }: DoseFormProps) {
  const roomId = room.room_id as string;
  const clock = () => fixedNow ?? new Date();
  const client = useQueryClient();
  const s = useDoseDraft(() => {
    const imm = item ? catalog.immunobiologicals.find((i) => i.code === item.immunobiological.code) ?? null : null;
    return { ...newDoseDraft(imm, item?.dose.code ?? "", clock()), immunobiologicalCode: item?.immunobiological.code ?? "" };
  });
  const stock = useDoseStock(room, catalog, s.draft.immunobiologicalCode);
  const busy = useRef(false);
  const [ sending, setSending ] = useState(false);

  // Chamada direta (não useMutation: o mutate agenda a chamada) — o envio sai já no submit, e o ref barra o segundo.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    if (busy.current) return;
    const found = doseCheck(s, stock, catalog, patient, clock());
    s.setProblems(found);
    if (found.length > 0) return;
    busy.current = true;
    setSending(true);
    recordImmunization(roomId, doseBody(s.draft, patient.id, catalog)).then(
      (saved) => { busy.current = false; if (!alive.current) return; setSending(false); onSaved(saved); },
      (err: unknown) => {
        busy.current = false;
        if (!alive.current) return;
        setSending(false);
        doseRefused(s, stock, client, room, vaccinationRefusals(err));
      }
    );
  }

  const anyError = s.problems.length > 0 || s.blocking.length > 0;
  const general = s.problems.filter((p) => p.path === "").map((p) => p.text);

  return (
    <section aria-label="Registro da dose" style={panel}>
      <h3 style={title}>Registrar dose</h3>
      <form aria-label="Registrar dose" style={form} onSubmit={submit} noValidate>
        <DoseFields room={room} patient={patient} catalog={catalog} item={item} draft={s.draft} onChange={s.set} problems={s.fieldProblems}
          warnings={s.warnings} now={fixedNow} />
        {s.loose.length > 0 && <ul role="alert" style={{ ...list, color: "var(--down)" }}>{s.loose.map((r) => <li key={`${r.path}-${r.code}`}>{r.text}</li>)}</ul>}
        {general.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
        {anyError && s.loose.length === 0 && general.length === 0 && <p role="alert" style={alert}>confira os campos destacados</p>}
        <div style={row}>
          <button type="submit" style={sending ? disabledButtonStyle : buttonStyle} disabled={sending}>Registrar dose</button>
          <button type="button" style={secondaryButtonStyle} disabled={sending} onClick={onCancel}>Voltar à caderneta</button>
        </div>
        {sending && <p className="mono" style={muted}>registrando…</p>}
      </form>
    </section>
  );
}

export interface DoseFieldsProps {
  room: VaccineLocation; patient: CardPatient; catalog: VaccinationCatalog;
  // Com item, vacina e dose ficam só leitura; sem ele ("Outra vacina", substituição), são escolhidas no catálogo.
  item?: CardItem | null;
  draft: DoseDraft; onChange(key: keyof DoseDraft, value: string, extra?: Partial<DoseDraft>): void;
  // Por path do corpo da dose (immunobiological_code, lot_id…); path "" não é de campo e fica com quem monta.
  problems: Problem[];
  warnings?: VaccinationRefusal[];
  now?: Date;
}

// Os campos da dose, sem o envio: o DoseForm e a substituição do cancelamento os montam.
export function DoseFields({ room, patient, catalog, item = null, draft, onChange, problems, warnings = [], now: fixedNow }: DoseFieldsProps) {
  const roomId = room.room_id as string;
  const now = fixedNow ?? new Date(); // a cada render: frascos, lotes e o `max` não ficam presos à abertura da sala
  const today = cityIsoDate(now);
  const client = useQueryClient();
  const uid = useId();
  const stock = useDoseStock(room, catalog, draft.immunobiologicalCode);
  const { imm, multidose, positions, vials, allPositions, vialsKey } = stock;
  const lots = lotsForDose(allPositions, draft.immunobiologicalCode, today, vials, now);
  const lotVials = draft.lotId === "" ? [] : vialsForDose(vials, [ draft.lotId ], now)
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const showReason = warnings.length > 0 || draft.overrideReason !== "" || problems.some((p) => p.path === "override_reason");
  const [ openProblem, setOpenProblem ] = useState<string | null>(null);
  const open = useMutation({ gcTime: 0, mutationFn: (lotId: string) => openVial(roomId, lotId) });

  function chooseVaccine(code: string) {
    const next = catalog.immunobiologicals.find((i) => i.code === code) ?? null;
    onChange("immunobiologicalCode", code, { route: next?.default_route ?? "", site: next?.default_site ?? "", lotId: "", vialId: "" });
  }

  function openNewVial() {
    if (open.isPending || draft.lotId === "") return;
    setOpenProblem(null);
    open.mutate(draft.lotId, {
      onSuccess: (v) => {
        // O frasco novo entra na lista sem reler (a escolha não pode depender de uma releitura).
        client.setQueryData<Vial[]>(vialsKey, (old) => [ ...(old ?? []).filter((x) => x.id !== v.id), v ]);
        onChange("vialId", v.id);
      },
      onError: (err) => setOpenProblem(vaccinationRefusals(err).map((r) => r.text).join("; "))
    });
  }

  const appliedOn = cityIsoDate(parseCityLocal(draft.appliedAt) ?? now);
  function field(key: keyof DoseDraft, label: string, control: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => ReactNode, after?: ReactNode) {
    const id = `${uid}-${key}`;
    const errs = problems.filter((p) => p.path === PATH[key]).map((p) => p.text);
    const errId = `${id}-err`;
    return (
      <div style={fieldLabel}>
        <label htmlFor={id}>{label}</label>
        {control({ id, ...(errs.length > 0 ? { "aria-describedby": errId, "aria-invalid": true } : {}) })}
        {after}
        {errs.length > 0 && <div id={errId}>{errs.map((t) => <p key={t} style={alert}>{t}</p>)}</div>}
      </div>
    );
  }
  const options = (terms: CodeName[], empty: string) => [
    <option key="" value="">{empty}</option>, ...terms.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)
  ];
  const select = (key: keyof DoseDraft, terms: CodeName[], empty: string, change?: (v: string) => void) =>
    (props: { id: string }) => (
      <select {...props} style={inputStyle} value={draft[key]} onChange={(e) => (change ? change(e.target.value) : onChange(key, e.target.value))}>
        {options(terms, empty)}
      </select>
    );
  const fixed = (value: string) => (props: { id: string }) => <input {...props} style={inputStyle} readOnly value={value} />;

  const t = catalog.terminologies;
  const vaccineName = item ? item.immunobiological.name ?? imm?.name ?? item.immunobiological.code : "";
  const doseName = item ? item.dose.name ?? t.dose.find((d) => d.code === item.dose.code)?.name ?? item.dose.code : "";

  return (
    <>
      {field("immunobiologicalCode", "Vacina", item ? fixed(vaccineName)
        : select("immunobiologicalCode", catalog.immunobiologicals.map((i) => ({ code: i.code, name: i.name })), "escolha a vacina", chooseVaccine))}
      {field("doseCode", "Dose", item ? fixed(doseName) : select("doseCode", t.dose, "escolha a dose"))}
      {field("strategy", "Estratégia", select("strategy", t.strategy, "escolha a estratégia"))}
      {field("careGroup", "Grupo de atendimento", select("careGroup", t.care_group, "escolha o grupo"))}
      {field("route", "Via", select("route", t.route, "escolha a via"))}
      {field("site", "Local de aplicação", select("site", t.site, "escolha o local"))}
      {patient.sex === "female" && field("maternalCondition", "Condição maternal", select("maternalCondition", t.maternal_condition, "escolha"),
        maternalRequired(patient.sex, patient.birth_date, appliedOn) ? undefined : <span style={muted}>opcional nesta idade (obrigatória de 10 a 49 anos)</span>)}
      {field("appliedAt", "Data e hora da aplicação", (props) => (
        <input {...props} type="datetime-local" style={inputStyle} max={cityLocalInput(now)} value={draft.appliedAt}
          onChange={(e) => onChange("appliedAt", e.target.value)} />
      ))}
      {field("lotId", "Lote", (props) => (
        <select {...props} style={inputStyle} value={draft.lotId} onChange={(e) => onChange("lotId", e.target.value, { vialId: "" })}>
          <option value="">{lots.length === 0 && !positions.isPending ? "nenhum lote desta vacina na sala" : "escolha o lote"}</option>
          {lots.map((b, i) => <option key={b.lot.id} value={b.lot.id}>{lotOptionLabel(b, i === 0)}</option>)}
        </select>
      ), (
        <>
          {positions.isError && <p style={alert}>{vaccinationRefusals(positions.error)[0].text}</p>}
          {positions.hasNextPage && (
            <button type="button" style={secondaryButtonStyle} disabled={positions.isFetchingNextPage} onClick={() => void positions.fetchNextPage()}>
              {positions.isFetchingNextPage ? "Carregando…" : "Carregar mais vacinas"}
            </button>
          )}
        </>
      ))}
      {multidose && field("vialId", "Frasco aberto", (props) => (
        <select {...props} style={inputStyle} value={draft.vialId} onChange={(e) => onChange("vialId", e.target.value)}>
          <option value="">{draft.lotId === "" ? "escolha o lote primeiro" : lotVials.length === 0 ? "nenhum frasco aberto deste lote" : "escolha o frasco"}</option>
          {lotVials.map((v, i) => (
            <option key={v.id} value={v.id}>
              {`restam ${v.doses_left} doses · ${vialRemaining(v, now)}${i === 0 ? " · sugerido (vence primeiro)" : ""}`}
            </option>
          ))}
        </select>
      ), draft.lotId !== "" && (
        <>
          <div style={row}>
            <button type="button" style={open.isPending ? disabledButtonStyle : secondaryButtonStyle} disabled={open.isPending} onClick={openNewVial}>
              Abrir frasco deste lote
            </button>
          </div>
          {openProblem && <p role="alert" style={alert}>{openProblem}</p>}
        </>
      ))}
      {warnings.length > 0 && (
        <div role="note" aria-label="Avisos" style={box}>
          <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>Avisos — para aplicar mesmo assim, escreva o motivo</p>
          <ul style={list}>{warnings.map((w) => <li key={`${w.path}-${w.code}`}>{w.text}</li>)}</ul>
        </div>
      )}
      {showReason && field("overrideReason", "Motivo para aplicar mesmo assim", (props) => (
        <textarea {...props} style={inputStyle} rows={2} value={draft.overrideReason}
          onChange={(e) => onChange("overrideReason", e.target.value)} />
      ))}
    </>
  );
}
