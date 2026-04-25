const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const crypto   = require('crypto');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB     = path.join(DATA_DIR, 'datos.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

const CAT_MAP = {
  'Barrote 2x4':'Madera','Tablon 2x6':'Madera','Viga 4x4':'Madera',
  'Triplay 3/8':'Triplay','Triplay 1/2':'Triplay','Triplay 5/8':'Triplay',
  'Triplay 3/4':'Triplay','Triplay ranurado':'Triplay',
  'OSB Cimbraplay':'Triplay','Cimbra fenolica':'Triplay',
  'Shingle asfaltico':'Cubiertas','Membrana azul':'Cubiertas','Membrana granular':'Cubiertas'
};

const PRODUCTOS_DEFAULT = [
  {id:1,  nombre:'Barrote 2x4',       medida:'8 pies',    precio:45,  stock:true, categoria:'Madera'},
  {id:2,  nombre:'Barrote 2x4',       medida:'16 pies',   precio:85,  stock:true, categoria:'Madera'},
  {id:3,  nombre:'Barrote 2x4',       medida:'30 pies',   precio:180, stock:true, categoria:'Madera'},
  {id:4,  nombre:'Tablon 2x6',        medida:'16 pies',   precio:140, stock:true, categoria:'Madera'},
  {id:5,  nombre:'Viga 4x4',          medida:'16 pies',   precio:210, stock:true, categoria:'Madera'},
  {id:6,  nombre:'Triplay 3/8',       medida:'4x8 pies',  precio:310, stock:true, categoria:'Triplay'},
  {id:7,  nombre:'Triplay 1/2',       medida:'4x8 pies',  precio:420, stock:true, categoria:'Triplay'},
  {id:8,  nombre:'Triplay 5/8',       medida:'4x8 pies',  precio:425, stock:true, categoria:'Triplay'},
  {id:9,  nombre:'Triplay 3/4',       medida:'4x8 pies',  precio:580, stock:true, categoria:'Triplay'},
  {id:10, nombre:'Triplay ranurado',  medida:'4x8 pies',  precio:390, stock:true, categoria:'Triplay'},
  {id:11, nombre:'OSB Cimbraplay',    medida:'4x8 pies',  precio:380, stock:true, categoria:'Triplay'},
  {id:12, nombre:'Cimbra fenolica',   medida:'4x8 pies',  precio:450, stock:true, categoria:'Triplay'},
  {id:13, nombre:'Shingle asfaltico', medida:'por pieza', precio:425, stock:true, categoria:'Cubiertas'},
  {id:14, nombre:'Membrana azul',     medida:'por rollo', precio:650, stock:true, categoria:'Cubiertas'},
  {id:15, nombre:'Membrana granular', medida:'por rollo', precio:580, stock:true, categoria:'Cubiertas'},
];

// ── Database (Supabase persistent + file fallback) ────────────────────────────
let _cache = null;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;

function _sbHeaders() {
  return { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' };
}

function _defaults(db) {
  if (!db.config)          db.config = { passwords: { admin: 'admin123', cajero: 'cajero123', cliente: 'cliente' } };
  if (!db.productos)       db.productos = PRODUCTOS_DEFAULT;
  if (!db.remisiones)      db.remisiones = [];
  if (!db.clientes)        db.clientes = [];
  if (!db.contador)        db.contador = 1;
  if (!db.gastos)          db.gastos = [];
  if (!db.gastos_cnt)      db.gastos_cnt = 1;
  if (!db.pedidos)         db.pedidos = [];
  if (!db.pedidos_cnt)     db.pedidos_cnt = 1;
  if (!db.proveedores)     db.proveedores = [];
  if (!db.proveedores_cnt) db.proveedores_cnt = 1;
  db.productos.forEach(function(p) { if (!p.categoria) p.categoria = CAT_MAP[p.nombre] || 'General'; });
  return db;
}

function readDB() { return _cache; }

function writeDB(data) {
  _cache = data;
  if (SB_URL && SB_KEY) {
    fetch(SB_URL + '/rest/v1/store', {
      method: 'POST',
      headers: _sbHeaders(),
      body: JSON.stringify({ id: 1, data: data })
    }).catch(function(e) { console.error('SB write:', e.message); });
  } else {
    try { fs.writeFileSync(DB, JSON.stringify(data, null, 2)); } catch(e) {}
  }
}

async function initStorage() {
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetch(SB_URL + '/rest/v1/store?id=eq.1&select=data', { headers: _sbHeaders() });
      const rows = await r.json();
      _cache = _defaults(rows.length ? rows[0].data : {});
      console.log('Storage: Supabase');
      return;
    } catch(e) { console.error('Supabase init failed:', e.message); }
  }
  let raw = {};
  if (fs.existsSync(DB)) { try { raw = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch(e) {} }
  _cache = _defaults(raw);
  console.log('Storage: archivo local');
}

// ── Auth ──────────────────────────────────────────────────────────────────────
const sessions = {};
function makeToken(role) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions[t] = { role: role, at: Date.now() };
  return t;
}
function getRole(req) {
  const s = sessions[req.headers['x-token'] || ''];
  if (!s) return null;
  if (Date.now() - s.at > 8*3600*1000) { delete sessions[req.headers['x-token']]; return null; }
  return s.role;
}
function auth() {
  const roles = Array.from(arguments);
  return function(req, res, next) {
    const r = getRole(req);
    if (!r) return res.status(401).json({ error: 'No autorizado' });
    if (roles.length && roles.indexOf(r) === -1) return res.status(403).json({ error: 'Sin permiso' });
    req.role = r; next();
  };
}

