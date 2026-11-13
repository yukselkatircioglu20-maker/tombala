'use strict';
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const db = require('./db');
const auth = require('./auth');
const game = require('./game');
const routes = require('./routes');

db.load();

// İsteğe bağlı: ortam değişkenleriyle yönetici hesabı oluştur
if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
  const exists = db.data.users.find((u) => u.username.toLowerCase() === process.env.ADMIN_USERNAME.toLowerCase());
  if (!exists) {
    db.data.users.push({
      id: db.nextId('user'),
      name: process.env.ADMIN_NAME || 'Yönetici',
      username: process.env.ADMIN_USERNAME,
      password: auth.hashPassword(process.env.ADMIN_PASSWORD),
      role: 'admin',
      balance: 0,
      blocked: false,
      createdAt: Date.now(),
    });
    db.save();
    console.log(`Yönetici hesabı oluşturuldu: ${process.env.ADMIN_USERNAME}`);
  }
}

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1');
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use(auth.attachUser);
app.use('/api', routes);
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const server = http.createServer(app);
const io = new Server(server);

io.on('connection', (socket) => {
  const token = auth.parseCookies(socket.handshake.headers.cookie)[auth.COOKIE];
  const user = auth.userFromToken(token);
  if (user) {
    socket.join(`user:${user.id}`);
    if (user.role === 'admin') socket.join('admins');
  }
  socket.emit('game:state', game.publicState());
});

game.init(io);
setInterval(auth.cleanupSessions, 60 * 60 * 1000);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`Tombala sunucusu çalışıyor: http://localhost:${PORT}`);
});

function shutdown() {
  try {
    db.flush();
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
