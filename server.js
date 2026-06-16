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
    UNIQUE (numero, fecha_contacto)
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
      const r = await pool.query(
        `INSERT INTO leads_historial
          (numero,categoria,fecha_pub,dia_horario,contexto,fecha_contacto,metodo,sms_enviado,fecha_sms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (numero, fecha_contacto) DO NOTHING`,
        [e.numero, e.categoria||null, e.fecha_pub||null, e.dia_horario||null,
         (e.contexto||'').slice(0,200), e.fecha_contacto, e.metodo||'whatsapp',
         !!e.sms_enviado, e.fecha_sms||null]
      );
      inserted += r.rowCount;
    }
    res.json({ ok: true, inserted });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/all', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT numero,categoria,fecha_pub,dia_horario,contexto,fecha_contacto,metodo,sms_enviado,fecha_sms FROM leads_historial ORDER BY fecha_contacto'
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Madereria sync on port', PORT));
