// Rótulos da fila do posto (spec 6b, FC-07/08/09): chegada curta quando é de
// hoje, selo para quem está na fila desde outro dia, prioridade com nome e a
// pessoa pelo nome quando houver. Dia no fuso da cidade.
import { cityIsoDate, fmtHourMinute } from "./format";
import { ddmm } from "./scheduling";

const DAY_MS = 86_400_000;

function daysBetween(iso: string, now: Date): number {
  const a = Date.parse(`${cityIsoDate(new Date(iso))}T12:00:00Z`);
  const b = Date.parse(`${cityIsoDate(now)}T12:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

export function arrivalLabel(iso: string, now: Date): string {
  const days = daysBetween(iso, now);
  const hour = fmtHourMinute(iso);
  if (days <= 0) return hour;
  if (days === 1) return `ontem ${hour}`;
  return `${ddmm(cityIsoDate(new Date(iso)))} ${hour}`;
}

export function staleArrival(iso: string, now: Date): string | null {
  const days = daysBetween(iso, now);
  if (days <= 0) return null;
  return days === 1 ? "chegou ontem" : `há ${days} dias`;
}

export function priorityLabel(p: number | null | undefined): string {
  return p === null || p === undefined ? "—" : `prioridade ${p}`;
}

export function personLabel(r: { display_name?: string | null; cpf_masked: string }): { title: string; sub: string | null } {
  return r.display_name ? { title: r.display_name, sub: r.cpf_masked } : { title: r.cpf_masked, sub: null };
}
