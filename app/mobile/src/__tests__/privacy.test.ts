// プライバシーポリシー（#238）: 本文の見出し・連絡先、画面とガード、「保存しない」と書いた物をサーバーが保存していないか（原稿の粗い検査）
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (name: string) => any;
declare const __dirname: string;

import { isPublicPath, PRIVACY_CONTACT, PRIVACY_SECTIONS, PRIVACY_TITLE, PRIVACY_UPDATED } from '../lib/privacyText';

const fs = require('fs');
const path = require('path');
const SRC = path.join(__dirname, '..');
const API_SRC = path.join(SRC, '..', '..', 'api', 'src');
const read = (...p: string[]): string => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const all = (): string => PRIVACY_SECTIONS.map((s) => [s.heading, ...s.lines].join('\n')).join('\n');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir) as string[]) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

// store.put(...) / store.append(...) の呼び出しの引数の部分（括弧の対応で切り出す）
function storeCalls(src: string): string[] {
  const out: string[] = [];
  const re = /store\.(put|append)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      const ch = src[i] ?? '';
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

describe('本文（lib/privacyText）', () => {
  test('見出しは 8 個以内で、決めた項目が全部ある', () => {
    const headings = PRIVACY_SECTIONS.map((s) => s.heading);
    expect(headings.length).toBeLessThanOrEqual(8);
    for (const h of ['運営者と連絡先', 'お預かりする情報', '保存しない物', 'Google のデータの扱い', 'AI（Gemini）での処理', '保存先と期間', '削除のご依頼']) {
      expect(headings).toContain(h);
    }
    expect(PRIVACY_TITLE).toBe('プライバシーポリシー');
    expect(PRIVACY_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('運営者と連絡先のメールアドレスが入っている', () => {
    expect(all()).toContain('このアプリ「モル塔」は、チーム「考え続ける」が運営しています');
    expect(PRIVACY_CONTACT).toBe(['y2studyabout', 'gmail.com'].join('@'));
    expect(all()).toContain(PRIVACY_CONTACT);
    const del = PRIVACY_SECTIONS.find((s) => s.heading === '削除のご依頼');
    expect((del?.lines ?? []).join('')).toContain(PRIVACY_CONTACT);
  });

  test('Google のデータ: 読み取り専用・ブラウザで読む・トークンは保存しない・限定的な使用の文', () => {
    const t = all();
    expect(t).toContain('読み取り専用');
    expect(t).toContain('ブラウザ');
    expect(t).toContain('トークン');
    expect(t).toContain('Google API Services User Data Policy, including the Limited Use requirements');
    expect(t).toContain('Vertex AI');
    expect(t).toContain('Firestore');
  });

  test('利用は 18 歳以上（決定 11/9）: ポリシーとログインの画面の両方に書いてある', () => {
    const cond = PRIVACY_SECTIONS.find((s) => s.heading === 'ご利用の条件');
    expect((cond?.lines ?? []).join('')).toContain('18 歳以上');
    const login = read('app', 'login.tsx');
    expect(login).toContain('COPY_AGE_LIMIT');
    expect(login).toContain('testID="login-age"');
  });

  test('空の行・空白だけの行が無い', () => {
    for (const s of PRIVACY_SECTIONS) {
      expect(s.lines.length).toBeGreaterThan(0);
      for (const line of s.lines) expect(line.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('ログイン前に開ける（_layout のガード）', () => {
  test('/privacy だけが公開の道', () => {
    expect(isPublicPath('/privacy')).toBe(true);
    expect(isPublicPath('/privacy/')).toBe(true);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/settings')).toBe(false);
    expect(isPublicPath('/privacyx')).toBe(false);
    expect(isPublicPath(null)).toBe(false);
  });

  test('_layout は公開の道で AuthGate を置かず、privacy の画面を持つ', () => {
    const s = read('app', '_layout.tsx');
    expect(s).toContain('isPublicPath(usePathname())');
    expect(s).toContain('{isPublic ? null : <AuthGate />}');
    expect(s).toContain('name="privacy"');
  });

  test('画面は本文を描くだけで、サーバーを呼ばない', () => {
    const s = read('app', 'privacy.tsx');
    expect(s).toContain('export default function Privacy');
    expect(s).toContain('PRIVACY_SECTIONS.map(');
    expect(s).toContain('PRIVACY_UPDATED');
    expect(s).not.toContain("from '../api'");
  });
});

describe('「保存しない」と書いた物を、サーバーが保存していない（原稿の粗い検査）', () => {
  const files = walk(API_SRC);
  const calls = files.flatMap((f) => storeCalls(fs.readFileSync(f, 'utf8') as string));

  test('保存の呼び出しを拾えている', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(calls.length).toBeGreaterThan(10);
  });

  test('store.put / append に写真・音声・資料のファイル・トークンを渡していない', () => {
    for (const c of calls) {
      // 通知の宛先（FCM の端末登録）だけは、端末の token を持つのが目的。ほかの保存先は従来どおり検査する。
      if (/^\s*COL\.devices\b/.test(c)) continue;
      expect(c).not.toMatch(/\bimages?\b|\baudio\b|\bfiles\b|dataBase64|\btoken\b|access_token|photo/i);
    }
  });

  test('サーバーは Google の API を呼ばない（カレンダー・Classroom はブラウザだけ）', () => {
    for (const f of files) {
      const s = fs.readFileSync(f, 'utf8') as string;
      expect(s).not.toContain('www.googleapis.com/calendar');
      expect(s).not.toContain('classroom.googleapis.com');
    }
  });

  test('Google のトークンは端末にも保存しない（カレンダー・Classroom の部品に保存の呼び出しが無い）', () => {
    for (const f of ['googleCalendar.ts', 'googleClassroom.ts']) {
      const s = read('lib', f);
      expect(s).not.toMatch(/localStorage|sessionStorage/);
    }
    // Classroom は何も保存しない。カレンダーが保存してよいのは「入れた」印（提案の ID）だけ（setItem の相手は ADDED_KEY のみ）
    expect(read('lib', 'googleClassroom.ts')).not.toMatch(/AsyncStorage|setItem\(/);
    const calendar = read('lib', 'googleCalendar.ts');
    const writes = calendar.match(/\.setItem\(([^,)]*),/g) ?? [];
    expect(writes.every((w: string) => w.includes('ADDED_KEY'))).toBe(true);
  });
});
