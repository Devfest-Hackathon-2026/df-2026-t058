import { HttpError } from '../http.js';

// 入力の検査。失敗は 400 invalid_argument（契約 §2）。
const bad = (field, why) => new HttpError(400, 'invalid_argument', `${field}: ${why}`);

export function body(b) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw bad('body', 'object が必要です');
  return b;
}

export function str(v, field, { min = 1, max = 1000, optional = false } = {}) {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string') throw bad(field, 'string が必要です');
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(field, `${min}〜${max} 文字にしてください`);
  return t;
}

export function num(v, field, { min = -Infinity, max = Infinity, int = false, optional = false } = {}) {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v) || (int && !Number.isInteger(v))) throw bad(field, '数が必要です');
  if (v < min || v > max) throw bad(field, `${min}〜${max} にしてください`);
  return v;
}

export function oneOf(v, field, values, { optional = false } = {}) {
  if (v === undefined && optional) return undefined;
  if (!values.includes(v)) throw bad(field, `${values.join('|')} のどれか`);
  return v;
}

export function isoDate(v, field, { optional = false } = {}) {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) throw bad(field, 'ISO 8601 の日時が必要です');
  return new Date(v).toISOString();
}

export function bool(v, field, { optional = false } = {}) {
  if (v === undefined && optional) return undefined;
  if (typeof v !== 'boolean') throw bad(field, 'boolean が必要です');
  return v;
}
