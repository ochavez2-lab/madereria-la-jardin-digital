const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);
const PORT   = 3000;
const DB_FILE = path.join(__dirname, 'datos.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { remisiones: [], contador: 1 };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/remisiones', (req, res) => {
  res.json(readDB());
});

app.post('/api/remisiones', (req, res) => {
  const db  = readDB();
  const rem = { ...req.body, id: db.contador, fecha: new Date().toISOString() };
  db.remisiones.unshift(rem);
  db.contador++;
  writeDB(db);
  io.emit('nueva_remision', rem);
  res.json(rem);
});

app.delete('/api/remisiones/:id', (req, res) => {
  const db  = readDB();
  const id  = parseInt(req.params.id);
  db.remisiones = db.remisiones.filter(r => r.id !== id);
  writeDB(db);
  io.emit('remision_eliminada', id);
  res.json({ ok: true });
});

io.on('connection', socket => {
  socket.on('actualizar_carrito', data => socket.broadcast.emit('carrito_cliente', data));
  socket.on('limpiar_cliente',    ()   => socket.broadcast.emit('limpiar_cliente'));
});

server.listen(PORT, '0.0.0.0', () => {
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  Object.values(interfaces).flat().forEach(i => {
    if (i.family === 'IPv4' && !i.internal) localIP = i.address;
  });
  console.log('\n================================');
  console.log('  POS Madereria La Jardin');
  console.log('================================');
  console.log(`  Cajero:  http://localhost:${PORT}/cajero.html`);
  console.log(`  Cliente: http://${localIP}:${PORT}/cliente.html`);
  console.log(`  Red WiFi: http://${localIP}:${PORT}`);
  console.log('================================\n');
});
