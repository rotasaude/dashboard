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
