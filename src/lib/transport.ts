// Regras de tela do módulo 30 (transporte sanitário; contrato 2026-11-03 §1–§5, §9) sem React. Sobreposição, lotação, CNH, regra do acompanhante, avisos e imutabilidade são do api; a tela só não envia o que já sabe que será recusado.
// Formas e códigos conferidos contra o api (api-surface do módulo 30): onde o plano diz outra coisa, vale o api.
import {
  ApiError,
  type DestinationInput, type DriverInput, type DriverUpdate, type ExpenseInput, type FuelInput, type PassengerInput, type PassengerOrigin,
  type ScheduledCareItem, type SeriesInput, type TransportCount, type TransportDriver, type TransportVehicle, type Trip, type TripCloseInput,
  type TripInput, type TripStop, type TripStopInput, type VehicleInput
} from "./api";
import { NOMINAL_QUERY, STATIC_QUERY } from "./careLines";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import { cityDateFormat, cityIsoDate, cityLocalIso, parseCityLocal } from "./format";
import { pharmacyRefusals, type Problem, type Refusal } from "./pharmacy";

export { NOMINAL_QUERY, STATIC_QUERY };

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const TRANSPORT_DISABLED = "o transporte sanitário está desligado nesta cidade";
export const TRANSPORT_NO_ROLE = "seu papel não permite usar o transporte sanitário";
export const SMALL_COUNT = "menos de 5";
export const NO_CLINICAL_NOTE = "A lista não leva diagnóstico, procedimento nem especialidade.";

export const TR_VEHICLES_KEY = "transportVehicles";
export const TR_DRIVERS_KEY = "transportDrivers";
export const TR_DESTINATIONS_KEY = "transportDestinations";
export const TR_TRIPS_KEY = "transportTrips";
export const TR_SERIES_KEY = "transportSeries";
export const TR_PENDING_KEY = "transportPending";
export const TR_NO_SHOWS_KEY = "transportNoShows";
export const TR_MY_TRIPS_KEY = "transportMyTrips";
export const TR_SETTINGS_KEY = "transportSettings";
export const TR_DASHBOARD_KEY = "transportDashboard";

// ─── Portão e papéis ────────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// Interruptor `sanitary_transport` na sessão e nunca o operador da plataforma.
export function canUseTransport(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "sanitary_transport");
}

export function transportRoles(user: SessionLike): { dispatcher: boolean; driver: boolean; admin: boolean; committee: boolean; professional: boolean } {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return {
    dispatcher: roles.includes("transport_dispatcher"), driver: roles.includes("driver"), admin: roles.includes("municipal_admin"),
    committee: roles.includes("tfd_committee"), professional: roles.includes("health_professional")
  };
}

// Quem só tem o papel de motorista vai direto à tela dele.
export function isDriverOnly(user: SessionLike): boolean {
  if (!user || user.operator) return false;
  const roles = user.memberships?.map((m) => m.role) ?? [];
  return roles.includes("driver") && roles.every((r) => r === "driver");
}

// ─── Rótulos. Código novo do api aparece cru. ───────────────────────────────
const pick = (map: Record<string, string>) => (code: string): string => (Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code);

export const tripStatusLabel = pick({ planned: "planejada", confirmed: "confirmada", in_progress: "em andamento", done: "concluída", cancelled: "cancelada" });
const TRIP_TONE: Record<string, string> = { planned: "info", confirmed: "ok", in_progress: "info", done: "neutral", cancelled: "down" };
export const tripStatusTone = (code: string): string => TRIP_TONE[code] ?? "neutral";

export const vehicleKindLabel = pick({ van: "Van", minibus: "Micro-ônibus", bus: "Ônibus", car: "Carro", ambulance_a: "Ambulância tipo A" });
export const originLabel = pick({
  regulation: "regulação", appointment: "agenda da cidade", tfd: "TFD", series: "série recorrente", exception: "sem atendimento marcado"
});
export const exceptionReasonLabel = pick({
  follow_up_return: "retorno", legacy_patient: "paciente antigo sem processo", scheduling_pending: "agendamento em andamento", other: "outro motivo"
});
export const attendanceLabel = pick({ pending: "a marcar", boarded: "embarcou", no_show: "faltou" });
export const expenseKindLabel = pick({ toll: "pedágio", parking: "estacionamento", meal: "alimentação", other: "outra" });
// `refused` = qualquer recusa que não seja de capacidade, na rotina das séries.
export const pendingReasonLabel = pick({
  no_seat: "sem lugar na viagem", no_wheelchair_spot: "sem vaga de cadeirante", refused: "o sistema não conseguiu incluir (recusado)"
});

