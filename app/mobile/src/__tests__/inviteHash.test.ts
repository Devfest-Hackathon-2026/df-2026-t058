import { codeFromHash } from '../lib/inviteHash';

describe('codeFromHash', () => {
  it('取り出す', () => {
    expect(codeFromHash('#code=abcd1234')).toBe('abcd1234');
    expect(codeFromHash('code=abcd1234')).toBe('abcd1234');
    expect(codeFromHash('#x=1&code=zz')).toBe('zz');
  });
  it('URL デコードする', () => {
    expect(codeFromHash('#code=a%20b%2Fc')).toBe('a b/c');
  });
  it('無い・空・不正は null', () => {
    expect(codeFromHash('')).toBeNull();
    expect(codeFromHash(null)).toBeNull();
    expect(codeFromHash('#')).toBeNull();
    expect(codeFromHash('#code=')).toBeNull();
    expect(codeFromHash('#codex=abc')).toBeNull();
    expect(codeFromHash('#code')).toBeNull();
    expect(codeFromHash('#code=%E0%A4%A')).toBeNull();
  });
  it('200 字超は null、200 字ちょうどは通す', () => {
    expect(codeFromHash('#code=' + 'a'.repeat(201))).toBeNull();
    expect(codeFromHash('#code=' + 'a'.repeat(200))).toBe('a'.repeat(200));
  });
});
