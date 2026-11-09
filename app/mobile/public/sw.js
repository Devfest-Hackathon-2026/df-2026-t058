// 通知だけの Service Worker（#212）。キャッシュはしない。
// サーバーの本文（契約 §3.7c）は JSON { title, body, url }。題はアプリ名、本文は受けた文字列を出す。
const APP_NAME = 'モル塔';
const ICON = '/favicon.svg';

self.addEventListener('push', (event) => {
  let body = '';
  if (event.data) {
    try {
      const d = event.data.json();
      body = typeof d.body === 'string' ? d.body : '';
    } catch (e) {
      body = event.data.text();
    }
  }
  event.waitUntil(self.registration.showNotification(APP_NAME, { body, icon: ICON }));
});

// 押したら今日の画面（/）を開く。開いている画面があれば、それを前に出す
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          // navigate は、この SW が見ていない画面では失敗する（その時は前に出すだけ）
          return c
            .focus()
            .then((w) => (w && 'navigate' in w ? w.navigate('/') : w))
            .catch(() => undefined);
        }
      }
      return self.clients.openWindow('/');
    }),
  );
});
