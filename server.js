const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// Claves VAPID: identifican a este servidor ante los servicios de push
// (Google, Apple, etc). Se pueden sobreescribir con variables de entorno en
// Railway, pero llevan un valor por defecto para que el push funcione sin
// configuración extra.
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BKqQ-4KK8ypsSDULGpsGuZdjlqncIL1n1gL_1VVQrYALZp_6mmOimFXcBR3rcKDvwhyQWwE4UlTbe6-sbk4d8vs';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'HfgLZ5gTA_CQWn5OOgNZkTTBMeHMtbgVi_qSTK5ew4w';
webpush.setVapidDetails('mailto:contacto@madereriajardin.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

pool.query(`
  CREATE TABLE IF NOT EXISTS leads_historial (
    id BIGSERIAL PRIMARY KEY,
    numero TEXT NOT NULL,
    categoria TEXT,
    fecha_pub TEXT,
    dia_horario TEXT,
    contexto TEXT,
    fecha_contacto TEXT NOT NULL,
    metodo TEXT DEFAULT 'whatsapp',
    sms_enviado BOOLEAN DEFAULT FALSE,
    fecha_sms TEXT,
    seguimiento TEXT DEFAULT 'pendiente',
    UNIQUE (numero, fecha_contacto)
  )
`).then(() => pool.query(`
  ALTER TABLE leads_historial ADD COLUMN IF NOT EXISTS seguimiento TEXT DEFAULT 'pendiente'
`)).then(() => pool.query(`
  ALTER TABLE leads_historial ADD COLUMN IF NOT EXISTS nota TEXT
`)).then(() => pool.query(`
  ALTER TABLE leads_historial ADD COLUMN IF NOT EXISTS post_url TEXT
`)).then(() => pool.query(`
  ALTER TABLE leads_historial ADD COLUMN IF NOT EXISTS grupo TEXT
`)).then(() => pool.query(`
  ALTER TABLE leads_historial ADD COLUMN IF NOT EXISTS autor_nombre TEXT
`)).catch(console.error);

pool.query(`
  CREATE TABLE IF NOT EXISTS mensajes_equipo (
    id BIGSERIAL PRIMARY KEY,
    dispositivo_id TEXT NOT NULL,
    autor_nombre TEXT,
    autor_numero TEXT,
    tipo TEXT DEFAULT 'mensaje',
    contenido TEXT NOT NULL,
    fecha_envio TEXT NOT NULL
  )
`).then(() => pool.query(`
  ALTER TABLE mensajes_equipo ADD COLUMN IF NOT EXISTS completado BOOLEAN DEFAULT FALSE
`)).catch(console.error);

// "Tumbas" de contactos eliminados: sin esto, un dispositivo que ya
// sincronizó un contacto ANTES de que se borrara en otro celular se lo queda
// guardado en su localStorage, y cada vez que sincroniza (cada 10s) lo
// vuelve a subir como si fuera nuevo — el contacto "revive" para todo el
// equipo. Guardar aquí qué se borró deja que /api/sync rechace para siempre
// cualquier intento de volver a insertar esa misma clave (numero+fecha).
pool.query(`
  CREATE TABLE IF NOT EXISTS leads_eliminados (
    numero TEXT NOT NULL,
    fecha_contacto TEXT NOT NULL,
    eliminado_en TEXT NOT NULL,
    PRIMARY KEY (numero, fecha_contacto)
  )
`).catch(console.error);

pool.query(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id BIGSERIAL PRIMARY KEY,
    dispositivo_id TEXT NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    creado_en TEXT NOT NULL
  )
`).catch(console.error);

// Publicaciones de Facebook (u otros grupos) de donde salen los leads,
// guardadas para todo el equipo a lo largo del día, para no tener que
// volver a buscar el post original cuando alguien quiere revisarlo.
pool.query(`
  CREATE TABLE IF NOT EXISTS publicaciones (
    id BIGSERIAL PRIMARY KEY,
    dispositivo_id TEXT NOT NULL,
    autor_nombre TEXT,
    url TEXT NOT NULL,
    categoria TEXT,
    nota TEXT,
    fecha TEXT NOT NULL
  )
`).catch(console.error);
// Cuando la publicación es un "anzuelo" que uno mismo sube (pestaña 8:
// Temas para publicar, haciéndose pasar por alguien que busca un maestro),
// se registra con estos datos extra: con qué cuenta de Facebook se publicó
// y en qué grupo, para llevar control de cuáles cuentas/grupos ya se usaron.
pool.query(`ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS propia BOOLEAN DEFAULT false`).catch(console.error);
pool.query(`ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS cuenta_fb TEXT`).catch(console.error);
pool.query(`ALTER TABLE publicaciones ADD COLUMN IF NOT EXISTS grupo TEXT`).catch(console.error);

// Las cuentas (nombre/número/tipo de WhatsApp) viven solo en el localStorage
// de cada navegador, así que si alguien registra una cuenta en un Chrome no
// aparece en el menú "🔄 Cambiar de cuenta" de otro Chrome/celular distinto.
// Esta tabla guarda un directorio compartido de TODAS las cuentas que se han
// registrado en cualquier dispositivo, solo para poder listarlas y que cada
// persona elija cuáles importar a su propio navegador — no reemplaza el
// localStorage de nadie, solo permite "copiar" cuentas ya existentes.
pool.query(`
  CREATE TABLE IF NOT EXISTS cuentas_conocidas (
    nombre TEXT PRIMARY KEY,
    numero TEXT,
    tipo TEXT,
    actualizado_en TEXT NOT NULL
  )
`).catch(console.error);

app.get('/ping', (req, res) => res.json({ ok: true }));

app.get('/api/keys', async (req, res) => {
  try {
    const r = await pool.query('SELECT numero, fecha_contacto FROM leads_historial');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sync', async (req, res) => {
  const entries = req.body;
  if (!Array.isArray(entries) || entries.length === 0) return res.json({ ok: true, inserted: 0 });
  try {
    let inserted = 0;
    for (const e of entries) {
      if (!e.numero || !e.fecha_contacto) continue;
      const tumba = await pool.query(
        'SELECT 1 FROM leads_eliminados WHERE numero=$1 AND fecha_contacto=$2',
        [e.numero, e.fecha_contacto]
      );
      if (tumba.rowCount > 0) continue;
      const r = await pool.query(
        `INSERT INTO leads_historial
          (numero,categoria,fecha_pub,dia_horario,contexto,fecha_contacto,metodo,sms_enviado,fecha_sms,seguimiento,nota,post_url,grupo,autor_nombre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (numero, fecha_contacto) DO NOTHING`,
        [e.numero, e.categoria||null, e.fecha_pub||null, e.dia_horario||null,
         (e.contexto||'').slice(0,200), e.fecha_contacto, e.metodo||'whatsapp',
         !!e.sms_enviado, e.fecha_sms||null, e.seguimiento||'pendiente', e.nota||null, e.post_url||null, e.grupo||null, e.autor_nombre||null]
      );
      inserted += r.rowCount;
    }
    res.json({ ok: true, inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/seguimiento', async (req, res) => {
  const { numero, fecha_contacto, seguimiento } = req.body || {};
  if (!numero || !fecha_contacto || !seguimiento) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query(
      'UPDATE leads_historial SET seguimiento=$1 WHERE numero=$2 AND fecha_contacto=$3',
      [seguimiento, numero, fecha_contacto]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/categoria', async (req, res) => {
  const { numero, fecha_contacto, categoria } = req.body || {};
  if (!numero || !fecha_contacto || !categoria) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query(
      'UPDATE leads_historial SET categoria=$1 WHERE numero=$2 AND fecha_contacto=$3',
      [categoria, numero, fecha_contacto]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/metodo', async (req, res) => {
  const { numero, fecha_contacto, metodo } = req.body || {};
  if (!numero || !fecha_contacto || !metodo) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query(
      'UPDATE leads_historial SET metodo=$1 WHERE numero=$2 AND fecha_contacto=$3',
      [metodo, numero, fecha_contacto]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/nota', async (req, res) => {
  const { numero, fecha_contacto, nota } = req.body || {};
  if (!numero || !fecha_contacto) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query(
      'UPDATE leads_historial SET nota=$1 WHERE numero=$2 AND fecha_contacto=$3',
      [nota || null, numero, fecha_contacto]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sms', async (req, res) => {
  const { numero, fecha_contacto, enviado } = req.body || {};
  if (!numero || !fecha_contacto) return res.status(400).json({ error: 'faltan datos' });
  try {
    if (enviado === false){
      await pool.query(
        "UPDATE leads_historial SET sms_enviado=FALSE, fecha_sms=NULL WHERE numero=$1 AND fecha_contacto=$2",
        [numero, fecha_contacto]
      );
    } else {
      await pool.query(
        "UPDATE leads_historial SET sms_enviado=TRUE, fecha_sms=$1 WHERE numero=$2 AND fecha_contacto=$3",
        [new Date().toISOString(), numero, fecha_contacto]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cuando alguien cambia su nombre registrado en "5. Mensajes" (ej. se le
// puso mal, o quiere usar otro), esto re-etiqueta TODO lo que ya había
// contactado con el nombre anterior, para que no se pierda su historial ni
// quede repartido entre "dos personas" distintas en el ranking.
app.post('/api/renombrar-autor', async (req, res) => {
  const { nombreAnterior, nombreNuevo } = req.body || {};
  if (!nombreAnterior || !nombreNuevo) return res.status(400).json({ error: 'faltan datos' });
  try {
    const r1 = await pool.query(
      'UPDATE leads_historial SET autor_nombre=$1 WHERE autor_nombre=$2',
      [nombreNuevo, nombreAnterior]
    );
    const r2 = await pool.query(
      'UPDATE mensajes_equipo SET autor_nombre=$1 WHERE autor_nombre=$2',
      [nombreNuevo, nombreAnterior]
    );
    res.json({ ok: true, historial: r1.rowCount, mensajes: r2.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Borra una cuenta de raíz: le quita el nombre a todos sus contactos pasados
// (quedan "sin registrar", no se borran los leads) y la saca del directorio
// compartido de cuentas. Para limpiar nombres duplicados/viejos del ranking
// (ej. cuando un dispositivo se reinstaló con un nombre genérico distinto).
app.post('/api/eliminar-autor', async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'faltan datos' });
  try {
    const r1 = await pool.query('UPDATE leads_historial SET autor_nombre=NULL WHERE autor_nombre=$1', [nombre]);
    const r2 = await pool.query('UPDATE mensajes_equipo SET autor_nombre=NULL WHERE autor_nombre=$1', [nombre]);
    await pool.query('DELETE FROM cuentas_conocidas WHERE nombre=$1', [nombre]);
    res.json({ ok: true, historial: r1.rowCount, mensajes: r2.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/eliminar', async (req, res) => {
  const { numero, fecha_contacto } = req.body || {};
  if (!numero || !fecha_contacto) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query(
      'DELETE FROM leads_historial WHERE numero=$1 AND fecha_contacto=$2',
      [numero, fecha_contacto]
    );
    await pool.query(
      `INSERT INTO leads_eliminados (numero, fecha_contacto, eliminado_en) VALUES ($1,$2,$3)
       ON CONFLICT (numero, fecha_contacto) DO NOTHING`,
      [numero, fecha_contacto, new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// El resto de dispositivos consultan esto al sincronizar para purgar de su
// propio localStorage cualquier contacto que ya se borró en otro lado.
app.get('/api/eliminados', async (req, res) => {
  try {
    const r = await pool.query('SELECT numero, fecha_contacto FROM leads_eliminados');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/all', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT numero,categoria,fecha_pub,dia_horario,contexto,fecha_contacto,metodo,sms_enviado,fecha_sms,seguimiento,nota,post_url,grupo,autor_nombre FROM leads_historial ORDER BY fecha_contacto'
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mensajes', async (req, res) => {
  const { dispositivo_id, autor_nombre, autor_numero, tipo, contenido, fecha_envio } = req.body || {};
  if (!dispositivo_id || !contenido || !fecha_envio) return res.status(400).json({ error: 'faltan datos' });
  try {
    const r = await pool.query(
      `INSERT INTO mensajes_equipo (dispositivo_id, autor_nombre, autor_numero, tipo, contenido, fecha_envio)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [dispositivo_id, autor_nombre || null, autor_numero || null, tipo || 'mensaje', contenido, fecha_envio]
    );
    res.json({ ok: true, id: r.rows[0].id });
    notificarMensajeNuevo(dispositivo_id, autor_nombre, tipo || 'mensaje', contenido);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Manda una notificación push al resto del equipo (no a quien la escribió),
// para que les llegue aunque tengan la pestaña cerrada o el celular bloqueado.
async function notificarMensajeNuevo(dispositivoQueEnvio, autorNombre, tipo, contenido){
  try {
    const r = await pool.query('SELECT * FROM push_subscriptions WHERE dispositivo_id <> $1', [dispositivoQueEnvio]);
    if (r.rows.length === 0) return;
    const titulo = tipo === 'libreta' ? '📋 Nueva lista en Mensajes' : '💬 Nuevo mensaje en Mensajes';
    const cuerpo = `${autorNombre || 'Alguien'}: ${(contenido || '').slice(0, 120)}`;
    const payload = JSON.stringify({ title: titulo, body: cuerpo });
    await Promise.all(r.rows.map(async (sub) => {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      try {
        await webpush.sendNotification(subscription, payload);
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id=$1', [sub.id]);
        }
      }
    }));
  } catch (e) { console.error('push error', e.message); }
}

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post('/api/push/subscribe', async (req, res) => {
  const { dispositivo_id, subscription } = req.body || {};
  if (!dispositivo_id || !subscription || !subscription.endpoint || !subscription.keys) {
    return res.status(400).json({ error: 'faltan datos' });
  }
  try {
    await pool.query(
      `INSERT INTO push_subscriptions (dispositivo_id, endpoint, p256dh, auth, creado_en)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE SET dispositivo_id=$1, p256dh=$3, auth=$4`,
      [dispositivo_id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/push/unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/mensajes', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, dispositivo_id, autor_nombre, autor_numero, tipo, contenido, fecha_envio, completado FROM mensajes_equipo ORDER BY fecha_envio ASC LIMIT 500'
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/mensajes/eliminar', async (req, res) => {
  const { id, dispositivo_id } = req.body || {};
  if (!id || !dispositivo_id) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query('DELETE FROM mensajes_equipo WHERE id=$1 AND dispositivo_id=$2', [id, dispositivo_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Cualquiera del equipo puede marcar/desmarcar una lista como completada
// (no solo quien la subió), porque es un recordatorio de trabajo compartido:
// si Brayan ya le mandó el mensaje a toda la lista, el resto del equipo debe
// verlo reflejado de inmediato sin importar en qué celular/navegador esté.
app.post('/api/mensajes/completar', async (req, res) => {
  const { id, completado } = req.body || {};
  if (!id) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query('UPDATE mensajes_equipo SET completado=$1 WHERE id=$2', [!!completado, id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/publicaciones', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, dispositivo_id, autor_nombre, url, categoria, nota, fecha, propia, cuenta_fb, grupo FROM publicaciones ORDER BY fecha DESC LIMIT 300'
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/publicaciones', async (req, res) => {
  const { dispositivo_id, autor_nombre, url, categoria, nota, fecha, propia, cuenta_fb, grupo } = req.body || {};
  if (!dispositivo_id || !url || !fecha) return res.status(400).json({ error: 'faltan datos' });
  try {
    const r = await pool.query(
      `INSERT INTO publicaciones (dispositivo_id, autor_nombre, url, categoria, nota, fecha, propia, cuenta_fb, grupo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [dispositivo_id, autor_nombre || null, url, categoria || null, nota || null, fecha, !!propia, cuenta_fb || null, grupo || null]
    );
    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/publicaciones/eliminar', async (req, res) => {
  const { id, dispositivo_id } = req.body || {};
  if (!id || !dispositivo_id) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query('DELETE FROM publicaciones WHERE id=$1 AND dispositivo_id=$2', [id, dispositivo_id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// El directorio "cuentas_conocidas" solo se llena hacia adelante (cuando
// alguien registra/edita una cuenta DESPUÉS de que existe esta tabla), así
// que de entrada está vacío aunque ya haya cuentas usándose desde antes —
// esas ya quedaron guardadas como autor_nombre en leads_historial y
// mensajes_equipo. Por eso esta lista junta las dos fuentes: lo que ya se
// sincronizó al directorio Y todo nombre que alguna vez contactó un lead o
// envió un mensaje, para que "Ver cuentas de otros Chrome" sí las muestre.
app.get('/api/cuentas', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT nombre, MAX(numero) AS numero, MAX(tipo) AS tipo FROM (
        SELECT nombre, numero, tipo FROM cuentas_conocidas
        UNION ALL
        SELECT DISTINCT autor_nombre AS nombre, NULL AS numero, NULL AS tipo
          FROM leads_historial WHERE autor_nombre IS NOT NULL AND autor_nombre <> ''
        UNION ALL
        SELECT DISTINCT autor_nombre AS nombre, autor_numero AS numero, NULL AS tipo
          FROM mensajes_equipo WHERE autor_nombre IS NOT NULL AND autor_nombre <> ''
      ) t
      GROUP BY nombre ORDER BY nombre
    `);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/cuentas', async (req, res) => {
  const { nombre, numero, tipo } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query(
      `INSERT INTO cuentas_conocidas (nombre, numero, tipo, actualizado_en)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (nombre) DO UPDATE SET numero=$2, tipo=$3, actualizado_en=$4`,
      [nombre, numero || null, tipo || null, new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Madereria sync on port', PORT));
