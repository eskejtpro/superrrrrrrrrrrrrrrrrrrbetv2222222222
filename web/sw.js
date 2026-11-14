self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const payload = event.data;
  if (!payload || payload.type !== 'SHOW_NOTIFICATION') return;
  const { title, options } = payload;
  event.waitUntil(self.registration.showNotification(title || 'SUPERBETSSS LIVE', options || {}));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const matchKey = event.notification.data?.matchKey || null;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) {
          client.focus();
        }
        if (matchKey) {
          client.postMessage({ type: 'SELECT_MATCH', matchKey });
        }
        return;
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
      return undefined;
    }),
  );
});
