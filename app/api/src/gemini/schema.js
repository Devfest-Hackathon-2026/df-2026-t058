// 最小の形の検査（JSON Schema の一部だけ）。Gemini の出力は必ずこれを通してから使う。
// 対応: type(object/array/string/number/integer/boolean) / properties / required / items / enum
export function validate(schema, value, path = '$') {
  const err = (m) => [`${path}: ${m}`];
  if (schema.enum) return schema.enum.includes(value) ? [] : err('許可された値ではありません');
  switch (schema.type) {
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return err('object ではありません');
      const errors = [];
      for (const k of schema.required || []) if (!(k in value)) errors.push(...err(`${k} がありません`));
      for (const [k, s] of Object.entries(schema.properties || {})) {
        if (k in value) errors.push(...validate(s, value[k], `${path}.${k}`));
      }
      return errors;
    }
    case 'array':
      if (!Array.isArray(value)) return err('array ではありません');
      return schema.items ? value.flatMap((v, i) => validate(schema.items, v, `${path}[${i}]`)) : [];
    case 'string':
      return typeof value === 'string' ? [] : err('string ではありません');
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? [] : err('number ではありません');
    case 'integer':
      return Number.isInteger(value) ? [] : err('integer ではありません');
    case 'boolean':
      return typeof value === 'boolean' ? [] : err('boolean ではありません');
    default:
      return [];
  }
}

// 偽の応答用: スキーマに合う最小の見本を作る（中身の文は決めない）。
export function sample(schema) {
  if (schema.enum) return schema.enum[0];
  switch (schema.type) {
    case 'object':
      return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, s]) => [k, sample(s)]));
    case 'array':
      return schema.items ? [sample(schema.items)] : [];
    case 'string':
      return 'sample';
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    default:
      return null;
  }
}