const DAY_NAMES = [ "seg", "ter", "qua", "qui", "sex", "sáb", "dom" ];
// Semana ISO: 1 = segunda … 7 = domingo.
export function weekdaysLabel(days: number[]): string {
  return [ ...days ].sort((a, b) => a - b).map((d) => DAY_NAMES[d - 1] ?? String(d)).join(", ");
}

const fmtIsoDay = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

// `expiring` = vence em até 30 dias (incluindo hoje); a CNH da data da viagem é conferida à parte.
export function licenseText(d: TransportDriver): string {
  const day = fmtIsoDay(d.license_expires_on);
  if (d.license_status === "valid") return `CNH ${d.license_category} válida até ${day}`;
  if (d.license_status === "expiring") return `CNH vence em ${day}`;
  if (d.license_status === "expired") return `CNH vencida em ${day}`;
  return `CNH ${d.license_category} (${d.license_status}) até ${day}`;
}
const LICENSE_TONE: Record<string, string> = { valid: "ok", expiring: "warn", expired: "down" };
export const licenseTone = (d: TransportDriver): string => LICENSE_TONE[d.license_status] ?? "neutral";

// ─── Dinheiro e números ─────────────────────────────────────────────────────
// "12,34", "12.34", "1.234,56", "1234" → centavos; vazio, negativo, três casas ou texto → null.
export function parseReais(raw: string): number | null {
  const t = raw.trim();
  let intPart: string;
  let frac = "";
  let m: RegExpExecArray | null;
  if ((m = /^([1-9]\d{0,2}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(t))) {
    intPart = m[1].replace(/\./g, "");
    frac = m[2] ?? "";
  } else if ((m = /^(\d+)(?:,(\d{1,2}))?$/.exec(t)) || (m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t))) {
    intPart = m[1];
    frac = m[2] ?? "";
  } else {
    return null;
  }
  const cents = Number(intPart) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const fmtCents = (cents: number): string => BRL.format(cents / 100);

// Litros: até duas casas, maior que 0 e até 1000 (o limite do api).
export function parseLiters(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return n > 0 && n <= 1000 ? n : null;
}

// Painel: 1 a 4 chegam como "lt5".
export const fmtCount = (v: TransportCount): string => (v === "lt5" ? SMALL_COUNT : String(v));

const isInt = (raw: string): boolean => /^\d+$/.test(raw.trim());
const intIn = (raw: string, min: number, max: number): boolean => isInt(raw) && Number(raw) >= min && Number(raw) <= max;
const textIn = (raw: string, min: number, max: number): boolean => raw.trim().length >= min && raw.trim().length <= max;
const orNull = (raw: string): string | null => (raw.trim() === "" ? null : raw.trim());
const TIME = /^\d{2}:\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Frota ──────────────────────────────────────────────────────────────────
export interface VehicleDraft {
  plate: string; renavam: string; model: string; kind: string; renem_code: string; seats: string; wheelchair_spots: string; cnes: string; active: boolean;
}
export interface DriverDraft { userId: string; licenseNumber: string; licenseCategory: string; licenseExpiresOn: string; active: boolean }
export interface DestinationDraft { ibgeCode: string; name: string; distanceKm: string; metropolitan: boolean; active: boolean }

// Maiúscula, sem hífen nem espaço (o api normaliza igual).
export const normalizePlate = (raw: string): string => raw.replace(/[\s-]/g, "").toUpperCase();

export function vehicleProblems(d: VehicleDraft): Problem[] {
  const out: Problem[] = [];
  if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(normalizePlate(d.plate))) out.push({ path: "plate", text: "placa inválida — use o formato ABC1234 ou ABC1D23" });
  if (!/^\d{11}$/.test(d.renavam.trim())) out.push({ path: "renavam", text: "RENAVAM tem 11 dígitos" });
  if (!textIn(d.model, 2, 80)) out.push({ path: "model", text: "o modelo tem de 2 a 80 caracteres" });
  if (d.kind.trim() === "") out.push({ path: "kind", text: "escolha o tipo do veículo" });
  if (d.renem_code.trim() !== "" && !textIn(d.renem_code, 1, 20)) out.push({ path: "renem_code", text: "o código RENEM tem até 20 caracteres" });
  if (!intIn(d.seats, 1, 60)) out.push({ path: "seats", text: "lugares: número inteiro de 1 a 60" });
  if (!intIn(d.wheelchair_spots, 0, 10)) out.push({ path: "wheelchair_spots", text: "vagas de cadeirante: número inteiro de 0 a 10" });
  if (d.cnes.trim() !== "" && !/^\d{7}$/.test(d.cnes.trim())) out.push({ path: "cnes", text: "CNES tem 7 dígitos" });
  return out;
}

