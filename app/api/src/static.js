// 画面（Expo の Web 書き出し）を同じサーバーから配る。環境変数 STATIC_DIR があるときだけ有効（既定は配らない）。
// /api で始まらない GET／HEAD だけが対象。存在しないパスは index.html（画面の側の道順に任せる）。
// ディレクトリの外には出さない（パスの正規化・'..'・バックスラッシュ・NUL の拒否、解決後の実パスが中かの確認）。
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};
// 長めに持たせる種類（js・css・画像・フォント）。index.html は毎回確かめさせる。それ以外は短く。
const LONG_CACHE = new Set(['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2']);

export function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function cacheControl(ext, isIndex) {
  if (isIndex) return 'no-cache';
  return LONG_CACHE.has(ext) ? 'public, max-age=86400' : 'no-cache';
}

function notFound(res) {
  const text = JSON.stringify({ error: { code: 'not_found', message: '見つかりません' } });
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function statFile(p) {
  try {
    const st = fs.statSync(p);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

// dir が空なら null（配らない）。あれば (req, res, pathname) => boolean（応答したら true）を返す。
export function createStaticHandler(dir) {
  if (!dir) return null;
  // 起動時に実在を確かめる（無ければここで落とす）。以後は実パスの中かどうかだけを見る。
  const root = fs.realpathSync(path.resolve(dir));
  const indexPath = path.join(root, 'index.html');

  function send(req, res, file, st) {
    const ext = path.extname(file).toLowerCase();
    const isIndex = file === indexPath;
    res.writeHead(200, {
      'content-type': TYPES[ext] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': cacheControl(ext, isIndex),
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  return function serve(req, res, pathname) {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || isApiPath(pathname)) return false;

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      notFound(res);
      return true;
    }
    // 外へ出ようとする形はその場で断る（普通の書き出しには現れない）。
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
      notFound(res);
      return true;
    }

    let file = null;
    let st = null;
    const candidate = path.join(root, decoded);
    if (candidate === root || candidate.startsWith(root + path.sep)) {
      try {
        const real = fs.realpathSync(candidate); // シンボリックリンクを解いた先
        const s = fs.statSync(real);
        if (s.isFile()) {
          if (real !== root && !real.startsWith(root + path.sep)) {
            notFound(res); // リンク経由で外を指している
            return true;
          }
          file = real;
          st = s;
        }
      } catch {
        // 無い → 戻り先
      }
    }
    if (!file) {
      st = statFile(indexPath);
      if (!st) {
        notFound(res);
        return true;
      }
      file = indexPath;
    }
    send(req, res, file, st);
    return true;
  };
}
