const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

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

app.post('/api/eliminar', async (req, res) => {
  const { numero, fecha_contacto } = req.body || {};
  if (!numero || !fecha_contacto) return res.status(400).json({ error: 'faltan datos' });
  try {
    await pool.query(
      'DELETE FROM leads_historial WHERE numero=$1 AND fecha_contacto=$2',
      [numero, fecha_contacto]
    );
    res.json({ ok: true });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Madereria sync on port', PORT));