// CNES e RENEM vazios vão nulos (texto vazio o api recusa).
export function vehicleBody(d: VehicleDraft): VehicleInput {
  return {
    plate: normalizePlate(d.plate), renavam: d.renavam.trim(), model: d.model.trim(), kind: d.kind, renem_code: orNull(d.renem_code),
    seats: Number(d.seats), wheelchair_spots: Number(d.wheelchair_spots), cnes: orNull(d.cnes), active: d.active
  };
}

// CNH: obrigatória só ao criar; na edição, vazia = mantém a que está.
export function driverProblems(d: DriverDraft, creating: boolean): Problem[] {
  const out: Problem[] = [];
  if (creating && d.userId === "") out.push({ path: "user_id", text: "escolha a pessoa da equipe" });
  const number = d.licenseNumber.trim();
  if (creating ? !/^\d{11}$/.test(number) : number !== "" && !/^\d{11}$/.test(number)) out.push({ path: "license_number", text: "a CNH tem 11 dígitos" });
  if (![ "B", "C", "D", "E" ].includes(d.licenseCategory)) out.push({ path: "license_category", text: "escolha a categoria da CNH (B, C, D ou E)" });
  if (!DATE.test(d.licenseExpiresOn)) out.push({ path: "license_expires_on", text: "informe a validade da CNH" });
  return out;
}

export function driverCreateBody(d: DriverDraft): DriverInput {
  return {
    user_id: d.userId, license_number: d.licenseNumber.trim(), license_category: d.licenseCategory as DriverInput["license_category"],
    license_expires_on: d.licenseExpiresOn, active: d.active
  };
}

// Sem `user_id` (não muda) e sem `license_number` quando vazio.
export function driverUpdateBody(d: DriverDraft): DriverUpdate {
  const number = d.licenseNumber.trim();
  return {
    ...(number !== "" ? { license_number: number } : {}), license_category: d.licenseCategory as DriverInput["license_category"],
    license_expires_on: d.licenseExpiresOn, active: d.active
  };
}

export function destinationProblems(d: DestinationDraft): Problem[] {
  const out: Problem[] = [];
  if (!/^\d{7}$/.test(d.ibgeCode.trim())) out.push({ path: "ibge_code", text: "o código IBGE tem 7 dígitos" });
  if (!textIn(d.name, 2, 120)) out.push({ path: "name", text: "o nome tem de 2 a 120 caracteres" });
  if (!intIn(d.distanceKm, 0, 9999)) out.push({ path: "distance_km", text: "distância: número inteiro de 0 a 9999 km" });
  return out;
}

export function destinationBody(d: DestinationDraft): DestinationInput {
  return { ibge_code: d.ibgeCode.trim(), name: d.name.trim(), distance_km: Number(d.distanceKm), metropolitan: d.metropolitan, active: d.active };
}

// ─── Viagem ─────────────────────────────────────────────────────────────────
export interface TripDraft {
  date: string; departureTime: string; returnDate: string; returnTime: string; vehicleId: string; driverId: string;
  boarding: string[]; destinationIds: string[];
}

export function newTripDraft(date: string): TripDraft {
  return { date, departureTime: "", returnDate: date, returnTime: "", vehicleId: "", driverId: "", boarding: [], destinationIds: [] };
}

const HOUR_MINUTE = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
const localTime = (iso: string): string => cityDateFormat(HOUR_MINUTE, "en-GB").format(new Date(iso));
const localDay = (iso: string): string => cityIsoDate(new Date(iso));

export function tripDraftFrom(t: Trip): TripDraft {
  const stops = [ ...t.stops ].sort((a, b) => a.position - b.position);
  return {
    date: t.date, departureTime: localTime(t.departure_at), returnDate: localDay(t.return_at), returnTime: localTime(t.return_at),
    vehicleId: t.vehicle?.id ?? "", driverId: t.driver?.id ?? "",
    boarding: stops.filter((s) => s.kind === "boarding").map((s) => s.label),
    destinationIds: stops.filter((s) => s.kind === "destination" && s.destination_id).map((s) => s.destination_id as string)
  };
}

