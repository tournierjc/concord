#!/usr/bin/env node
// design/check-i18n.mjs — contrôle de parité FR/EN des libellés de l'interface.
//
// Node pur, ZERO dépendance (ni npm, ni node_modules) : `node design/check-i18n.mjs`.
// Contrôles (SPEC-002 §9) :
//   1. les deux fichiers se lisent en JSON strict ;
//   2. aucune clé en double dans le texte brut d'un fichier ;
//   3. mêmes clés, dans le même ordre, en FR et en EN ;
//   4. aucune valeur vide (ou non textuelle) ;
//   5. mêmes moustaches {{…}} de chaque côté, syntaxe valide ;
//   6. libellés de bouton <= 20 caractères ;
//   7. design/i18n.json (bundle lu par la coquille) est identique à la fusion fr+en ;
//   8. typographie : guillemets « » en FR, “ ” en EN, pas de guillemet droit en FR.
//
// Sortie : une ligne par contrôle, puis `I18N RESULT=PASS|FAIL`. Code de sortie 0 si PASS, 1 si FAIL.

import { readFileSync } from 'node:fs';

const KIT = new URL('./', import.meta.url);
const FILES = { fr: new URL('i18n/fr.json', KIT), en: new URL('i18n/en.json', KIT) };
const BUNDLE = new URL('i18n.json', KIT);
const MAX_BUTTON = 20;

// Clés rendues comme libellé VISIBLE de bouton : texte fixe, courte largeur (SPEC-002 §2.6, 20 car.).
// Sont exclues de cette mesure : les infobulles (room.pin.*), les libellés d'accessibilité
// (*.joinAria, *.fullAria, a11y.*) et les libellés interpolés avec un nom de participant
// (participant.localMute / localUnmute) — leur largeur dépend de la donnée, pas du libellé.
const BUTTON_KEYS = [
  'common.cancel', 'common.confirm', 'common.close', 'common.retry', 'common.apply', 'common.back',
  'common.refresh', 'app.settings.open', 'discovery.empty.action.create', 'discovery.empty.action.refresh',
  'room.list.create', 'room.list.retry', 'room.row.join', 'room.row.full', 'room.create.confirm',
  'room.leave', 'room.empty.action', 'room.full.action', 'control.leave', 'settings.close',
  'settings.audio.test', 'settings.audio.permissionRetry', 'settings.vad.calibrate',
  'settings.vad.calibrateApply', 'settings.ptt.change', 'settings.ptt.reset', 'settings.overlay.positionReset',
  'room.error.audioInitAction', 'participant.iceFailedAction',
];

const failures = [];
const lines = [];
const fail = (msg) => failures.push(msg);

// --- 1. lecture JSON stricte -------------------------------------------------
const raw = {};
const data = {};
for (const lang of ['fr', 'en']) {
  let text;
  try {
    text = readFileSync(FILES[lang], 'utf8');
  } catch (err) {
    fail(`fichier illisible : ${FILES[lang].pathname} (${err.code})`);
    continue;
  }
  raw[lang] = text;
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`${lang}.json : la racine doit être un objet plat clé -> chaîne`);
      continue;
    }
    data[lang] = parsed;
  } catch (err) {
    fail(`${lang}.json : JSON invalide — ${err.message}`);
  }
}
if (!data.fr || !data.en) {
  report();
}

// --- 2. clés en double dans le texte brut ------------------------------------
// Scanner minimal : suit la profondeur {} et l'état « dans une chaîne » pour ne
// compter que les clés de premier niveau (les valeurs sont des chaînes, sans objet).
function topLevelKeys(text) {
  const keys = [];
  let depth = 0;
  let i = 0;
  let expectKey = false;
  let lastString = null;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      let buf = '';
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') { buf += text[j + 1]; j += 2; continue; }
        buf += text[j];
        j += 1;
      }
      i = j + 1;
      if (depth === 1) {
        let k = i;
        while (k < text.length && /\s/.test(text[k])) k += 1;
        if (text[k] === ':') {
          if (expectKey || true) keys.push(buf);
          expectKey = false;
        }
        lastString = buf;
      }
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    i += 1;
  }
  void lastString;
  return keys;
}

