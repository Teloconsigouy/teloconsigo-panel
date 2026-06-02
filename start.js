const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Servir todos los archivos HTML/CSS/JS/JSON desde la raiz del repo
app.use(express.static(__dirname));

// Entrada directa al panel, sin login temporalmente
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('No se encontro index.html en el repositorio');
});

// Si alguien entra a login.html, va directo al panel
app.get('/login.html', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.redirect('/');
});

// Login temporal abierto para que no bloquee el frontend viejo
app.post('/api/login', (req, res) => {
  res.json({ ok: true, user: { username: 'admin', name: 'Admin', role: 'admin' } });
});

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: { username: 'admin', name: 'Admin', role: 'admin' } });
});

app.post('/api/logout', (req, res) => {
  res.json({ ok: true });
});

// Endpoint temporal para evitar pantalla rota si publicaciones.html lo llama
app.get('/api/publicaciones', (req, res) => {
  res.json({ ok: true, publicaciones: [], items: [], total: 0, message: 'Endpoint activo. Falta conectar datos reales de publicaciones.' });
});

// Compatibilidad con otras rutas posibles
app.get('/api/meli/publicaciones', (req, res) => {
  res.json({ ok: true, publicaciones: [], items: [], total: 0, message: 'Endpoint activo. Falta conectar datos reales de publicaciones.' });
});

app.get('/health', (req, res) => {
  res.json({ ok: true, status: 'online' });
});

app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log('TLC Panel online en puerto ' + PORT);
});