// ── Login ─────────────────────────────────────────────────────────────────────
app.post('/api/login', function(req, res) {
  const db = readDB();
  const role = req.body.role, pw = req.body.password;
  if (!db.config.passwords[role] || db.config.passwords[role] !== pw)
    return res.status(401).json({ error: 'Contrasena incorrecta' });
  res.json({ token: makeToken(role), role: role });
});

app.post('/api/verify-admin', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  if (db.config.passwords.admin !== req.body.password)
    return res.status(401).json({ error: 'Contrasena incorrecta' });
  res.json({ ok: true });
});

// ── Productos ─────────────────────────────────────────────────────────────────
app.get('/api/productos', auth('admin','cajero'), function(req, res) { res.json(readDB().productos); });

app.post('/api/productos', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const id = db.productos.reduce(function(m,p) { return Math.max(m,p.id); }, 0) + 1;
  const p = Object.assign({}, req.body, { id: id, stock: true });
  if (!p.categoria) p.categoria = 'General';
  db.productos.push(p);
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json(p);
});

app.put('/api/productos/:id', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const i = db.productos.findIndex(function(p) { return p.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  db.productos[i] = Object.assign({}, db.productos[i], req.body);
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json(db.productos[i]);
});

app.delete('/api/productos/:id', auth('admin'), function(req, res) {
  const db = readDB();
  db.productos = db.productos.filter(function(p) { return p.id !== Number(req.params.id); });
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json({ ok: true });
});

// ── Remisiones ────────────────────────────────────────────────────────────────
app.get('/api/remisiones', auth('admin','cajero'), function(req, res) { res.json(readDB()); });

app.post('/api/remisiones', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const cliente = req.body.cliente, tel = req.body.tel;
  const total = req.body.total, metodo = req.body.metodo_pago || 'efectivo';
  if (cliente && cliente !== 'Mostrador' && tel) {
    let c = db.clientes.find(function(x) { return x.tel === tel; });
    if (!c) {
      c = { id: Date.now(), nombre: cliente, tel: tel, desde: new Date().toISOString(), compras: 0, total: 0, fiado: 0 };
      db.clientes.push(c);
    }
    c.compras = (c.compras || 0) + 1;
    if (metodo === 'fiado') { c.fiado = (c.fiado || 0) + total; }
    else { c.total = (c.total || 0) + total; }
    c.ultima = new Date().toISOString();
    if (req.body.direccion) c.direccion = req.body.direccion;
  }
  const rem = Object.assign({}, req.body, { id: db.contador++, fecha: new Date().toISOString() });
  db.remisiones.unshift(rem);
  writeDB(db);
  io.emit('nueva_remision', rem);
  res.json(rem);
});

