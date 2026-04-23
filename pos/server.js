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
const DB     = path.join(__dirname, 'datos.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const PRODUCTOS_DEFAULT = [
  {id:1,  nombre:'Barrote 2x4',       medida:'8 pies',    precio:45,  stock:true},
  {id:2,  nombre:'Barrote 2x4',       medida:'16 pies',   precio:85,  stock:true},
  {id:3,  nombre:'Barrote 2x4',       medida:'30 pies',   precio:180, stock:true},
  {id:4,  nombre:'Tablón 2x6',        medida:'16 pies',   precio:140, stock:true},
  {id:5,  nombre:'Viga 4x4',          medida:'16 pies',   precio:210, stock:true},
  {id:6,  nombre:'Triplay 3/8"',      medida:'4x8 pies',  precio:310, stock:true},
  {id:7,  nombre:'Triplay 1/2"',      medida:'4x8 pies',  precio:420, stock:true},
  {id:8,  nombre:'Triplay 5/8"',      medida:'4x8 pies',  precio:425, stock:true},
  {id:9,  nombre:'Triplay 3/4"',      medida:'4x8 pies',  precio:580, stock:true},
  {id:10, nombre:'Triplay ranurado',  medida:'4x8 pies',  precio:390, stock:true},
  {id:11, nombre:'OSB / Cimbraplay',  medida:'4x8 pies',  precio:380, stock:true},
  {id:12, nombre:'Cimbra fenólica',   medida:'4x8 pies',  precio:450, stock:true},
  {id:13, nombre:'Shingle asfáltico', medida:'por pieza', precio:425, stock:true},
  {id:14, nombre:'Membrana azul',     medida:'por rollo', precio:650, stock:true},
  {id:15, nombre:'Membrana granular', medida:'por rollo', precio:580, stock:true},
];

function readDB() {
  let db = {};
  if (fs.existsSync(DB)) {
    try { db = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch(e) { db = {}; }
  }
  if (!db.config)     db.config = { passwords: { admin: 'admin123', cajero: 'cajero123', cliente: 'cliente' } };
  if (!db.productos)  db.productos = PRODUCTOS_DEFAULT;
  if (!db.remisiones) db.remisiones = [];
  if (!db.clientes)   db.clientes = [];
  if (!db.contador)   db.contador = 1;
  return db;
}

function writeDB(data) { fs.writeFileSync(DB, JSON.stringify(data, null, 2)); }

// ── Auth ──────────────────────────────────────────────────────────────────────
const sessions = {};
function makeToken(role) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions[t] = { role, at: Date.now() };
  return t;
}
function getRole(req) {
  const s = sessions[req.headers['x-token'] || ''];
  if (!s) return null;
  if (Date.now() - s.at > 8*3600*1000) { delete sessions[req.headers['x-token']]; return null; }
  return s.role;
}
function auth(...roles) {
  return (req, res, next) => {
    const r = getRole(req);
    if (!r) return res.status(401).json({ error: 'No autorizado' });
    if (roles.length && !roles.includes(r)) return res.status(403).json({ error: 'Sin permiso' });
    req.role = r; next();
  };
}

// ── Login ─────────────────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { role, password } = req.body;
  const db = readDB();
  if (!db.config.passwords[role] || db.config.passwords[role] !== password)
    return res.status(401).json({ error: 'Contraseña incorrecta' });
  res.json({ token: makeToken(role), role });
});

// ── Productos ─────────────────────────────────────────────────────────────────
app.get('/api/productos', auth('admin','cajero'), (req, res) => res.json(readDB().productos));

app.post('/api/productos', auth('admin'), (req, res) => {
  const db = readDB();
  const id = db.productos.reduce((m,p) => Math.max(m,p.id), 0) + 1;
  const p  = { ...req.body, id, stock: true };
  db.productos.push(p);
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json(p);
});

app.put('/api/productos/:id', auth('admin'), (req, res) => {
  const db = readDB();
  const i  = db.productos.findIndex(p => p.id === +req.params.id);
  if (i < 0) return res.status(404).json({ error: 'No encontrado' });
  db.productos[i] = { ...db.productos[i], ...req.body };
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json(db.productos[i]);
});

app.delete('/api/productos/:id', auth('admin'), (req, res) => {
  const db = readDB();
  db.productos = db.productos.filter(p => p.id !== +req.params.id);
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json({ ok: true });
});

// ── Remisiones ────────────────────────────────────────────────────────────────
app.get('/api/remisiones', auth('admin','cajero'), (req, res) => res.json(readDB()));

app.post('/api/remisiones', auth('admin','cajero'), (req, res) => {
  const db = readDB();
  const { cliente, tel, total } = req.body;
  if (cliente && cliente !== 'Mostrador' && tel) {
    let c = db.clientes.find(c => c.tel === tel);
    if (!c) { c = { id: Date.now(), nombre: cliente, tel, desde: new Date().toISOString(), compras: 0, total: 0 }; db.clientes.push(c); }
    c.compras = (c.compras||0) + 1;
    c.total   = (c.total||0) + total;
    c.ultima  = new Date().toISOString();
  }
  const rem = { ...req.body, id: db.contador++, fecha: new Date().toISOString() };
  db.remisiones.unshift(rem);
  writeDB(db);
  io.emit('nueva_remision', rem);
  res.json(rem);
});

app.delete('/api/remisiones/:id', auth('admin'), (req, res) => {
  const db = readDB();
  db.remisiones = db.remisiones.filter(r => r.id !== +req.params.id);
  writeDB(db);
  io.emit('remision_eliminada', +req.params.id);
  res.json({ ok: true });
});

// ── Clientes ──────────────────────────────────────────────────────────────────
app.get('/api/clientes', auth('admin'), (req, res) => res.json(readDB().clientes));

// ── Reportes ──────────────────────────────────────────────────────────────────
app.get('/api/reportes/hoy', auth('admin','cajero'), (req, res) => {
  const db  = readDB();
  const hoy = new Date().toDateString();
  const rs  = db.remisiones.filter(r => new Date(r.fecha).toDateString() === hoy);
  const total = rs.reduce((s,r) => s + r.total, 0);
  const cnt = {};
  rs.forEach(r => r.items.forEach(i => { const k=`${i.nombre} ${i.medida}`; cnt[k]=(cnt[k]||0)+i.qty; }));
  const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
  res.json({ count: rs.length, total, top: top?top[0]:'—', topQty: top?top[1]:0 });
});

// ── Config ────────────────────────────────────────────────────────────────────
app.put('/api/config/passwords', auth('admin'), (req, res) => {
  const db = readDB();
  Object.assign(db.config.passwords, req.body);
  writeDB(db);
  res.json({ ok: true });
});

// ── Socket ────────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('actualizar_carrito', data => socket.broadcast.emit('carrito_cliente', data));
  socket.on('limpiar_cliente',    ()   => socket.broadcast.emit('limpiar_cliente'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let ip = 'localhost';
  Object.values(nets).flat().forEach(i => { if (i.family==='IPv4'&&!i.internal) ip=i.address; });
  console.log(`\n================================`);
  console.log(`  POS La Jardín v2`);
  console.log(`================================`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://${ip}:${PORT}`);
  console.log(`================================\n`);
});