// CNH vencida na DATA DA VIAGEM e veículo com mais de 8 lugares (CTB art. 143) exige D ou E. O api confere de novo ao confirmar e ao iniciar.
export function driverFitProblems(
  driver: TransportDriver | undefined, vehicle: Pick<TransportVehicle, "seats"> | undefined, date: string
): Problem[] {
  if (!driver) return [];
  const out: Problem[] = [];
  if (driver.license_expires_on < date) out.push({ path: "driver_id", text: "a CNH deste motorista está vencida na data da viagem" });
  if (vehicle && vehicle.seats > 8 && ![ "D", "E" ].includes(driver.license_category)) {
    out.push({ path: "driver_id", text: "veículo com mais de 8 lugares exige CNH D ou E" });
  }
  return out;
}

const MAX_RETURN_MS = 72 * 3600 * 1000;

// Um problema por campo (o primeiro), na ordem em que a tela os mostra.
export function tripProblems(d: TripDraft, ctx: { vehicles: TransportVehicle[]; drivers: TransportDriver[]; confirm: boolean }): Problem[] {
  const out: Problem[] = [];
  const add = (p: Problem) => { if (!out.some((o) => o.path === p.path)) out.push(p); };
  const departure = TIME.test(d.departureTime) && DATE.test(d.date) ? parseCityLocal(`${d.date}T${d.departureTime}`) : null;
  const back = TIME.test(d.returnTime) && DATE.test(d.returnDate) ? parseCityLocal(`${d.returnDate}T${d.returnTime}`) : null;
  if (!DATE.test(d.date)) add({ path: "date", text: "informe o dia da viagem" });
  if (!departure) add({ path: "departure_at", text: "informe a hora de saída" });
  if (!back) add({ path: "return_at", text: "informe o dia e a hora do retorno" });
  else if (departure && back.getTime() <= departure.getTime()) add({ path: "return_at", text: "o retorno precisa ser depois da saída" });
  else if (departure && back.getTime() - departure.getTime() > MAX_RETURN_MS) add({ path: "return_at", text: "o retorno pode ser até 72 horas depois da saída" });
  const boarding = d.boarding.map((b) => b.trim());
  if (boarding.length === 0) add({ path: "boarding", text: "informe ao menos um ponto de embarque" });
  else if (boarding.some((b) => !textIn(b, 3, 120))) add({ path: "boarding", text: "cada ponto de embarque tem de 3 a 120 caracteres" });
  if (d.destinationIds.length === 0 || d.destinationIds.some((id) => id === "")) add({ path: "destinations", text: "escolha ao menos um destino" });
  const vehicle = d.vehicleId ? ctx.vehicles.find((v) => v.id === d.vehicleId) : undefined;
  const driver = d.driverId ? ctx.drivers.find((x) => x.id === d.driverId) : undefined;
  if (d.vehicleId === "" && ctx.confirm) add({ path: "vehicle_id", text: "escolha o veículo" });
  else if (vehicle && !vehicle.active) add({ path: "vehicle_id", text: "este veículo está inativo" });
  if (d.driverId === "" && ctx.confirm) add({ path: "driver_id", text: "escolha o motorista" });
  else if (driver && !driver.active) add({ path: "driver_id", text: "este motorista está inativo" });
  else driverFitProblems(driver, vehicle, d.date).forEach(add);
  return out;
}

// `vehicle_id`/`driver_id` só quando escolhidos; na edição (`edit`) o campo vazio manda `null`, que desfaz a escolha (ausente = mantém). Com as paradas da viagem existente, as que continuam mantêm o `id` (D3): embarque pelo
// rótulo, destino pelo `destination_id`. O rótulo do destino vai vazio: o api põe o nome.
export function tripBody(d: TripDraft, stops?: TripStop[], opts: { edit?: boolean } = {}): TripInput {
  const free = [ ...(stops ?? []) ];
  const take = (match: (s: TripStop) => boolean): string | undefined => {
    const i = free.findIndex(match);
    return i < 0 ? undefined : free.splice(i, 1)[0].id;
  };
  const out: TripStopInput[] = [];
  d.boarding.map((b) => b.trim()).filter((b) => b !== "").forEach((label) => {
    const id = take((s) => s.kind === "boarding" && s.label === label);
    out.push({ ...(id ? { id } : {}), position: out.length + 1, kind: "boarding", label });
  });
  d.destinationIds.filter((x) => x !== "").forEach((destination_id) => {
    const id = take((s) => s.kind === "destination" && s.destination_id === destination_id);
    out.push({ ...(id ? { id } : {}), position: out.length + 1, kind: "destination", destination_id, label: "" });
  });
  return {
    date: d.date, departure_at: cityLocalIso(`${d.date}T${d.departureTime}`) ?? "", return_at: cityLocalIso(`${d.returnDate}T${d.returnTime}`) ?? "",
    ...(d.vehicleId ? { vehicle_id: d.vehicleId } : opts.edit ? { vehicle_id: null } : {}),
    ...(d.driverId ? { driver_id: d.driverId } : opts.edit ? { driver_id: null } : {}), stops: out
  };
}