app.put('/api/remisiones/:id', auth('admin'), function(req, res) {
  const db = readDB();
  const i = db.remisiones.findIndex(function(r) { return r.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  db.remisiones[i] = Object.assign({}, db.remisiones[i], req.body);
  writeDB(db);
  res.json(db.remisiones[i]);
});

app.delete('/api/remisiones/:id', auth('admin'), function(req, res) {
  const db = readDB();
  db.remisiones = db.remisiones.filter(function(r) { return r.id !== Number(req.params.id); });
  writeDB(db);
  io.emit('remision_eliminada', Number(req.params.id));
  res.json({ ok: true });
});

app.put('/api/remisiones/:id/editar', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const i = db.remisiones.findIndex(function(r) { return r.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  const allowed = ['cliente','tel','metodo_pago','vendedor','notas'];
  allowed.forEach(function(k) { if (req.body[k] !== undefined) db.remisiones[i][k] = req.body[k]; });
  writeDB(db);
  res.json({ ok: true });
});

app.put('/api/remisiones/:id/pagar', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const i = db.remisiones.findIndex(function(r) { return r.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  const rem = db.remisiones[i];
  rem.metodo_pago = 'efectivo';
  rem.fiado_pagado = true;
  rem.fecha_pago = new Date().toISOString();
  if (rem.tel) {
    const c = db.clientes.find(function(x) { return x.tel === rem.tel; });
    if (c) { c.fiado = Math.max(0, (c.fiado||0) - rem.total); c.total = (c.total||0) + rem.total; }
  }
  writeDB(db);
  res.json(rem);
});

// ── Fotos de productos ────────────────────────────────────────────────────────
app.post('/api/productos/:id/foto', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const i = db.productos.findIndex(function(p) { return p.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  const base64 = req.body.foto;
  if (!base64 || !base64.startsWith('data:image')) return res.status(400).json({ error: 'Imagen inválida' });
  const ext = base64.includes('image/png') ? 'png' : 'jpg';
  const uploadsDir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = 'prod-' + db.productos[i].id + '.' + ext;
  fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(base64.split(',')[1], 'base64'));
  db.productos[i].foto = '/uploads/' + filename;
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json(db.productos[i]);
});

app.delete('/api/productos/:id/foto', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const i = db.productos.findIndex(function(p) { return p.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  if (db.productos[i].foto) {
    const fp = path.join(__dirname, 'public', db.productos[i].foto);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    delete db.productos[i].foto;
    writeDB(db);
    io.emit('productos_actualizados', db.productos);
  }
  res.json({ ok: true });
});

// ── Clientes ──────────────────────────────────────────────────────────────────
app.get('/api/clientes', auth('admin','cajero'), function(req, res) { res.json(readDB().clientes); });

app.put('/api/clientes/:id', auth('admin'), function(req, res) {
  const db = readDB();
  const i = db.clientes.findIndex(function(c) { return c.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  db.clientes[i] = Object.assign({}, db.clientes[i], req.body);
  writeDB(db);
  res.json(db.clientes[i]);
});

// ── Gastos ────────────────────────────────────────────────────────────────────
app.get('/api/gastos', auth('admin','cajero'), function(req, res) { res.json(readDB().gastos || []); });

app.post('/api/gastos', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const g = Object.assign({}, req.body, { id: db.gastos_cnt++, fecha: new Date().toISOString() });
  db.gastos.unshift(g);
  writeDB(db);
  res.json(g);
});

app.delete('/api/gastos/:id', auth('admin'), function(req, res) {
  const db = readDB();
  db.gastos = db.gastos.filter(function(g) { return g.id !== Number(req.params.id); });
  writeDB(db);
  res.json({ ok: true });
});

// ── Pedidos ───────────────────────────────────────────────────────────────────
app.get('/api/pedidos', auth('admin','cajero'), function(req, res) { res.json(readDB().pedidos || []); });

app.post('/api/pedidos', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const p = Object.assign({}, req.body, { id: db.pedidos_cnt++, fecha: new Date().toISOString(), estado: req.body.estado || 'pendiente' });
  db.pedidos.unshift(p);
  writeDB(db);
  res.json(p);
});

app.put('/api/pedidos/:id', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const i = db.pedidos.findIndex(function(p) { return p.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  db.pedidos[i] = Object.assign({}, db.pedidos[i], req.body);
  writeDB(db);
  res.json(db.pedidos[i]);
});

app.delete('/api/pedidos/:id', auth('admin'), function(req, res) {
  const db = readDB();
  db.pedidos = db.pedidos.filter(function(p) { return p.id !== Number(req.params.id); });
  writeDB(db);
  res.json({ ok: true });
});

app.post('/api/pedidos/:id/recibir', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const materiales = req.body.materiales || [];
  const actualizado = [];
  materiales.forEach(function(mat) {
    const prod = db.productos.find(function(p) {
      return p.nombre.toLowerCase() === mat.nombre.toLowerCase() &&
             (!mat.medida || p.medida.toLowerCase() === mat.medida.toLowerCase());
    });
    if (prod && mat.cantidad > 0) {
      prod.cantidad = (prod.cantidad || 0) + mat.cantidad;
      prod.stock = true;
      actualizado.push(prod.nombre + ' +' + mat.cantidad);
    }
  });
  writeDB(db);
  res.json({ ok: true, actualizado });
});

// ── Proveedores ───────────────────────────────────────────────────────────────
app.get('/api/proveedores', auth('admin','cajero'), function(req, res) { res.json(readDB().proveedores || []); });

app.post('/api/proveedores', auth('admin'), function(req, res) {
  const db = readDB();
  const p = Object.assign({}, req.body, { id: db.proveedores_cnt++, fecha: new Date().toISOString() });
  db.proveedores.push(p);
  writeDB(db);
  res.json(p);
});

app.put('/api/proveedores/:id', auth('admin'), function(req, res) {
  const db = readDB();
  const i = db.proveedores.findIndex(function(p) { return p.id === Number(req.params.id); });
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  db.proveedores[i] = Object.assign({}, db.proveedores[i], req.body);
  writeDB(db);
  res.json(db.proveedores[i]);
});

app.delete('/api/proveedores/:id', auth('admin'), function(req, res) {
  const db = readDB();
  db.proveedores = db.proveedores.filter(function(p) { return p.id !== Number(req.params.id); });
  writeDB(db);
  res.json({ ok: true });
});

// ── Reportes ──────────────────────────────────────────────────────────────────
app.get('/api/reportes/hoy', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const hoy = new Date().toDateString();
  const rs = db.remisiones.filter(function(r) { return new Date(r.fecha).toDateString() === hoy; });
  const total   = rs.reduce(function(s,r) { return s + (r.metodo_pago !== 'fiado' ? r.total : 0); }, 0);
  const fiado   = rs.reduce(function(s,r) { return s + (r.metodo_pago === 'fiado'  ? r.total : 0); }, 0);
  const gasHoy  = (db.gastos||[]).filter(function(g) { return new Date(g.fecha).toDateString() === hoy; });
  const gasTotal = gasHoy.reduce(function(s,g) { return s + g.monto; }, 0);
  const cnt = {};
  rs.forEach(function(r) { r.items.forEach(function(i) { const k=i.nombre+' '+i.medida; cnt[k]=(cnt[k]||0)+i.qty; }); });
  const top = Object.keys(cnt).map(function(k){return [k,cnt[k]];}).sort(function(a,b){return b[1]-a[1];})[0];
  res.json({ count:rs.length, total:total, fiado:fiado, gastos:gasTotal, utilidad:total-gasTotal, top:top?top[0]:'-', topQty:top?top[1]:0 });
});

app.get('/api/reportes/semana', auth('admin','cajero'), function(req, res) {
  const db = readDB();
  const dias = [];
  for (var i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const label = d.toLocaleDateString('es-MX', { weekday:'short', day:'numeric' });
    const rs = db.remisiones.filter(function(r) { return new Date(r.fecha).toDateString() === d.toDateString() && r.metodo_pago !== 'fiado'; });
    dias.push({ label:label, total:rs.reduce(function(s,r){return s+r.total;},0), count:rs.length });
  }
  res.json(dias);
});

// ── Catálogo público (sin auth) ───────────────────────────────────────────────
app.get('/api/catalogo', function(req, res) {
  const db = readDB();
  res.json(db.productos.filter(function(p) { return p.stock; }).map(function(p) {
    return { id:p.id, nombre:p.nombre, medida:p.medida, precio:p.precio, categoria:p.categoria, stock:p.stock };
  }));
});

// ── Config ────────────────────────────────────────────────────────────────────
app.put('/api/config/passwords', auth('admin'), function(req, res) {
  const db = readDB();
  Object.assign(db.config.passwords, req.body);
  writeDB(db);
  res.json({ ok: true });
});

// ── Socket ────────────────────────────────────────────────────────────────────
io.on('connection', function(socket) {
  socket.on('actualizar_carrito', function(data) { socket.broadcast.emit('carrito_cliente', data); });
  socket.on('limpiar_cliente',    function()     { socket.broadcast.emit('limpiar_cliente'); });
});

// ── Backup / Restore ─────────────────────────────────────────────────────────
app.get('/api/backup/export', auth('admin'), function(req, res) {
  res.json(readDB());
});
app.post('/api/backup/import', auth('admin'), function(req, res) {
  const data = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'invalid' });
  writeDB(data);
  res.json({ ok: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initStorage().then(function() {
  server.listen(PORT, '0.0.0.0', function() {
    const nets = os.networkInterfaces();
    let ip = 'localhost';
    Object.values(nets).forEach(function(list) {
      list.forEach(function(i) { if (i.family==='IPv4'&&!i.internal) ip=i.address; });
    });
    console.log('POS La Jardin v4 — Puerto ' + PORT);
    console.log('Local: http://localhost:' + PORT);
    console.log('Red:   http://' + ip + ':' + PORT);
  });
});