const dupCount = {};
for (const lang of ['fr', 'en']) {
  if (!raw[lang]) continue;
  const keys = topLevelKeys(raw[lang]);
  const seen = new Map();
  for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1);
  const dups = [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
  dupCount[lang] = dups.length;
  if (dups.length) fail(`${lang}.json : clés en double — ${dups.join(', ')}`);
}

// --- 3. parité des clés ------------------------------------------------------
const frKeys = Object.keys(data.fr);
const enKeys = Object.keys(data.en);
const setFr = new Set(frKeys);
const setEn = new Set(enKeys);
const missingInEn = frKeys.filter((k) => !setEn.has(k));
const missingInFr = enKeys.filter((k) => !setFr.has(k));
if (missingInEn.length) fail(`clés FR absentes en EN (${missingInEn.length}) : ${missingInEn.join(', ')}`);
if (missingInFr.length) fail(`clés EN absentes en FR (${missingInFr.length}) : ${missingInFr.join(', ')}`);
if (frKeys.length !== enKeys.length) fail(`nombre de clés différent : fr=${frKeys.length} en=${enKeys.length}`);
const orderDiff = frKeys.filter((k, i) => setEn.has(k) && enKeys[i] !== k);
if (!missingInEn.length && !missingInFr.length && orderDiff.length) {
  fail(`ordre des clés différent (${orderDiff.length} position(s)), première : ${orderDiff[0]}`);
}

// --- 4. valeurs non vides ----------------------------------------------------
let empty = 0;
let nonString = 0;
for (const lang of ['fr', 'en']) {
  for (const [k, v] of Object.entries(data[lang])) {
    if (typeof v !== 'string') { nonString += 1; fail(`${lang} ${k} : valeur non textuelle`); continue; }
    if (v.trim() === '') { empty += 1; fail(`${lang} ${k} : valeur vide`); }
  }
}

// --- 5. moustaches -----------------------------------------------------------
const PH = /\{\{([^{}]*)\}\}/g;
const placeholders = (s) => {
  const found = [];
  let m;
  PH.lastIndex = 0;
  while ((m = PH.exec(s)) !== null) found.push(m[1]);
  return found.sort().join(',');
};
let phMismatch = 0;
let phBadSyntax = 0;
for (const k of frKeys) {
  if (!(k in data.en)) continue;
  const fr = data.fr[k];
  const en = data.en[k];
  if (typeof fr !== 'string' || typeof en !== 'string') continue;
  if (placeholders(fr) !== placeholders(en)) {
    phMismatch += 1;
    fail(`moustaches divergentes ${k} : fr={${placeholders(fr)}} en={${placeholders(en)}}`);
  }
  for (const [lang, v] of [['fr', fr], ['en', en]]) {
    const braces = (v.match(/\{|\}/g) || []).length;
    const pairs = (v.match(/\{\{[^{}]+\}\}/g) || []).length;
    if (braces !== pairs * 4) {
      phBadSyntax += 1;
      fail(`${lang} ${k} : moustache mal formée — ${JSON.stringify(v)}`);
    }
    if (/\{\{\s|\s\}\}/.test(v)) {
      phBadSyntax += 1;
      fail(`${lang} ${k} : espace dans une moustache — ${JSON.stringify(v)}`);
    }
  }
}

