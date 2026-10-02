// Formatação PT-BR no fuso da cidade. Núcleo enxuto — o objetivo é que
// nenhum componente faça `toLocaleString` direto sem passar por aqui.
//
// O fuso vem da sessão (GET /session → time_zone, api#27): AuthProvider chama
// setCityTimeZone ao autenticar. Até lá, o horário de Brasília.

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const LOCALE = "pt-BR";

let cityTz = DEFAULT_TIME_ZONE;

export function setCityTimeZone(tz: string | null | undefined): void {
  cityTz = tz || DEFAULT_TIME_ZONE;
}

export function cityTimeZone(): string {
  return cityTz;
}

// Intl.DateTimeFormat é caro de montar: um por (locale, opções, fuso).
const dtfCache = new Map<string, Intl.DateTimeFormat>();
export function cityDateFormat(options: Intl.DateTimeFormatOptions, locale = LOCALE): Intl.DateTimeFormat {
  const key = `${locale}|${cityTz}|${JSON.stringify(options)}`;
  let f = dtfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: cityTz });
    dtfCache.set(key, f);
  }
  return f;
}

const numberFmt = new Intl.NumberFormat(LOCALE);
const decimalFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const percentFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

const DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
};
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };

export function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (Number.isInteger(n)) return numberFmt.format(n);
  return decimalFmt.format(n);
}

export function fmtPercent(n: number | null | undefined, unit = "%"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${percentFmt.format(n)}${unit}`;
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return cityDateFormat(DATE_TIME).format(d);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return cityDateFormat(TIME).format(d);
}

// hh:mm, sem segundos — para horários de agendamento e chamada na fila.
const HOUR_MINUTE: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };

export function fmtHourMinute(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return cityDateFormat(HOUR_MINUTE).format(d);
}

// Valor de <input type="datetime-local"> ("2026-09-26T09:00") lido como hora
// de parede da cidade (fuso da sessão), não do navegador: `new Date(value)` usaria o fuso
// da máquina e uma recepção em outro fuso marcaria a hora errada.
const OFFSET_PARTS: Intl.DateTimeFormatOptions = {
  hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
};

function cityOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(cityDateFormat(OFFSET_PARTS, "en-US").formatToParts(new Date(utcMs)).map((x) => [ x.type, x.value ]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - utcMs;
}

export function parseCityLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const guess = wall - cityOffsetMs(wall);
  return new Date(wall - cityOffsetMs(guess));
}

// Mesmo valor como ISO com o deslocamento da cidade ("2026-10-05T07:00:00-03:00"),
// para a API receber a hora de parede sem depender do fuso da máquina.
export function cityLocalIso(value: string): string | null {
  const at = parseCityLocal(value);
  if (!at) return null;
  const min = Math.round(cityOffsetMs(at.getTime()) / 60000);
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function fmtRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffS = Math.round((now.getTime() - d.getTime()) / 1000);
  if (Number.isNaN(diffS)) return "—";
  if (diffS < 60)  return `há ${diffS}s`;
  if (diffS < 3600) return `há ${Math.round(diffS / 60)} min`;
  if (diffS < 86400) return `há ${Math.round(diffS / 3600)} h`;
  return fmtDateTime(iso);
}

export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—";
  if (seconds < 60)    return `${seconds}s`;
  if (seconds < 3600)  return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

// "GMT-3", "GMT-4"… para rotular relógios e horários.
export function cityOffsetLabel(at: Date = new Date()): string {
  const part = cityDateFormat({ timeZoneName: "shortOffset" }, "en-US").formatToParts(at)
    .find((x) => x.type === "timeZoneName");
  return part?.value ?? cityTz;
}

// Data local da cidade em YYYY-MM-DD (o formato do <input type="date">).
export function cityIsoDate(at: Date = new Date()): string {
  return cityDateFormat({ year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA").format(at);
}