export function occupancyText(t: Trip): string {
  const o = t.occupancy;
  if (o.seats === null) return `${o.seats_used} ${o.seats_used === 1 ? "lugar ocupado" : "lugares ocupados"} · sem veículo`;
  const seats = `${o.seats_used} de ${o.seats} ${o.seats === 1 ? "lugar" : "lugares"}`;
  if (o.wheelchair_spots === null) return seats;
  return `${seats} · ${o.wheelchair_used} de ${o.wheelchair_spots} ${o.wheelchair_spots === 1 ? "cadeira" : "cadeiras"}`;
}

// ─── Passageiro ─────────────────────────────────────────────────────────────
export interface CompanionDraft { name: string; document: string; reason: string }
export interface PassengerDraft {
  patientId: string; origin: string; originId: string; exceptionReason: string; exceptionNote: string; stopId: string; destinationId: string;
  providerName: string; address: string; appointmentAt: string; takesSeat: boolean; wheelchair: boolean; companion: CompanionDraft | null;
}

// Sugestão de atendimento marcado → rascunho (hora de parede da cidade no campo datetime-local).
export function passengerDraftFrom(item: ScheduledCareItem, boardingStopId: string): PassengerDraft {
  return {
    patientId: item.patient.id, origin: item.origin, originId: item.origin_id, exceptionReason: "", exceptionNote: "", stopId: boardingStopId,
    destinationId: item.destination.destination_id ?? "", providerName: item.destination.provider_name ?? "", address: item.destination.address ?? "",
    appointmentAt: item.appointment_at ? `${localDay(item.appointment_at)}T${localTime(item.appointment_at)}` : "",
    takesSeat: true, wheelchair: false, companion: null
  };
}

// Não confere a idade do acompanhante: o api tem a idade e recusa `companion_not_allowed`.
export function passengerProblems(d: PassengerDraft, t: Trip): Problem[] {
  const out: Problem[] = [];
  if (d.patientId === "") out.push({ path: "patient_id", text: "escolha o paciente" });
  if (d.stopId === "") out.push({ path: "stop_id", text: "escolha onde o paciente embarca" });
  if (d.destinationId === "") out.push({ path: "destination_id", text: "escolha o destino" });
  if (d.origin === "exception") {
    const note = d.exceptionNote.trim();
    if (d.exceptionReason === "") out.push({ path: "exception_reason", text: "informe por que o passageiro vai sem atendimento marcado" });
    else if (d.exceptionReason === "other" ? !textIn(note, 10, 500) : note !== "" && !textIn(note, 10, 500)) {
      out.push({ path: "exception_note", text: "descreva o motivo em 10 a 500 caracteres" });
    }
  } else if (d.originId === "") {
    out.push({ path: "origin_id", text: "escolha o atendimento marcado" });
  }
  if (d.providerName.trim().length > 120) out.push({ path: "provider_name", text: "o local tem até 120 caracteres" });
  if (d.address.trim().length > 200) out.push({ path: "address", text: "o endereço tem até 200 caracteres" });
  const o = t.occupancy;
  // O acompanhante também ocupa um lugar.
  const seatsNeeded = (d.takesSeat ? 1 : 0) + (d.companion ? 1 : 0);
  if (o.seats !== null && seatsNeeded > 0 && o.seats_used + seatsNeeded > o.seats) out.push({ path: "takes_seat", text: "a viagem está lotada" });
  if (d.wheelchair && o.wheelchair_spots !== null && o.wheelchair_used >= o.wheelchair_spots) {
    out.push({ path: "wheelchair", text: "não há vaga de cadeirante nesta viagem" });
  }
  if (d.companion) {
    const c = d.companion;
    if (!textIn(c.name, 3, 120)) out.push({ path: "companion.name", text: "o nome do acompanhante tem de 3 a 120 caracteres" });
    if (c.document.trim().length > 20) out.push({ path: "companion.document", text: "o documento do acompanhante tem até 20 caracteres" });
    if (c.reason.trim() !== "" && !textIn(c.reason, 10, 500)) out.push({ path: "companion.reason", text: "o motivo do acompanhante tem de 10 a 500 caracteres" });
  }
  return out;
}