// --- 6. libellés de bouton <= 20 caractères ---------------------------------
let longest = { len: 0, key: '', value: '' };
const missingButtons = BUTTON_KEYS.filter((k) => !(k in data.fr));
if (missingButtons.length) fail(`clés de bouton déclarées mais absentes : ${missingButtons.join(', ')}`);
for (const k of BUTTON_KEYS) {
  for (const lang of ['fr', 'en']) {
    const v = data[lang][k];
    if (typeof v !== 'string') continue;
    // les moustaches comptent pour ce qu'elles affichent au pire : 6 caractères
    const shown = v.replace(/\{\{[^{}]+\}\}/g, '······');
    if (shown.length > MAX_BUTTON) fail(`${lang} ${k} : libellé de bouton ${shown.length} > ${MAX_BUTTON} car. — ${JSON.stringify(v)}`);
    if (shown.length > longest.len) longest = { len: shown.length, key: `${lang} ${k}`, value: v };
  }
}

// --- 7. bundle design/i18n.json synchronisé ---------------------------------
let bundleSync = 'absent';
try {
  const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8'));
  const sameKeys = (a, b) => a.length === b.length && a.every((k, i) => b[i] === k);
  const equal = (a, b) => a.every(([k, v]) => b[k] === v);
  const frOk = bundle.fr && sameKeys(frKeys, Object.keys(bundle.fr)) && equal(Object.entries(data.fr), bundle.fr);
  const enOk = bundle.en && sameKeys(enKeys, Object.keys(bundle.en)) && equal(Object.entries(data.en), bundle.en);
  bundleSync = frOk && enOk ? 'ok' : 'désynchronisé';
  if (!(frOk && enOk)) fail('design/i18n.json ne reflète pas exactement i18n/fr.json + i18n/en.json');
} catch (err) {
  fail(`design/i18n.json illisible — ${err.message}`);
}

// --- 8. typographie ----------------------------------------------------------
let quoteErrors = 0;
for (const k of frKeys) {
  if (!(k in data.en)) continue;
  const fr = data.fr[k];
  const en = data.en[k];
  if (typeof fr !== 'string' || typeof en !== 'string') continue;
  const frQuoted = /[«»]/.test(fr);
  const enQuoted = /[“”]/.test(en);
  if (frQuoted !== enQuoted) { quoteErrors += 1; fail(`${k} : guillemets présents d'un seul côté (fr=${frQuoted} en=${enQuoted})`); }
  if (/"/.test(fr)) { quoteErrors += 1; fail(`${k} : guillemet droit " dans la chaîne FR — utiliser « » (${JSON.stringify(fr)})`); }
  if (/^\s|\s$/.test(fr) || /^\s|\s$/.test(en)) { quoteErrors += 1; fail(`${k} : espace en début ou fin de libellé`); }
}

// --- rapport ----------------------------------------------------------------
function report() {
  lines.push(`I18N files=design/i18n/fr.json,design/i18n/en.json bundle=design/i18n.json`);
  lines.push(`I18N keys fr=${frKeys.length} en=${enKeys.length} duplicate=${(dupCount.fr || 0) + (dupCount.en || 0)} empty=${empty} nonString=${nonString}`);
  lines.push(`I18N parity missingInEn=${missingInEn.length} missingInFr=${missingInFr.length} orderDiff=${orderDiff.length}`);
  lines.push(`I18N placeholders mismatch=${phMismatch} badSyntax=${phBadSyntax}`);
  lines.push(`I18N buttons=${BUTTON_KEYS.length} maxLen=${longest.len}<=${MAX_BUTTON} (${longest.key} = ${JSON.stringify(longest.value)})`);
  lines.push(`I18N typography quoteErrors=${quoteErrors}`);
  lines.push(`I18N bundle=${bundleSync}`);
  if (failures.length) {
    lines.push(`I18N failures=${failures.length}`);
    for (const f of failures) lines.push(`  - ${f}`);
  }
  const pass = failures.length === 0 && frKeys.length > 0 && frKeys.length === enKeys.length;
  lines.push(`I18N RESULT=${pass ? 'PASS' : 'FAIL'}`);
  console.log(lines.join('\n'));
  process.exit(pass ? 0 : 1);
}
report();
