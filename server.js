// server.js
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

// Dossier public
app.use(express.static(path.join(__dirname, 'public')));

// Proxy générique pour contourner le CORS
app.get('/proxy', async (req, res) => {
  try {
    const target = req.query.url;
    if (!target) return res.status(400).send('Missing url query parameter');
    const url = new URL(target);
    // Autoriser uniquement certains domaines si besoin
    // if (!['api.pmu.fr', 'offline.turfinfo.api.pmu.fr'].includes(url.hostname)) return res.status(403).send('Forbidden');
    const response = await fetch(target);
    const contentType = response.headers.get('content-type');
    res.set('Access-Control-Allow-Origin', '*');
    res.type(contentType);
    response.body.pipe(res);
  } catch (e) {
    res.status(500).send(`Proxy error: ${e.message}`);
  }
});

// Point d’entrée par défaut
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