function companionBody(c: CompanionDraft): NonNullable<PassengerInput["companion"]> {
  return { name: c.name.trim(), ...(c.document.trim() ? { document: c.document.trim() } : {}), ...(c.reason.trim() ? { reason: c.reason.trim() } : {}) };
}

// Só as chaves da origem: exceção leva motivo e nota (sem `origin_id`); as outras levam `origin_id`. Texto vazio é omitido.
export function passengerBody(d: PassengerDraft): PassengerInput {
  const exception = d.origin === "exception";
  return {
    patient_id: d.patientId, origin: d.origin as PassengerOrigin,
    ...(exception
      ? { exception_reason: d.exceptionReason as PassengerInput["exception_reason"], ...(d.exceptionNote.trim() ? { exception_note: d.exceptionNote.trim() } : {}) }
      : { origin_id: d.originId }),
    stop_id: d.stopId, destination_id: d.destinationId,
    ...(d.providerName.trim() ? { provider_name: d.providerName.trim() } : {}), ...(d.address.trim() ? { address: d.address.trim() } : {}),
    ...(d.appointmentAt ? { appointment_at: cityLocalIso(d.appointmentAt) } : {}),
    takes_seat: d.takesSeat, wheelchair: d.wheelchair, ...(d.companion ? { companion: companionBody(d.companion) } : {})
  };
}

// ─── Série ──────────────────────────────────────────────────────────────────
export interface SeriesDraft {
  patientId: string; destinationId: string; providerName: string; weekdays: number[]; appointmentTime: string; departureTime: string;
  returnTime: string; boardingLabel: string; startsOn: string; endsOn: string; wheelchair: boolean; companion: CompanionDraft | null;
}

// `today` fica na assinatura; o api só confere fim >= início.
export function seriesProblems(d: SeriesDraft, _today: string): Problem[] {
  const out: Problem[] = [];
  if (d.patientId === "") out.push({ path: "patient_id", text: "escolha o paciente" });
  if (d.destinationId === "") out.push({ path: "destination_id", text: "escolha o destino" });
  if (d.weekdays.length === 0) out.push({ path: "weekdays", text: "escolha ao menos um dia da semana" });
  if (!textIn(d.boardingLabel, 3, 120)) out.push({ path: "boarding_label", text: "o ponto de embarque tem de 3 a 120 caracteres" });
  if (d.providerName.trim().length > 120) out.push({ path: "provider_name", text: "o local tem até 120 caracteres" });
  if (!TIME.test(d.appointmentTime)) out.push({ path: "appointment_time", text: "informe o horário do atendimento" });
  // Regra só da tela: o api não exige a saída antes do atendimento.
  if (!TIME.test(d.departureTime)) out.push({ path: "departure_time", text: "informe o horário de saída" });
  else if (TIME.test(d.appointmentTime) && d.departureTime >= d.appointmentTime) {
    out.push({ path: "departure_time", text: "a saída precisa ser antes do horário do atendimento" });
  }
  if (!TIME.test(d.returnTime)) out.push({ path: "return_time", text: "informe o horário de retorno" });
  else if (TIME.test(d.departureTime) && d.returnTime <= d.departureTime) out.push({ path: "return_time", text: "o retorno precisa ser depois da saída" });
  if (!DATE.test(d.startsOn)) out.push({ path: "starts_on", text: "informe o início da série" });
  if (d.endsOn !== "") {
    if (DATE.test(d.startsOn) && d.endsOn < d.startsOn) out.push({ path: "ends_on", text: "o fim precisa ser depois do início" });
  }
  if (d.companion && !textIn(d.companion.name, 3, 120)) out.push({ path: "companion.name", text: "o nome do acompanhante tem de 3 a 120 caracteres" });
  return out;
}

// Fim e local vazios vão nulos; `companion: null` remove o acompanhante.
export function seriesBody(d: SeriesDraft): SeriesInput {
  return {
    patient_id: d.patientId, destination_id: d.destinationId, provider_name: orNull(d.providerName),
    weekdays: [ ...new Set(d.weekdays) ].sort((a, b) => a - b), appointment_time: d.appointmentTime, departure_time: d.departureTime,
    return_time: d.returnTime, boarding_label: d.boardingLabel.trim(), starts_on: d.startsOn, ends_on: orNull(d.endsOn), wheelchair: d.wheelchair,
    companion: d.companion ? companionBody(d.companion) : null
  };
}

