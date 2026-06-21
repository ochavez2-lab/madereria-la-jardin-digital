self.addEventListener('push', (event) => {
  let data = { title: '🔔 Maderería La Jardín', body: 'Tienes un mensaje nuevo del equipo.' };
  try { if (event.data) data = event.data.json(); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://cdn-icons-png.flaticon.com/512/1632/1632662.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/1632/1632662.png',
      data: { url: self.registration.scope + 'leads.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './leads.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if (c.url.includes('leads.html') && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
