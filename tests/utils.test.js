import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanText, decodeEntities, minutesFromISO } from '../utils.js';

test('decodeEntities remplace les entités HTML courantes', () => {
  const input = 'Bonjour &amp; bienvenue &lt;strong&gt;à tous&lt;/strong&gt; !';
  const output = decodeEntities(input);
  assert.equal(output, 'Bonjour & bienvenue <strong>à tous</strong> !');
});

test('cleanText supprime les balises et espaces multiples', () => {
  const input = '\n<p> Hello &amp; <strong>world</strong> ! </p>\n';
  const output = cleanText(input);
  assert.equal(output, 'Hello & world !');
});

test('minutesFromISO calcule un temps positif arrondi à la minute la plus proche', () => {
  const originalNow = Date.now;
  const base = new Date('2024-01-01T12:00:00Z');
  Date.now = () => base.getTime();

  try {
    const fiveMinutesLater = new Date(base.getTime() + 5 * 60 * 1000).toISOString();
    assert.equal(minutesFromISO(fiveMinutesLater), 5);

    const thirtySecondsLater = new Date(base.getTime() + 30 * 1000).toISOString();
    assert.equal(minutesFromISO(thirtySecondsLater), 1);

    const pastDate = new Date(base.getTime() - 60 * 1000).toISOString();
    assert.equal(minutesFromISO(pastDate), 0);

    assert.equal(minutesFromISO(null), null);
  } finally {
    Date.now = originalNow;
  }
});
