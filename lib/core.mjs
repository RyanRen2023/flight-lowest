import { createHash } from 'node:crypto';

const DAY = 86400000;
export function dateNumber(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  const n = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== s) throw new Error(`Invalid date: ${s}`);
  return n;
}
export const dateString = n => new Date(n).toISOString().slice(0, 10);
export function validate(c) {
  const start = dateNumber(c.startDate), end = dateNumber(c.endDate);
  if (end < start) throw new Error('The end date is earlier than the start date');
  if (!Number.isInteger(c.minStayDays) || !Number.isInteger(c.maxStayDays) || c.minStayDays < 1 || c.maxStayDays < c.minStayDays) throw new Error('Invalid stay duration');
  if (c.adults !== 1 || c.origin !== 'yow0' || c.destination !== 'bjs' || c.cabin !== 'y_s' || c.currency !== 'CNY') throw new Error('This adapter supports Ottawa–Beijing, 1 adult, economy/premium economy, and CNY fares');
  for (const key of ['requestGapSeconds', 'pageTimeoutSeconds', 'freshHours']) if (!Number.isFinite(c[key]) || c[key] <= 0) throw new Error(`${key} must be greater than zero`);
  if (!['chrome', 'chromium'].includes(c.browserChannel)) throw new Error('browserChannel must be chrome or chromium');
}
export function plan(c) {
  validate(c);
  const jobs = [];
  for (let d = dateNumber(c.startDate); d <= dateNumber(c.endDate); d += DAY) {
    for (let stay = c.minStayDays; stay <= c.maxStayDays; stay++) {
      const r = d + stay * DAY;
      if (r > dateNumber(c.endDate)) break;
      const departure = dateString(d), returning = dateString(r);
      const params = new URLSearchParams({ depdate: `${departure}_${returning}`, cabin: c.cabin, adult: String(c.adults), child: '0', infant: '0', containstax: '1' });
      jobs.push({ id: `${departure}_${returning}`, departure, returning, stayDays: stay, url: `https://flights.ctrip.com/online/list/round-${c.origin}-${c.destination}?${params}` });
    }
  }
  return jobs;
}
export function scopeHash(c) {
  const keys = ['startDate', 'endDate', 'minStayDays', 'maxStayDays', 'adults', 'origin', 'destination', 'cabin', 'currency'];
  return createHash('sha256').update(JSON.stringify(keys.map(k => [k,c[k]]))).digest('hex').slice(0,16);
}
export function fare(text) {
  // Only accept the explicit round-trip tax-inclusive CNY label, never calendar estimates.
  const cleaned = text.replace(/\s+/g, '');
  const match = cleaned.match(/[¥￥]([\d,]+(?:\.\d{1,2})?)(?:起)?往返含税价/);
  if (!match) return null;
  const value = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}
export function summarize(jobs, records, c, now = Date.now()) {
  const latest = new Map();
  for (const r of records) latest.set(r.id, r);
  const valid = jobs.map(j => latest.get(j.id)).filter(r => r && r.status === 'confirmed' && Number.isFinite(r.priceCNY) && r.priceCNY > 0 && now - Date.parse(r.checkedAt) <= c.freshHours * 3600000);
  const ranked = [...valid].sort((a,b) => a.priceCNY-b.priceCNY || a.departure.localeCompare(b.departure) || a.returning.localeCompare(b.returning));
  // A negative result is not proof of no availability: never count it as complete coverage.
  return { total: jobs.length, confirmed: valid.length, pending: jobs.length-valid.length, complete: jobs.length > 0 && valid.length === jobs.length, best: ranked[0] ?? null, ranked, latest };
}
export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"','""')}"`;
}
