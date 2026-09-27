// Formatação PT-BR + America/Sao_Paulo. Núcleo enxuto — o objetivo é que
// nenhum componente faça `toLocaleString` direto sem passar por aqui.

const TZ = "America/Sao_Paulo";
const LOCALE = "pt-BR";

const numberFmt = new Intl.NumberFormat(LOCALE);
const decimalFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const percentFmt = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

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
  return dateTimeFmt.format(d);
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return timeFmt.format(d);
}

// hh:mm, sem segundos — para horários de agendamento e chamada na fila.
const hourMinuteFmt = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

export function fmtHourMinute(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return hourMinuteFmt.format(d);
}

// Valor de <input type="datetime-local"> ("2026-09-26T09:00") lido como hora
// de parede da cidade (TZ), não do navegador: `new Date(value)` usaria o fuso
// da máquina e uma recepção em outro fuso marcaria a hora errada.
const offsetFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ, hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
});

function cityOffsetMs(utcMs: number): number {
  const p = Object.fromEntries(offsetFmt.formatToParts(new Date(utcMs)).map((x) => [ x.type, x.value ]));
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

export const TIMEZONE = TZ;
