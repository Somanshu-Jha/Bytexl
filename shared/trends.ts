import type { HealthRecord } from './types';

/** Compare only dated, unambiguous HbA1c percentages; same-day uploads are not new visits. */
export function hba1cTrend(records: HealthRecord[]): { value: number; date: string }[] {
  const dated = new Map<string, Set<number>>();
  const ambiguousDates = new Set<string>();
  for (const record of records) {
    if (!record.date) continue;
    const rows = record.observations.filter(o => /^(?:hba1c|glycated hemoglobin)(?:\s*\([^)]*\))?$/i.test(o.name.trim()));
    if (rows.length > 1) { ambiguousDates.add(record.date); continue; }
    const row = rows[0];
    if (!row || row.value === null || !Number.isFinite(row.value) || row.unit.trim() !== '%') continue;
    const values = dated.get(record.date) || new Set<number>(); values.add(row.value); dated.set(record.date, values);
  }
  return [...dated.entries()].filter(([date,values]) => !ambiguousDates.has(date) && values.size === 1)
    .sort(([a],[b]) => a.localeCompare(b)).map(([date, values]) => ({date,value:[...values][0]}));
}