// ─── Fechamento (motorista) ─────────────────────────────────────────────────
export interface CloseDraft {
  odometerStart: string; odometerEnd: string;
  fuel: { liters: string; amount: string; station: string }[];
  expenses: { kind: string; amount: string; note: string }[];
}

// Passageiro ou acompanhante ainda por marcar.
export function pendingAttendance(t: Trip): number {
  return t.passengers.reduce((n, p) => n + (p.attendance === "pending" ? 1 : 0) + (p.companion && p.companion_attendance === "pending" ? 1 : 0), 0);
}

const MAX_ODOMETER = 9_999_999;
export const MAX_CENTS = 10_000_000;
const EXPENSE_KINDS = [ "toll", "parking", "meal", "other" ];
const centsOk = (raw: string): boolean => {
  const c = parseReais(raw);
  return c !== null && c >= 1 && c <= MAX_CENTS;
};

// Caminhos pontuados, os mesmos do api (`fuel.0.liters`), para a recusa local e a do servidor caírem no mesmo campo.
export function closeProblems(d: CloseDraft, t: Trip): Problem[] {
  const out: Problem[] = [];
  const startOk = intIn(d.odometerStart, 0, MAX_ODOMETER);
  const endOk = intIn(d.odometerEnd, 0, MAX_ODOMETER);
  if (!startOk) out.push({ path: "odometer_start", text: "informe o odômetro de saída (número inteiro)" });
  if (!endOk) out.push({ path: "odometer_end", text: "informe o odômetro de chegada (número inteiro)" });
  else if (startOk && Number(d.odometerEnd) < Number(d.odometerStart)) out.push({ path: "odometer_end", text: "o odômetro de chegada é menor que o de saída" });
  if (d.fuel.length > 20) out.push({ path: "fuel", text: "no máximo 20 abastecimentos" });
  d.fuel.forEach((f, i) => {
    if (parseLiters(f.liters) === null) out.push({ path: `fuel.${i}.liters`, text: "litros: maior que 0, até 1000, com até duas casas" });
    if (!centsOk(f.amount)) out.push({ path: `fuel.${i}.amount_cents`, text: "valor: de R$ 0,01 a R$ 100.000,00" });
    if (!textIn(f.station, 1, 120)) out.push({ path: `fuel.${i}.station`, text: "informe o posto (até 120 caracteres)" });
  });
  if (d.expenses.length > 20) out.push({ path: "expenses", text: "no máximo 20 despesas" });
  d.expenses.forEach((e, i) => {
    if (!EXPENSE_KINDS.includes(e.kind)) out.push({ path: `expenses.${i}.kind`, text: "escolha o tipo da despesa" });
    if (!centsOk(e.amount)) out.push({ path: `expenses.${i}.amount_cents`, text: "valor: de R$ 0,01 a R$ 100.000,00" });
    if (e.note.trim().length > 120) out.push({ path: `expenses.${i}.note`, text: "a observação tem até 120 caracteres" });
  });
  if (pendingAttendance(t) > 0) out.push({ path: "passengers", text: "marque embarcou ou faltou para todos, inclusive acompanhantes" });
  return out;
}

// Abastecimento e despesa só quando há linhas; observação em branco é omitida.
export function closeBody(d: CloseDraft): TripCloseInput {
  const fuel: FuelInput[] = d.fuel.map((f) => ({ liters: parseLiters(f.liters) ?? 0, amount_cents: parseReais(f.amount) ?? 0, station: f.station.trim() }));
  const expenses: ExpenseInput[] = d.expenses.map((e) => ({
    kind: e.kind as ExpenseInput["kind"], amount_cents: parseReais(e.amount) ?? 0, ...(e.note.trim() ? { note: e.note.trim() } : {})
  }));
  return {
    odometer_start: Number(d.odometerStart), odometer_end: Number(d.odometerEnd),
    ...(fuel.length > 0 ? { fuel } : {}), ...(expenses.length > 0 ? { expenses } : {})
  };
}

