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
  {id:4,  nombre:'Tablon 2x6',        medida:'16 pies',   precio:140, stock:true},
  {id:5,  nombre:'Viga 4x4',          medida:'16 pies',   precio:210, stock:true},
  {id:6,  nombre:'Triplay 3/8',       medida:'4x8 pies',  precio:310, stock:true},
  {id:7,  nombre:'Triplay 1/2',       medida:'4x8 pies',  precio:420, stock:true},
  {id:8,  nombre:'Triplay 5/8',       medida:'4x8 pies',  precio:425, stock:true},
  {id:9,  nombre:'Triplay 3/4',       medida:'4x8 pies',  precio:580, stock:true},
  {id:10, nombre:'Triplay ranurado',  medida:'4x8 pies',  precio:390, stock:true},
  {id:11, nombre:'OSB Cimbraplay',    medida:'4x8 pies',  precio:380, stock:true},
  {id:12, nombre:'Cimbra fenolica',   medida:'4x8 pies',  precio:450, stock:true},
  {id:13, nombre:'Shingle asfaltico', medida:'por pieza', precio:425, stock:true},
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

const sessions = {};
function makeToken(role) {
  const t = crypto.randomBytes(24).toString('hex');
  sessions[t] = { role, at: Date.now() };
  return t;
}
function getRole(req) {
  const s = sessions[req.headers['x-token'] || ''];
  if (!s) return null;
  if (Date.now() - s.at > 8 * 3600 * 1000) { delete sessions[req.headers['x-token']]; return null; }
  return s.role;
}
function auth() {
  const roles = Array.from(arguments);
  return function(req, res, next) {
    const r = getRole(req);
    if (!r) return res.status(401).json({ error: 'No autorizado' });
    if (roles.length && roles.indexOf(r) === -1) return res.status(403).json({ error: 'Sin permiso' });
    req.role = r;
    next();
  };
}

app.post('/api/login', function(req, res) {
  const role = req.body.role;
  const password = req.body.password;
  const db = readDB();
  if (!db.config.passwords[role] || db.config.passwords[role] !== password)
    return res.status(401).json({ error: 'Contrasena incorrecta' });
  res.json({ token: makeToken(role), role: role });
});

app.get('/api/productos', auth('admin', 'cajero'), function(req, res) { res.json(readDB().productos); });

app.post('/api/productos', auth('admin'), function(req, res) {
  const db = readDB();
  const id = db.productos.reduce(function(m, p) { return Math.max(m, p.id); }, 0) + 1;
  const p = Object.assign({}, req.body, { id: id, stock: true });
  db.productos.push(p);
  writeDB(db);
  io.emit('productos_actualizados', db.productos);
  res.json(p);
});

app.put('/api/productos/:id', auth('admin'), function(req, res) {
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

app.get('/api/remisiones', auth('admin', 'cajero'), function(req, res) { res.json(readDB()); });

app.post('/api/remisiones', auth('admin', 'cajero'), function(req, res) {
  const db = readDB();
  const cliente = req.body.cliente;
  const tel = req.body.tel;
  const total = req.body.total;
  if (cliente && cliente !== 'Mostrador' && tel) {
    let c = db.clientes.find(function(x) { return x.tel === tel; });
    if (!c) {
      c = { id: Date.now(), nombre: cliente, tel: tel, desde: new Date().toISOString(), compras: 0, total: 0 };
      db.clientes.push(c);
    }
    c.compras = (c.compras || 0) + 1;
    c.total = (c.total || 0) + total;
    c.ultima = new Date().toISOString();
  }
  const rem = Object.assign({}, req.body, { id: db.contador++, fecha: new Date().toISOString() });
  db.remisiones.unshift(rem);
  writeDB(db);
  io.emit('nueva_remision', rem);
  res.json(rem);
});

app.delete('/api/remisiones/:id', auth('admin'), function(req, res) {
  const db = readDB();
  db.remisiones = db.remisiones.filter(function(r) { return r.id !== Number(req.params.id); });
  writeDB(db);
  io.emit('remision_eliminada', Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/clientes', auth('admin'), function(req, res) { res.json(readDB().clientes); });

app.get('/api/reportes/hoy', auth('admin', 'cajero'), function(req, res) {
  const db = readDB();
  const hoy = new Date().toDateString();
  const rs = db.remisiones.filter(function(r) { return new Date(r.fecha).toDateString() === hoy; });
  const total = rs.reduce(function(s, r) { return s + r.total; }, 0);
  const cnt = {};
  rs.forEach(function(r) {
    r.items.forEach(function(i) {
      const k = i.nombre + ' ' + i.medida;
      cnt[k] = (cnt[k] || 0) + i.qty;
    });
  });
  const entries = Object.keys(cnt).map(function(k) { return [k, cnt[k]]; });
  entries.sort(function(a, b) { return b[1] - a[1]; });
  const top = entries[0];
  res.json({ count: rs.length, total: total, top: top ? top[0] : '-', topQty: top ? top[1] : 0 });
});

app.put('/api/config/passwords', auth('admin'), function(req, res) {
  const db = readDB();
  Object.assign(db.config.passwords, req.body);
  writeDB(db);
  res.json({ ok: true });
});

io.on('connection', function(socket) {
  socket.on('actualizar_carrito', function(data) { socket.broadcast.emit('carrito_cliente', data); });
  socket.on('limpiar_cliente', function() { socket.broadcast.emit('limpiar_cliente'); });
});

server.listen(PORT, '0.0.0.0', function() {
  const nets = os.networkInterfaces();
  let ip = 'localhost';
  Object.values(nets).forEach(function(list) {
    list.forEach(function(i) { if (i.family === 'IPv4' && !i.internal) ip = i.address; });
  });
  console.log('POS La Jardin v2 corriendo en puerto ' + PORT);
  console.log('http://localhost:' + PORT);
  console.log('http://' + ip + ':' + PORT);
});
