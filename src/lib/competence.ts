// src/lib/competence.ts
// Competência AAAAMM (mês de produção do SISAB; módulo 16). Aritmética por
// texto, a partir do dia da CIDADE (todayInCity): às 22h30 de 31/10 em São
// Paulo já é novembro em UTC, e a competência ainda é outubro.
export function isCompetence(value: string): boolean {
  return /^\d{4}(0[1-9]|1[0-2])$/.test(value);
}

export function competenceLabel(c: string): string {
  return isCompetence(c) ? `${c.slice(4)}/${c.slice(0, 4)}` : c;
}

// "YYYY-MM-DD" → "YYYYMM".
export function competenceOf(today: string): string {
  return `${today.slice(0, 4)}${today.slice(5, 7)}`;
}

export function recentCompetences(today: string, count = 13): string[] {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${year}${String(month).padStart(2, "0")}`);
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return out;
}

// As recentes, mais a que a API respondeu se ela não estiver entre elas.
export function competenceOptions(today: string, extra: string | null | undefined): string[] {
  const list = recentCompetences(today);
  if (extra && isCompetence(extra) && !list.includes(extra)) list.push(extra);
  return list.sort((a, b) => b.localeCompare(a));
}