// ─── Recusas do api ─────────────────────────────────────────────────────────
const ERRORS: Record<string, string> = {
  vehicle_overlap: "o veículo já está em outra viagem nesse horário",
  driver_overlap: "o motorista já está em outra viagem nesse horário",
  driver_license_expired: "a CNH deste motorista está vencida na data da viagem",
  driver_license_category: "veículo com mais de 8 lugares exige CNH D ou E",
  driver_inactive: "este motorista está inativo",
  vehicle_inactive: "este veículo está inativo",
  vehicle_required: "escolha o veículo",
  driver_required: "escolha o motorista",
  return_before_departure: "o retorno precisa ser depois da saída",
  trip_day_locked: "a viagem tem passageiro de série ou trecho de TFD — mude só o horário",
  stop_not_boarding: "a parada escolhida não é de embarque",
  stop_in_use: "esta parada tem passageiro — mude o passageiro de parada antes",
  trip_not_open: "a viagem não aceita mais alteração (já começou, foi concluída ou cancelada) — recarregue",
  invalid_transition: "a viagem mudou de situação — recarregue",
  trip_not_today: "a viagem só começa no dia dela",
  seats_full: "a viagem está lotada",
  wheelchair_full: "não há vaga de cadeirante nesta viagem",
  companion_not_allowed: "acompanhante fora da regra da cidade — informe o motivo",
  origin_required: "informe o atendimento marcado ou o motivo da viagem sem atendimento",
  origin_mismatch: "o atendimento escolhido não é deste paciente",
  patient_already_on_trip: "este paciente já está nesta viagem",
  passenger_anonymized: "o cadastro deste passageiro foi anonimizado — não dá para alterar",
  attendance_pending: "marque embarcou ou faltou para todos, inclusive acompanhantes",
  odometer_invalid: "confira o odômetro de saída e de chegada",
  tfd_leg_done: "o trecho de TFD deste passageiro já foi cumprido — a presença não pode mudar",
  plate_taken: "já existe um veículo com esta placa",
  renavam_taken: "já existe um veículo com este RENAVAM",
  ibge_taken: "já existe um destino com este código IBGE",
  user_not_driver: "esta pessoa não tem o papel de motorista na Equipe",
  user_already_driver: "esta pessoa já está cadastrada como motorista",
  citizen_not_verified: "o CPF ainda não foi conferido no cadastro nacional — tente de novo mais tarde",
  person_not_found: "não encontramos ninguém com este CPF",
  invalid_cpf: "CPF inválido — confira os 11 dígitos",
  too_many_requests: "muitas buscas em pouco tempo — espere um minuto",
  not_found: "não encontrado — a tela foi atualizada",
  billing_unit_invalid: "a unidade de faturamento do TFD precisa ser a gestão de saúde, com CNES — e é obrigatória enquanto o faturamento de procedimentos estiver ligado",
  unauthenticated: "sua sessão terminou — entre de novo",
  mfa_required: "confirme sua identidade com o código do autenticador e tente de novo",
  missing_role: "seu papel não permite esta ação"
};

const INVALID_REQUEST_TEXT = "pedido inválido — recarregue a tela e tente de novo";
const PATH_RULES: [ RegExp, string ][] = [
  [ /^fuel(\.|$)/, "confira o abastecimento destacado" ],
  [ /^expenses(\.|$)/, "confira a despesa destacada" ],
  [ /^companion(\.|$)/, "confira os dados do acompanhante" ],
  [ /^stops(\.|$)/, "confira as paradas da viagem" ],
  [ /^items(\.|$)/, "confira o item destacado" ],
  [ /reason/, "o motivo tem de 10 a 500 caracteres" ]
];

function invalidRequestText(path: string): string {
  return PATH_RULES.find(([ re ]) => re.test(path))?.[1] ?? INVALID_REQUEST_TEXT;
}

// Todas as recusas, traduzidas (uma por `problems[]`; sem ele, a do topo). Código que o transporte não manda aparece cru, nunca com a frase de outro módulo.
export function transportRefusals(err: unknown): Refusal[] {
  const feature = featureDisabledKey(err);
  if (feature !== null) {
    const text = feature === "" || feature === "sanitary_transport" ? TRANSPORT_DISABLED : `${featureLabel(feature)} está desligado nesta cidade`;
    return [ { path: "", code: "feature_disabled", text } ];
  }
  const online = err instanceof ApiError;
  return pharmacyRefusals(err).map((r) => {
    if (r.code === "invalid_request") return { ...r, text: invalidRequestText(r.path) };
    if (Object.prototype.hasOwnProperty.call(ERRORS, r.code)) return { ...r, text: ERRORS[r.code] };
    if (online && r.code !== "") return { ...r, text: `recusado pelo servidor (${r.code})` };
    return r;
  });
}

export function transportError(err: unknown): string {
  return transportRefusals(err)[0].text;
}
