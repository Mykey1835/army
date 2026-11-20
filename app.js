// Army-Plattform – Oberfläche (ohne Build-Schritt). Rechte prüft die Datenbank (supabase/schema.sql).
'use strict';

const cfg = window.ARMY_CONFIG || {};
const app = document.getElementById('app');
const nav = document.getElementById('tabs');
let sb = null;
let ich = null;          // eigenes Mitglied
let kdt = false, ordonnanz = false, protokoll = false;
const DRIVE_ORDNER = '1GsFzMs69qApcSjvBIWe8gyvnA0NucvnE'; // Kopie aus sokol-agents docs/ordner-ids.md (ARMY)
const WAPPEN = [{ datei: 'ristl-62.png', name: 'Ristl Schulen 62' }];
let funktionen = [], dienste = [], mitglieder = [];
let auswahl = { dienst: null, funktion: '' };

// ---------- kleine Helfer ----------
function h(tag, attrs, ...kinder) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kinder.flat()) if (k !== null && k !== undefined && k !== false)
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}
const iso = d => d.toISOString().slice(0, 10);
const heute = () => new Date().toLocaleDateString('sv-SE'); // Ortszeit, JJJJ-MM-TT
const istOnline = m => m.zuletzt_online && Date.now() - new Date(m.zuletzt_online).getTime() < 6 * 60 * 1000;
function plusTage(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
function datumCH(s) { if (!s) return '–'; const [j, m, t] = s.split('-'); return `${t}.${m}.${j}`; }
function meldung(text, art) {
  const m = h('div', { class: 'meldung ' + (art || '') }, text);
  document.body.append(m); setTimeout(() => m.remove(), 4000);
}
async function db(p) {
  const { data, error } = await p;
  if (error) { meldung(fehlerText(error.message), 'fehler'); throw error; }
  return data;
}
function fehlerText(t) {
  if (/Database error saving new user|nicht eingeladen/i.test(t)) return 'Diese Adresse ist nicht eingeladen oder hat schon ein Konto. Bitte beim Kdt melden.';
  if (/Invalid login credentials/i.test(t)) return 'Mailadresse oder Passwort falsch.';
  if (/Password should be/i.test(t)) return 'Das Passwort ist zu kurz (mindestens 8 Zeichen).';
  if (/row-level security|violates/i.test(t)) return 'Dafür fehlt die Berechtigung.';
  return t;
}
function dienstStatus(d) {
  const t = heute();
  if (d.freigeschaltet_bis && d.freigeschaltet_bis >= t) return 'freigeschaltet';
  if (t < plusTage(d.beginn, -7)) return 'geplant';
  if (t > plusTage(d.ende, 14)) return 'abgeschlossen';
  return 'offen';
}
const STATUS = { offen: 'offen', vorbereitet: 'vorbereitet', erledigt: 'erledigt (x)', negativ: 'nichts zu melden (n)' };

// ---------- Start ----------
if (!cfg.url || !cfg.key) {
  app.replaceChildren(seite('Army', 'Plattform wird eingerichtet',
    h('section', {}, h('div', { class: 'wrap' }, h('p', {}, 'Die Plattform ist bald bereit. Bitte später wieder vorbeischauen.')))));
} else {
  sb = window.supabase.createClient(cfg.url, cfg.key);
  let angemeldetAls = null;
  // Supabase-Aufrufe nicht direkt im Callback (sonst Hänger), darum setTimeout
  sb.auth.onAuthStateChange((ev, session) => setTimeout(() => {
    if (ev === 'PASSWORD_RECOVERY') return zeigeNeuesPasswort();
    if (ev === 'SIGNED_OUT' || !session) { angemeldetAls = null; return zeigeLogin(); }
    if ((ev === 'SIGNED_IN' || ev === 'INITIAL_SESSION') && angemeldetAls !== session.user.id) {
      angemeldetAls = session.user.id; anmelden();
    }
  }, 0));
}
window.addEventListener('hashchange', () => ich && zeige());
document.querySelector('.menu-btn').addEventListener('click', e => {
  const o = nav.classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', o);
});

function seite(titel, untertitel, ...inhalt) {
  return h('div', {}, h('div', { class: 'pagehead' }, h('div', { class: 'wrap' }, h('h1', {}, titel), untertitel ? h('p', {}, untertitel) : null)), ...inhalt);
}
function abschnitt(titel, ...inhalt) {
  return h('section', {}, h('div', { class: 'wrap' }, titel ? h('h2', {}, titel) : null, ...inhalt));
}

// ---------- Anmeldung ----------
function zeigeLogin(modus) {
  ich = null; nav.replaceChildren();
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', placeholder: 'Militär-Mailadresse' });
  const pw = h('input', { type: 'password', required: modus !== 'vergessen', minlength: 8, autocomplete: modus === 'neu' ? 'new-password' : 'current-password', placeholder: 'Passwort' });
  const formular = h('form', { class: 'formular schmal', onsubmit: async e => {
    e.preventDefault();
    const adr = email.value.trim().toLowerCase();
    if (modus === 'neu') {
      const { data, error } = await sb.auth.signUp({ email: adr, password: pw.value });
      if (error) return meldung(fehlerText(error.message), 'fehler');
      if (!data.session) meldung('Konto erstellt. Bitte die Bestätigungsmail öffnen.', 'ok');
    } else if (modus === 'vergessen') {
      const { error } = await sb.auth.resetPasswordForEmail(adr, { redirectTo: location.origin + location.pathname });
      meldung(error ? fehlerText(error.message) : 'Falls die Adresse eingeladen ist, kommt eine Mail.', error ? 'fehler' : 'ok');
    } else {
      const { error } = await sb.auth.signInWithPassword({ email: adr, password: pw.value });
      if (error) meldung(fehlerText(error.message), 'fehler');
    }
  } },
    h('label', {}, 'Mailadresse', email),
    modus === 'vergessen' ? null : h('label', {}, modus === 'neu' ? 'Neues Passwort (mind. 8 Zeichen)' : 'Passwort', pw),
    h('button', { class: 'btn', type: 'submit' }, modus === 'neu' ? 'Konto erstellen' : modus === 'vergessen' ? 'Link senden' : 'Anmelden'),
    h('p', { class: 'klein' },
      modus ? h('a', { href: '#', onclick: e => { e.preventDefault(); zeigeLogin(); } }, 'Zurück zur Anmeldung') : [
        h('a', { href: '#', onclick: e => { e.preventDefault(); zeigeLogin('neu'); } }, 'Erstes Mal hier? Konto erstellen'), ' · ',
        h('a', { href: '#', onclick: e => { e.preventDefault(); zeigeLogin('vergessen'); } }, 'Passwort vergessen')]));
  app.replaceChildren(seite('Army', 'Plattform für das Kader',
    abschnitt(null, formular,
      h('p', { class: 'klein hinweis' }, 'Zugang nur auf Einladung des Kdt. Keine klassifizierten Inhalte und keine Befehle erfassen.'))));
}

function zeigeNeuesPasswort() {
  const pw = h('input', { type: 'password', required: true, minlength: 8, autocomplete: 'new-password' });
  app.replaceChildren(seite('Neues Passwort', null, abschnitt(null, h('form', { class: 'formular schmal', onsubmit: async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: pw.value });
    if (error) return meldung(fehlerText(error.message), 'fehler');
    meldung('Passwort gespeichert.', 'ok'); location.hash = '#start'; anmelden();
  } }, h('label', {}, 'Neues Passwort (mind. 8 Zeichen)', pw), h('button', { class: 'btn', type: 'submit' }, 'Speichern')))));
}

async function anmelden() {
  ich = await db(sb.rpc('ich'));
  if (!ich || !ich.email) {
    app.replaceChildren(seite('Kein Zugang', null, abschnitt(null, h('p', {}, 'Dein Konto ist nicht oder nicht mehr freigeschaltet. Bitte beim Kdt melden.'),
      h('button', { class: 'btn', onclick: () => sb.auth.signOut() }, 'Abmelden'))));
    return;
  }
  [kdt, ordonnanz, protokoll] = await Promise.all([db(sb.rpc('ist_kdt')), db(sb.rpc('ist_ordonnanz')), db(sb.rpc('ist_protokoll'))]);
  sb.rpc('ping');
  if (!window.__ping) window.__ping = setInterval(() => sb.rpc('ping'), 2 * 60 * 1000);
  await laden();
  baueMenue();
  zeige();
}

async function laden() {
  [funktionen, dienste] = await Promise.all([
    db(sb.from('funktionen').select('*').order('reihenfolge')),
    db(sb.from('dienste').select('*').order('beginn'))]);
  mitglieder = kdt ? await db(sb.from('mitglieder').select('*').order('email')) : [ich];
  if (!auswahl.dienst || !dienste.some(d => d.id === auswahl.dienst)) {
    const t = heute();
    const laufend = dienste.filter(d => dienstStatus(d) !== 'geplant' && dienstStatus(d) !== 'abgeschlossen');
    const naechster = dienste.find(d => d.ende >= t);
    auswahl.dienst = (laufend[0] || naechster || dienste[dienste.length - 1] || {}).id || null;
  }
}

function baueMenue() {
  const reiter = [['start', 'Start'], ['termine', 'Terminliste'], ['rapporte', 'Rapporte']];
  if (kdt) reiter.push(['dienste', 'Dienste'], ['organigramm', 'Organigramm'], ['einstellungen', 'Einstellungen']);
  nav.replaceChildren(...reiter.map(([id, t]) => h('li', {}, h('a', { href: '#' + id }, t))),
    h('li', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); sb.auth.signOut(); } }, 'Abmelden')));
}

function zeige() {
  const seiteId = (location.hash || '#start').slice(1);
  for (const a of nav.querySelectorAll('a')) a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + seiteId);
  nav.classList.remove('open');
  zeigeWappen();
  const nurKdt = ['dienste', 'organigramm', 'einstellungen'];
  if (nurKdt.includes(seiteId) && !kdt) { location.hash = '#start'; return; }
  ({ start: zeigeStart, termine: zeigeTermine, rapporte: zeigeRapporte, dienste: zeigeDienste, organigramm: zeigeOrganigramm, einstellungen: zeigeEinstellungen }[seiteId] || zeigeStart)();
}

function meineFunktion() { return kdt ? 'Kdt' : (ordonnanz ? ich.ober_funktion : ich.funktion); }
function zeigeWappen() {
  const d = dienste.find(x => x.id === auswahl.dienst);
  const img = document.getElementById('wappen'), icon = document.getElementById('favicon');
  if (d && d.wappen) {
    const pfad = '/wappen/' + encodeURIComponent(d.wappen) + '?v=2';
    img.onerror = () => { img.hidden = true; }; // Bild fehlt: nichts Kaputtes zeigen
    img.src = pfad; img.hidden = false; icon.href = pfad;
  }
  else { img.hidden = true; img.removeAttribute('src'); icon.href = 'data:,'; }
}
function dienstWahl(neuZeigen) {
  const kopf = h('div', { class: 'filter' });
  const dWahl = h('select', { onchange: () => { auswahl.dienst = dWahl.value; zeigeWappen(); neuZeigen(); } },
    ...dienste.map(d => h('option', { value: d.id, selected: d.id === auswahl.dienst }, `${d.titel} (${d.art}, ${datumCH(d.beginn)})`)));
  kopf.append(h('label', {}, 'Dienst', dienste.length ? dWahl : h('span', {}, ' – kein Dienst offen')));
  return kopf;
}

// ---------- Start: Anleitung ----------
async function zeigeStart() {
  const meine = meineFunktion();
  let offen = 0;
  if (auswahl.dienst) {
    const { count } = await sb.from('todos').select('id', { count: 'exact', head: true })
      .eq('dienst_id', auswahl.dienst).eq('funktion', meine).in('status', ['offen', 'vorbereitet']);
    offen = count || 0;
  }
  const d = dienste.find(x => x.id === auswahl.dienst);
  app.replaceChildren(seite('Willkommen' + (ich.name ? ', ' + ich.name : ''), `Funktion: ${ich.funktion}${ordonnanz ? ' (für ' + ich.ober_funktion + ')' : ''}`,
    abschnitt('Deine Lage', h('div', { class: 'cards' },
      h('div', { class: 'card' }, h('h3', {}, 'Aktueller Dienst'), d ? h('p', {}, `${d.titel} (${d.art}), ${datumCH(d.beginn)} – ${datumCH(d.ende)}`) : h('p', {}, 'Im Moment ist kein Dienst offen. Die Plattform öffnet eine Woche vor Dienstbeginn.')),
      h('div', { class: 'card' }, h('h3', {}, 'Offene Pendenzen'), h('p', { class: 'gross' }, String(offen)), h('a', { class: 'btn', href: '#termine' }, 'Zur Terminliste'))),
    ),
    h('section', { class: 'alt' }, h('div', { class: 'wrap' }, h('h2', {}, 'So arbeitest du hier'),
      h('ol', { class: 'ablauf' }, ...anleitung().map(([zeit, titel, text]) =>
        h('li', {}, h('div', { class: 'zeit' }, zeit), h('div', { class: 'schritt' }, h('h3', {}, titel), h('p', {}, text))))))),
    abschnitt('Dienstablauf', h('ul', { class: 'timeline' },
      ...[['vor dem Dienst', 'Erste Pendenzen der Terminliste, teilweise Monate vor Dienstbeginn.'],
          ['URB', 'Unterstützungsrapport Bataillon: Vorbereitung auf Stufe Bataillon.'],
          ['URE', 'Unterstützungsrapport Einheit: Aufträge und Termine für die Funktionen.'],
          ['KVK', 'Kadervorkurs: das Kader rückt vor der Truppe ein.'],
          ['Dienst', 'Wochenplan im Picasso, tägliche Rapporte, Pendenzen nach Terminliste.'],
          ['nach dem Dienst', 'Letzte Pendenzen, meist in den zwei Wochen danach.']]
        .map(([z, t]) => h('li', {}, h('span', { class: 'when' }, z), t)))),
    h('section', { class: 'alt' }, h('div', { class: 'wrap' }, h('h2', {}, 'Grundsätze'), h('ul', { class: 'liste' },
      h('li', {}, 'Vom Kdt gesetzte Termine (🔒) gelten und werden nicht verschoben.'),
      h('li', {}, 'Eigene Termine plant jede Funktion selbst. Verzug sofort melden, mit Grund und Vorschlag.'),
      h('li', {}, 'Erledigt mit «x», nichts zu melden mit «n» (Negativmeldung).'),
      h('li', {}, 'Ordonnanzen melden «vorbereitet» an ihre Funktion; die Funktion prüft und schliesst ab.'),
      h('li', {}, 'Keine Befehle, keine klassifizierten Unterlagen und keine Personaldaten erfassen.'))))));
}
function anleitung() {
  if (ordonnanz) return [
    ['1', 'Terminliste öffnen', `Du siehst die Pendenzen der Funktion ${ich.ober_funktion}.`],
    ['2', 'Vorbereiten', 'Erledige die Vorarbeit und drücke «Vorbereitet melden».'],
    ['3', 'Funktion schliesst ab', 'Die Funktion prüft und hakt ab oder gibt mit Notiz zurück.'],
    ['4', 'Rapporte', protokoll ? 'Unter «Rapporte» führst du die Mitschrift: Punkte jeder Funktion und Abmachungen erfassen, am Schluss abschliessen.' : `Unter «Rapporte» kannst du die Punkte für ${ich.ober_funktion} vorbereiten.`]];
  const a = [
    ['1', 'Terminliste öffnen', 'Oben den Dienst wählen. Zuoberst steht, was noch keinen Termin hat.'],
    ['2', 'Pendenzen erfassen', 'Eigene To-dos mit Datum oder relativ zum Dienst («3 Tage vor Beginn»). Haken «dienstübergreifend»: kommt im nächsten Dienst für deine Funktion wieder.'],
    ['3', 'Melden', '«Erledigt (x)» oder «Nichts zu melden (n)». Meldet deine Ordonnanz «vorbereitet», prüfst du und schliesst ab.'],
    ['4', 'Rapporte', 'Unter «Rapporte» trägst du vor dem DR oder KR deine Punkte im eigenen Feld ein. Abmachungen landen automatisch in deiner Terminliste; offene kommen am nächsten Rapport wieder.']];
  if (kdt) a.push(['5', 'Führen', 'Unter «Dienste» Dienste anlegen und freischalten, unter «Organigramm» sehen, wer online ist und wer was offen hat, unter «Einstellungen» Leute einladen.']);
  if (kdt) a.push(['6', 'Unterlagen hochladen', 'Unter «Einstellungen» steht «Was lade ich wo hoch?»: Terminliste direkt bei Dienste importieren, Picasso als PDF in den Drive-Ordner Army legen und Claude die Rapport-Liste machen lassen.']);
  return a;
}

// ---------- Terminliste ----------
async function zeigeTermine() {
  const kopf = dienstWahl(zeigeTermine);
  if (kdt) kopf.append(h('label', {}, 'Funktion', h('select', { onchange: e => { auswahl.funktion = e.target.value; zeigeTermine(); } },
    h('option', { value: '' }, 'alle'), ...funktionen.filter(f => f.typ !== 'Ordonnanz').map(f => h('option', { value: f.code, selected: f.code === auswahl.funktion }, f.code)))));
  const inhalt = h('div', {});
  app.replaceChildren(seite('Terminliste', null, abschnitt(null, kopf, inhalt)));
  if (!auswahl.dienst) return;
  let abfrage = sb.from('todos').select('*').eq('dienst_id', auswahl.dienst).order('datum', { nullsFirst: true }).order('erstellt');
  if (kdt && auswahl.funktion) abfrage = abfrage.eq('funktion', auswahl.funktion);
  if (!kdt) abfrage = abfrage.eq('funktion', meineFunktion()); // Abmachungen anderer stehen nur im Rapport
  const todos = await db(abfrage);
  const ohne = todos.filter(t => !t.datum), mit = todos.filter(t => t.datum);
  if (!ordonnanz) inhalt.append(h('button', { class: 'btn', onclick: () => todoFormular() }, '+ Neues To-do'));
  if (ohne.length) inhalt.append(h('h3', { class: 'zwischen' }, `Noch nicht terminiert (${ohne.length})`), tabelle(ohne));
  inhalt.append(h('h3', { class: 'zwischen' }, 'Terminiert'), mit.length ? tabelle(mit) : h('p', {}, 'Keine Einträge.'));
}

function tabelle(todos) {
  const t = heute();
  return h('div', { class: 'tabelle' }, ...todos.map(x => {
    const fertig = x.status === 'erledigt' || x.status === 'negativ';
    const zuSpaet = x.datum && x.datum < t && !fertig;
    return h('div', { class: 'zeile' + (fertig ? ' fertig' : '') + (zuSpaet ? ' spaet' : '') },
      h('div', { class: 'datum' }, x.gesperrt ? '🔒 ' : '', datumCH(x.datum),
        x.anker ? h('span', { class: 'klein' }, ` ${Math.abs(x.tage)} T ${x.tage < 0 ? 'vor' : 'nach'} ${x.anker}`) : null),
      h('div', { class: 'was' }, h('strong', {}, x.was),
        h('span', { class: 'klein' }, [kdt ? x.funktion : null, x.grundlage, x.an_wen ? 'an ' + x.an_wen : null, x.wie, x.dienstuebergreifend ? 'dienstübergreifend' : null, x.rapport_id ? 'Abmachung aus Rapport' : null].filter(Boolean).join(' · ')),
        x.notiz ? h('span', { class: 'notiz' }, 'Notiz: ' + x.notiz) : null),
      h('div', { class: 'status s-' + x.status }, x.status === 'vorbereitet' ? 'vorbereitet von Ordonnanz' : STATUS[x.status]),
      h('div', { class: 'knoepfe' }, ...aktionen(x)));
  }));
}

function aktionen(x) {
  const k = [];
  const setze = (status, notiz) => async () => {
    const neu = { status }; if (notiz !== undefined) neu.notiz = notiz;
    await db(sb.from('todos').update(neu).eq('id', x.id)); zeigeTermine();
  };
  if (ordonnanz) {
    if (x.status === 'offen') k.push(h('button', { class: 'btn klein', onclick: setze('vorbereitet') }, 'Vorbereitet melden'));
    if (x.status === 'vorbereitet') k.push(h('button', { class: 'btn light klein', onclick: setze('offen') }, 'Zurücknehmen'));
    return k;
  }
  if (x.status === 'offen' || x.status === 'vorbereitet') {
    k.push(h('button', { class: 'btn klein', onclick: setze('erledigt') }, 'x Erledigt'),
           h('button', { class: 'btn light klein', onclick: setze('negativ') }, 'n'));
    if (x.status === 'vorbereitet') k.push(h('button', { class: 'btn light klein', onclick: () => {
      const n = prompt('Was fehlt noch? (Notiz an die Ordonnanz)'); if (n !== null) setze('offen', n.slice(0, 1000))(); } }, 'Zurückgeben'));
  } else k.push(h('button', { class: 'btn light klein', onclick: setze('offen') }, 'Wieder öffnen'));
  k.push(h('button', { class: 'btn light klein', onclick: () => todoFormular(x) }, 'Bearbeiten'));
  return k;
}

function todoFormular(x) {
  x = x || {};
  const gesperrt = x.gesperrt && !kdt;
  const f = {
    was: h('input', { value: x.was || '', required: true, maxlength: 500, disabled: gesperrt }),
    funktion: h('select', { disabled: !kdt }, ...funktionen.filter(z => z.typ !== 'Ordonnanz').map(z =>
      h('option', { value: z.code, selected: z.code === (x.funktion || (kdt ? auswahl.funktion || 'Kdt' : ich.funktion)) }, z.code))),
    art: h('select', { disabled: gesperrt }, h('option', { value: 'kein' }, 'noch kein Termin'), h('option', { value: 'datum', selected: !!x.datum && !x.anker }, 'Datum'), h('option', { value: 'relativ', selected: !!x.anker }, 'relativ zum Dienst')),
    datum: h('input', { type: 'date', value: x.anker ? '' : (x.datum || ''), disabled: gesperrt }),
    tage: h('input', { type: 'number', min: 0, max: 400, value: x.anker ? Math.abs(x.tage) : '', disabled: gesperrt }),
    rel: h('select', { disabled: gesperrt }, ...[['-Beginn', 'Tage vor Beginn'], ['+Beginn', 'Tage nach Beginn'], ['-Ende', 'Tage vor Ende'], ['+Ende', 'Tage nach Ende']].map(([v, t]) =>
      h('option', { value: v, selected: x.anker && v === (x.tage < 0 ? '-' : '+') + x.anker }, t))),
    grundlage: h('input', { value: x.grundlage || '', disabled: gesperrt }), an_wen: h('input', { value: x.an_wen || '', disabled: gesperrt }),
    wie: h('select', { disabled: gesperrt }, ...['', 'schriftlich', 'mündlich'].map(v => h('option', { value: v, selected: v === (x.wie || '') }, v || '–'))),
    ueber: h('input', { type: 'checkbox', checked: !!x.dienstuebergreifend, disabled: gesperrt }),
    gesperrt: h('input', { type: 'checkbox', checked: x.id ? !!x.gesperrt : true }),
    notiz: h('textarea', { maxlength: 1000 }, x.notiz || ''),
  };
  const dialog = h('dialog', { class: 'dialog' });
  dialog.append(h('form', { class: 'formular', onsubmit: async e => {
    e.preventDefault();
    const daten = { was: f.was.value.trim(), grundlage: f.grundlage.value.trim() || null, an_wen: f.an_wen.value.trim() || null,
      wie: f.wie.value || null, dienstuebergreifend: f.ueber.checked, notiz: f.notiz.value.trim() || null };
    if (kdt) { daten.funktion = f.funktion.value; daten.gesperrt = f.gesperrt.checked && f.art.value !== 'kein'; } // ohne Termin: Funktion plant selbst
    if (!gesperrt) {
      if (f.art.value === 'relativ') { const v = f.rel.value; daten.anker = v.slice(1); daten.tage = (v[0] === '-' ? -1 : 1) * (parseInt(f.tage.value, 10) || 0); daten.datum = null; }
      else { daten.anker = null; daten.tage = null; daten.datum = f.art.value === 'datum' ? f.datum.value || null : null; }
    }
    if (gesperrt) { for (const k of Object.keys(daten)) if (k !== 'notiz') delete daten[k]; }
    if (x.id) await db(sb.from('todos').update(daten).eq('id', x.id));
    else {
      daten.dienst_id = auswahl.dienst;
      if (!kdt) daten.funktion = ich.funktion;
      await db(sb.from('todos').insert(daten));
    }
    dialog.close(); dialog.remove(); zeigeTermine();
  } },
    h('h3', {}, x.id ? 'To-do bearbeiten' : 'Neues To-do'),
    h('label', {}, 'Was', f.was),
    kdt ? h('label', {}, 'Funktion', f.funktion) : null,
    gesperrt ? h('p', { class: 'hinweis' }, '🔒 Vom Kdt gesetzt: nur die Notiz ist änderbar.') : null,
    h('label', {}, 'Termin', f.art),
    h('div', { class: 'reihe' }, h('label', {}, 'Datum', f.datum), h('label', {}, 'Tage', f.tage), h('label', {}, 'relativ', f.rel)),
    h('div', { class: 'reihe' }, h('label', {}, 'Grundlage', f.grundlage), h('label', {}, 'an wen', f.an_wen), h('label', {}, 'wie', f.wie)),
    h('label', { class: 'haken' }, f.ueber, 'dienstübergreifend (kommt im nächsten Dienst wieder)'),
    kdt ? h('label', { class: 'haken' }, f.gesperrt, '🔒 Termin sperren (gilt nur mit Termin; Funktion kann ihn nicht verschieben)') : null,
    h('label', {}, 'Notiz', f.notiz),
    h('div', { class: 'knoepfe' }, h('button', { class: 'btn', type: 'submit' }, 'Speichern'),
      h('button', { class: 'btn light', type: 'button', onclick: () => { dialog.close(); dialog.remove(); } }, 'Abbrechen'))));
  document.body.append(dialog); dialog.showModal();
}

// ---------- Dienste (Kdt) ----------
async function zeigeDienste() {
  const teil = await db(sb.from('dienst_teilnehmer').select('*'));
  const liste = h('div', { class: 'tabelle' }, ...dienste.map(d => {
    const st = dienstStatus(d);
    const anzahl = d.nur_teilnehmer ? teil.filter(t => t.dienst_id === d.id).length : 0;
    return h('div', { class: 'zeile' },
      h('div', { class: 'datum' }, `${datumCH(d.beginn)} – ${datumCH(d.ende)}`),
      h('div', { class: 'was' }, h('strong', {}, `${d.titel} (${d.art})`), h('span', { class: 'klein' }, d.nur_teilnehmer ? `nur ${anzahl} Teilnehmer` : 'alle Mitglieder')),
      h('div', { class: 'status s-' + (st === 'geplant' ? 'offen' : 'erledigt') }, st === 'geplant' ? `geplant, öffnet ${datumCH(plusTage(d.beginn, -7))}` : st),
      h('div', { class: 'knoepfe' },
        h('button', { class: 'btn light klein', onclick: async () => {
          await db(sb.from('dienste').update({ freigeschaltet_bis: d.freigeschaltet_bis >= heute() ? null : plusTage(heute(), 7) }).eq('id', d.id));
          await laden(); zeigeDienste(); } }, d.freigeschaltet_bis >= heute() ? 'Freischaltung aufheben' : 'Freischalten (7 Tage)'),
        h('button', { class: 'btn light klein', onclick: () => terminlisteImport(d) }, 'Terminliste importieren'),
        st === 'geplant' ? h('button', { class: 'btn light klein', onclick: () => dienstFormular(d, teil) }, 'Bearbeiten') : h('span', { class: 'klein' }, 'Ändern unter Einstellungen')));
  }));
  app.replaceChildren(seite('Dienste', 'Dienst, KVK, URE, URB', abschnitt(null,
    h('button', { class: 'btn', onclick: () => dienstFormular({}, teil) }, '+ Neuer Dienst'),
    h('p', { class: 'klein' }, 'Das Team sieht einen Dienst ab 7 Tage vor Beginn bis 14 Tage nach Ende. Dienstübergreifende To-dos des letzten Dienstes gleicher Art werden beim Anlegen übernommen.'),
    liste)));
}

function dienstFormular(d, teil) {
  const f = {
    art: h('select', {}, ...['Dienst', 'KVK', 'URE', 'URB'].map(a => h('option', { selected: a === d.art }, a))),
    titel: h('input', { value: d.titel || '', required: true, placeholder: 'z. B. WK 2027' }),
    beginn: h('input', { type: 'date', value: d.beginn || '', required: true }),
    ende: h('input', { type: 'date', value: d.ende || '', required: true }),
    wappen: h('select', {}, h('option', { value: '' }, 'kein Wappen'), ...WAPPEN.map(w => h('option', { value: w.datei, selected: w.datei === d.wappen }, w.name))),
  };
  const gewaehlt = new Set(teil.filter(t => t.dienst_id === d.id).map(t => t.email));
  const nur = h('input', { type: 'checkbox', checked: !!d.nur_teilnehmer });
  const haken = mitglieder.filter(m => m.aktiv).map(m => h('input', { type: 'checkbox', value: m.email, checked: gewaehlt.has(m.email) }));
  const dialog = h('dialog', { class: 'dialog' });
  dialog.append(h('form', { class: 'formular', onsubmit: async e => {
    e.preventDefault();
    if (f.ende.value < f.beginn.value) return meldung('Ende liegt vor Beginn.', 'fehler');
    const daten = { art: f.art.value, titel: f.titel.value.trim(), beginn: f.beginn.value, ende: f.ende.value, nur_teilnehmer: nur.checked, wappen: f.wappen.value || null };
    const gespeichert = d.id ? await db(sb.from('dienste').update(daten).eq('id', d.id).select().single())
                             : await db(sb.from('dienste').insert(daten).select().single());
    await db(sb.rpc('teilnehmer_setzen', { d_id: gespeichert.id, nur: nur.checked, adressen: haken.filter(c => c.checked).map(c => c.value) }));
    dialog.close(); dialog.remove(); auswahl.dienst = gespeichert.id; await laden(); zeige();
  } },
    h('h3', {}, d.id ? 'Dienst bearbeiten' : 'Neuer Dienst'),
    h('div', { class: 'reihe' }, h('label', {}, 'Art', f.art), h('label', {}, 'Titel', f.titel)),
    h('div', { class: 'reihe' }, h('label', {}, 'Beginn', f.beginn), h('label', {}, 'Ende', f.ende), h('label', {}, 'Wappen', f.wappen)),
    h('label', { class: 'haken' }, nur, 'Nur für ausgewählte Teilnehmer (sonst alle Mitglieder)'),
    h('div', { class: 'haken-liste' }, ...haken.map((c, i) => h('label', { class: 'haken' }, c, mitglieder.filter(m => m.aktiv)[i].name || c.value))),
    h('div', { class: 'knoepfe' }, h('button', { class: 'btn', type: 'submit' }, 'Speichern'),
      h('button', { class: 'btn light', type: 'button', onclick: () => { dialog.close(); dialog.remove(); } }, 'Abbrechen'))));
  document.body.append(dialog); dialog.showModal();
}

// ---------- Organigramm (Kdt) ----------
const typVon = code => (funktionen.find(f => f.code === code) || {}).typ;
function personZeile(m) {
  return h('li', {}, h('span', { class: 'punkt' + (istOnline(m) ? ' an' : '') }), m.name || m.email,
    h('span', { class: 'klein' }, istOnline(m) ? ' online' : m.user_id ? (m.zuletzt_online ? ' zuletzt ' + new Date(m.zuletzt_online).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : ' noch nie online') : ' eingeladen, kein Konto'));
}
async function zuteilen(email, ober) {
  await db(sb.from('mitglieder').update({ ober_funktion: ober || null }).eq('email', email));
  zeigeOrganigramm();
}
function dropZiel(el, ober) {
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('ueber'); });
  el.addEventListener('dragleave', () => el.classList.remove('ueber'));
  el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('ueber'); const m = e.dataTransfer.getData('text/plain'); if (m) zuteilen(m, ober); });
  return el;
}
function ordonnanzChip(m) {
  const wahl = h('select', { 'aria-label': 'zuteilen', onchange: e => zuteilen(m.email, e.target.value) },
    h('option', { value: '' }, '–'), ...funktionen.filter(f => f.typ !== 'Ordonnanz').map(f => h('option', { value: f.code, selected: f.code === m.ober_funktion }, f.code)));
  return h('div', { class: 'chip', draggable: 'true', title: 'Ziehen, um zuzuteilen', ondragstart: e => e.dataTransfer.setData('text/plain', m.email) },
    h('span', { class: 'punkt' + (istOnline(m) ? ' an' : '') }), m.name || m.email, wahl);
}
function einladenDialog(vorgabe) {
  const f = { email: h('input', { type: 'email', required: true, placeholder: 'Mailadresse' }), name: h('input', { placeholder: 'Name (freiwillig)' }),
    funktion: h('select', {}, ...funktionen.map(x => h('option', { selected: x.code === vorgabe.funktion }, x.code))),
    ober: h('select', {}, h('option', { value: '' }, '–'), ...funktionen.filter(x => x.typ !== 'Ordonnanz').map(x => h('option', { selected: x.code === vorgabe.ober }, x.code))) };
  const dialog = h('dialog', { class: 'dialog' });
  dialog.append(h('form', { class: 'formular', onsubmit: async e => {
    e.preventDefault();
    await db(sb.from('mitglieder').insert({ email: f.email.value.trim().toLowerCase(), name: f.name.value.trim() || null, funktion: f.funktion.value, ober_funktion: typVon(f.funktion.value) === 'Ordonnanz' ? f.ober.value || null : null }));
    meldung('Eingeladen. Die Person erstellt ihr Konto selbst unter «Erstes Mal hier?».', 'ok');
    dialog.close(); dialog.remove(); zeige();
  } }, h('h3', {}, 'Person einladen'), h('label', {}, 'Mail', f.email), h('label', {}, 'Name', f.name),
    h('div', { class: 'reihe' }, h('label', {}, 'Funktion', f.funktion), h('label', {}, 'Ordonnanz für', f.ober)),
    h('p', { class: 'klein' }, 'Die Person öffnet army.mikesokol.ch, wählt «Erstes Mal hier? Konto erstellen» und setzt ihr Passwort.'),
    h('div', { class: 'knoepfe' }, h('button', { class: 'btn', type: 'submit' }, 'Einladen'),
      h('button', { class: 'btn light', type: 'button', onclick: () => { dialog.close(); dialog.remove(); } }, 'Abbrechen'))));
  document.body.append(dialog); dialog.showModal();
}
async function zeigeOrganigramm() {
  await laden(); // frische Online-Zeiten
  const todos = auswahl.dienst ? await db(sb.from('todos').select('funktion,status,datum').eq('dienst_id', auswahl.dienst)) : [];
  const t = heute();
  const d = dienste.find(x => x.id === auswahl.dienst);
  const aktiv = mitglieder.filter(m => m.aktiv);
  const ordonnanzen = aktiv.filter(m => typVon(m.funktion) === 'Ordonnanz');
  const knoten = f => {
    const leute = aktiv.filter(m => m.funktion === f.code);
    const eigene = todos.filter(x => x.funktion === f.code);
    const offen = eigene.filter(x => x.status === 'offen').length;
    const vorb = eigene.filter(x => x.status === 'vorbereitet').length;
    const spaet = eigene.filter(x => x.datum && x.datum < t && (x.status === 'offen' || x.status === 'vorbereitet')).length;
    return dropZiel(h('div', { class: 'knoten' + (f.typ === 'Kdt' ? ' oben' : '') },
      h('h3', {}, f.code),
      leute.length ? h('ul', { class: 'leute' }, ...leute.map(personZeile))
        : h('button', { class: 'btn light klein', onclick: () => einladenDialog({ funktion: f.code }) }, '+ besetzen'),
      h('p', { class: 'klein' }, `${offen} offen · ${vorb} vorbereitet` + (spaet ? ` · ${spaet} überfällig` : '')),
      h('div', { class: 'chips' }, ...ordonnanzen.filter(m => m.ober_funktion === f.code).map(ordonnanzChip)),
      h('div', { class: 'knoepfe links' },
        h('button', { class: 'btn light klein', onclick: () => einladenDialog({ funktion: 'Ordonnanz', ober: f.code }) }, '+ Ordonnanz'),
        h('a', { class: 'btn light klein', href: '#termine', onclick: () => { auswahl.funktion = f.code; } }, 'Pendenzen'))), f.code);
  };
  const ebene = (cls, liste) => h('div', { class: 'ebene ' + cls }, ...liste.map(knoten));
  const ohne = ordonnanzen.filter(m => !m.ober_funktion);
  app.replaceChildren(seite('Organigramm', d ? `${d.titel} (${d.art})` : 'kein Dienst gewählt', abschnitt(null,
    h('p', { class: 'klein' }, 'Ordonnanzen auf eine Funktion ziehen (oder im Feld wählen), um sie zuzuteilen.'),
    h('div', { class: 'baum' },
      ebene('e1', funktionen.filter(f => f.typ === 'Kdt')),
      ebene('e2', funktionen.filter(f => f.typ === 'Kdt Stv')),
      ebene('e3', funktionen.filter(f => !['Kdt', 'Kdt Stv', 'Ordonnanz'].includes(f.typ)))),
    dropZiel(h('div', { class: 'pool' }, h('h3', {}, `Ordonnanzen ohne Zuteilung (${ohne.length})`),
      h('div', { class: 'chips' }, ...ohne.map(ordonnanzChip)),
      h('button', { class: 'btn light klein', onclick: () => einladenDialog({ funktion: 'Ordonnanz' }) }, '+ Ordonnanz einladen')), null))));
}

// ---------- Rapporte ----------
const fertig = x => x.status === 'erledigt' || x.status === 'negativ';
const RAPPORTART = { DR: 'Dienstrapport', KR: 'Kompanierapport', LIK: 'Lagerapport im Kampf (LIK)' };
const rapportName = r => `${RAPPORTART[r.art] || r.art} ${datumCH(r.datum)}${r.zeit ? ', ' + r.zeit : ''}`;
// PALF: Personelles, Ausbildung, Logistik, Führung (je Rückblick/Ausblick), dann Divers. Im DR ohne Ausbildung.
const PALF = [['p', 'Personelles'], ['a', 'Ausbildung'], ['l', 'Logistik'], ['f', 'Führung']];
const abschnitte = art => [...PALF.filter(([k]) => !(art === 'DR' && k === 'a')).flatMap(([k, n]) => [[k + '_rueck', n, 'Rückblick'], [k + '_aus', n, 'Ausblick']]), ['divers', 'Divers', '']];
// Reihenfolge im Rapport: Kdt, Four, Hptfw, Zfhr 1…n, Kdt Stv, übrige
const RANG = { 'Kdt': 0, 'Four': 1, 'Hptfw': 2, 'Zfhr': 3, 'Kdt Stv': 4 };
const rapportReihenfolge = () => funktionen.filter(f => f.typ !== 'Ordonnanz')
  .sort((x, y) => ((RANG[x.typ] ?? 9) - (RANG[y.typ] ?? 9)) || x.code.localeCompare(y.code, 'de', { numeric: true }));
async function zeigeRapporte() {
  const inhalt = h('div', {});
  app.replaceChildren(seite('Rapporte', 'Dienstrapport (DR), Kompanierapport (KR), Lagerapport im Kampf (LIK)', abschnitt(null, dienstWahl(zeigeRapporte), inhalt)));
  if (!auswahl.dienst) return;
  const raps = await db(sb.from('rapporte').select('*').eq('dienst_id', auswahl.dienst).order('datum').order('zeit'));
  const ids = raps.map(r => r.id);
  const [beitr, abm] = ids.length ? await Promise.all([
    db(sb.from('rapport_beitraege').select('*').in('rapport_id', ids)),
    db(sb.from('todos').select('*').in('rapport_id', ids))]) : [[], []];
  if (protokoll) inhalt.append(h('div', { class: 'knoepfe links' }, h('button', { class: 'btn', onclick: () => rapportFormular() }, '+ Neuer Rapport'),
    h('button', { class: 'btn light', onclick: () => rapporteEinfuegen(raps) }, 'Rapporte einfügen (Liste von Claude)')));
  const offen = raps.filter(r => !r.abgeschlossen), alt = raps.filter(r => r.abgeschlossen).reverse();
  if (!offen.length) inhalt.append(h('p', {}, 'Kein offener Rapport.' + (protokoll ? '' : ' Der Kdt oder seine Ordonnanz eröffnet ihn.')));
  for (const r of offen) inhalt.append(rapportBlock(r, raps, beitr, abm, true));
  if (alt.length) inhalt.append(h('details', { class: 'archiv' }, h('summary', {}, `Archiv (${alt.length} Rapporte)`),
    ...alt.map(r => h('details', { class: 'alt-rapport' }, h('summary', {}, rapportName(r)), rapportBlock(r, raps, beitr, abm, false)))));
}

function rapportBlock(r, raps, beitr, abm, offen) {
  const block = h('div', { class: 'rapport' });
  if (offen) block.append(h('h2', {}, rapportName(r)));
  // Erwartete Leistung: offene Abmachungen früherer Rapporte gleicher Art, fällig bis heute oder ohne Termin
  if (offen) {
    const frueher = new Set(raps.filter(x => x.art === r.art && x.id !== r.id && (x.datum < r.datum || (x.datum === r.datum && (x.zeit || '') < (r.zeit || '')))).map(x => x.id));
    const pend = abm.filter(a => frueher.has(a.rapport_id) && !fertig(a) && (!a.datum || a.datum <= r.datum));
    block.append(h('h3', { class: 'zwischen' }, `Pendenzen aus früheren Rapporten (${pend.length})`),
      pend.length ? h('div', { class: 'tabelle' }, ...pend.map(a => abmZeile(a))) : h('p', { class: 'klein' }, 'Keine.'));
  }
  // Beiträge der Funktionen nach PALF
  block.append(h('h3', { class: 'zwischen' }, 'Punkte der Funktionen (PALF)'));
  const teile = abschnitte(r.art);
  for (const f of rapportReihenfolge()) {
    const eigene = beitr.filter(x => x.rapport_id === r.id && x.funktion === f.code && x.text);
    const darf = offen && (protokoll || f.code === meineFunktion());
    if (!darf && !eigene.length && !offen) continue;
    const text = k => (eigene.find(x => x.abschnitt === k) || {}).text || '';
    const karte = h('details', { class: 'beitrag' + (f.code === meineFunktion() ? ' meins' : ''), open: darf || eigene.length ? true : null },
      h('summary', {}, f.code, eigene.length ? '' : h('span', { class: 'klein' }, ' – noch nichts eingetragen')));
    if (darf) {
      const felder = {};
      const raster = h('div', { class: 'palf' });
      let gruppe = '';
      for (const [k, name, teil] of teile) {
        if (name !== gruppe) { raster.append(h('h4', {}, name)); gruppe = name; }
        felder[k] = h('textarea', { maxlength: 5000, 'aria-label': `${name} ${teil}`.trim(), placeholder: teil || 'Weitere Punkte' }, text(k));
        raster.append(h('label', { class: k === 'divers' ? 'voll' : null }, teil, felder[k]));
      }
      const stand = h('span', { class: 'klein' });
      karte.append(raster, h('div', { class: 'knoepfe links' }, h('button', { class: 'btn klein', onclick: async () => {
        const zeilen = teile.map(([k]) => ({ rapport_id: r.id, funktion: f.code, abschnitt: k, text: felder[k].value }))
          .filter(z => z.text.trim() || text(z.abschnitt));
        if (zeilen.length) await db(sb.from('rapport_beitraege').upsert(zeilen));
        stand.textContent = 'gespeichert ' + new Date().toLocaleTimeString('de-CH', { timeStyle: 'short' }); } }, 'Speichern'), stand));
    } else {
      let gruppe = '';
      const liste = h('div', { class: 'palf lesen' });
      for (const [k, name, teil] of teile) {
        if (!text(k)) continue;
        if (name !== gruppe) { liste.append(h('h4', {}, name)); gruppe = name; }
        liste.append(h('div', {}, teil ? h('span', { class: 'klein' }, teil) : null, h('p', { class: 'protokolltext' }, text(k))));
      }
      karte.append(eigene.length ? liste : h('p', { class: 'klein' }, '–'));
    }
    block.append(karte);
  }
  // Abmachungen dieses Rapports
  const eigene = abm.filter(a => a.rapport_id === r.id);
  block.append(h('h3', { class: 'zwischen' }, `Abmachungen (${eigene.length})`),
    eigene.length ? h('div', { class: 'tabelle' }, ...eigene.map(a => abmZeile(a))) : h('p', { class: 'klein' }, 'Keine.'));
  if (offen && protokoll) {
    const f = { funktion: h('select', {}, ...funktionen.filter(x => x.typ !== 'Ordonnanz').map(x => h('option', {}, x.code))),
      was: h('input', { required: true, maxlength: 500, placeholder: 'Was ist abgemacht?' }), datum: h('input', { type: 'date' }) };
    block.append(h('form', { class: 'formular reihe', onsubmit: async e => {
      e.preventDefault();
      await db(sb.from('todos').insert({ dienst_id: r.dienst_id, rapport_id: r.id, funktion: f.funktion.value, was: f.was.value.trim(), datum: f.datum.value || null, gesperrt: !!f.datum.value }));
      zeigeRapporte();
    } }, h('label', {}, 'Funktion', f.funktion), h('label', {}, 'Abmachung', f.was), h('label', {}, 'Termin (leer = nächster Rapport)', f.datum),
      h('button', { class: 'btn', type: 'submit' }, '+ Abmachung')),
      h('p', { class: 'klein' }, 'Jede Abmachung kommt sofort in die Terminliste der Funktion. Mit Termin ist sie gesperrt 🔒; ohne Termin kommt sie am nächsten Rapport wieder.'),
      h('button', { class: 'btn light', onclick: async () => {
        if (!confirm('Rapport abschliessen? Danach ist er nur noch im Archiv lesbar.')) return;
        await db(sb.from('rapporte').update({ abgeschlossen: true }).eq('id', r.id)); zeigeRapporte(); } }, 'Rapport abschliessen'));
  }
  if (!offen && kdt) block.append(h('button', { class: 'btn light klein', onclick: async () => {
    await db(sb.from('rapporte').update({ abgeschlossen: false }).eq('id', r.id)); zeigeRapporte(); } }, 'Wieder öffnen'));
  return block;
}

function abmZeile(a) {
  return h('div', { class: 'zeile' + (fertig(a) ? ' fertig' : '') + (a.datum && a.datum < heute() && !fertig(a) ? ' spaet' : '') },
    h('div', { class: 'datum' }, a.gesperrt ? '🔒 ' : '', a.datum ? datumCH(a.datum) : 'nächster Rapport'),
    h('div', { class: 'was' }, h('strong', {}, a.was), h('span', { class: 'klein' }, a.funktion)),
    h('div', { class: 'status s-' + a.status }, STATUS[a.status]),
    h('div', { class: 'knoepfe' }, kdt && !fertig(a) ? h('button', { class: 'btn klein', onclick: async () => {
      await db(sb.from('todos').update({ status: 'erledigt' }).eq('id', a.id)); zeigeRapporte(); } }, 'x Erledigt') : null));
}

// Liste aus dem Picasso (von Claude gelesen) einfügen: je Zeile «KR 03.02.2027 1730»
function rapporteEinfuegen(raps) {
  const feld = h('textarea', { rows: 10, placeholder: 'DR 03.02.2027 0700\nKR 03.02.2027 1730\nLIK 05.02.2027 1200' });
  const vorschau = h('div', {});
  let neu = [];
  const pruefen = () => {
    const vorhanden = new Set(raps.map(r => `${r.art}|${r.datum}|${r.zeit || ''}`));
    neu = []; const fehler = [];
    for (const zeile of feld.value.split('\n').map(z => z.trim()).filter(Boolean)) {
      const m = zeile.match(/^(DR|KR|LIK)\s+(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+([0-2]\d[0-5]\d))?$/i);
      if (!m) { fehler.push(zeile); continue; }
      const r = { art: m[1].toUpperCase(), datum: `${m[4]}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`, zeit: m[5] || null };
      if (!vorhanden.has(`${r.art}|${r.datum}|${r.zeit || ''}`)) { neu.push(r); vorhanden.add(`${r.art}|${r.datum}|${r.zeit || ''}`); }
    }
    vorschau.replaceChildren(h('p', {}, `${neu.length} neue Rapporte` + (fehler.length ? `, ${fehler.length} Zeilen nicht verstanden: ${fehler.join(' · ')}` : '') + '.'));
  };
  feld.addEventListener('input', pruefen);
  const dialog = h('dialog', { class: 'dialog' });
  const schliessen = () => { dialog.close(); dialog.remove(); };
  dialog.append(h('div', { class: 'formular' }, h('h3', {}, 'Rapporte einfügen'),
    h('p', { class: 'klein' }, 'Die Liste, die Claude aus dem Picasso gelesen hat, hier einfügen. Pro Zeile: Art (DR, KR oder LIK), Datum, Zeit. Schon vorhandene Rapporte werden übersprungen.'),
    feld, vorschau,
    h('div', { class: 'knoepfe links' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
      pruefen();
      if (!neu.length) return meldung('Keine neuen Rapporte.', 'fehler');
      await db(sb.from('rapporte').insert(neu.map(r => ({ ...r, dienst_id: auswahl.dienst }))));
      meldung(`${neu.length} Rapporte angelegt.`, 'ok'); schliessen(); zeigeRapporte();
    } }, 'Anlegen'), h('button', { class: 'btn light', type: 'button', onclick: schliessen }, 'Abbrechen'))));
  document.body.append(dialog); dialog.showModal();
}

function rapportFormular() {
  const f = { art: h('select', {}, h('option', { value: 'DR' }, 'Dienstrapport (DR)'), h('option', { value: 'KR' }, 'Kompanierapport (KR)'), h('option', { value: 'LIK' }, 'Lagerapport im Kampf (LIK)')),
    datum: h('input', { type: 'date', required: true, value: heute() }), zeit: h('input', { pattern: '[0-2][0-9][0-5][0-9]', placeholder: 'z. B. 1730', maxlength: 4 }) };
  const dialog = h('dialog', { class: 'dialog' });
  dialog.append(h('form', { class: 'formular', onsubmit: async e => {
    e.preventDefault();
    await db(sb.from('rapporte').insert({ dienst_id: auswahl.dienst, art: f.art.value, datum: f.datum.value, zeit: f.zeit.value || null }));
    dialog.close(); dialog.remove(); zeigeRapporte();
  } }, h('h3', {}, 'Neuer Rapport'), h('div', { class: 'reihe' }, h('label', {}, 'Art', f.art), h('label', {}, 'Datum', f.datum), h('label', {}, 'Zeit', f.zeit)),
    h('div', { class: 'knoepfe' }, h('button', { class: 'btn', type: 'submit' }, 'Eröffnen'),
      h('button', { class: 'btn light', type: 'button', onclick: () => { dialog.close(); dialog.remove(); } }, 'Abbrechen'))));
  document.body.append(dialog); dialog.showModal();
}

// ---------- Einstellungen (Kdt) ----------
async function zeigeEinstellungen() {
  const neu = { email: h('input', { type: 'email', required: true, placeholder: 'Militär-Mailadresse' }), name: h('input', { placeholder: 'Name (freiwillig)' }),
    funktion: h('select', {}, ...funktionen.map(f => h('option', {}, f.code))),
    ober: h('select', {}, h('option', { value: '' }, '–'), ...funktionen.filter(f => f.typ !== 'Ordonnanz').map(f => h('option', {}, f.code))) };
  const zeilen = mitglieder.map(m => {
    const fs = h('select', { disabled: m.user_id === ich.user_id, onchange: async e => { await db(sb.from('mitglieder').update({ funktion: e.target.value }).eq('email', m.email)); await laden(); } },
      ...funktionen.map(f => h('option', { selected: f.code === m.funktion }, f.code)));
    const ob = h('select', { onchange: async e => { await db(sb.from('mitglieder').update({ ober_funktion: e.target.value || null }).eq('email', m.email)); await laden(); } },
      h('option', { value: '' }, '–'), ...funktionen.filter(f => f.typ !== 'Ordonnanz').map(f => h('option', { selected: f.code === m.ober_funktion }, f.code)));
    return h('div', { class: 'zeile' + (m.aktiv ? '' : ' fertig') },
      h('div', { class: 'was' }, h('strong', {}, m.name || m.email), h('span', { class: 'klein' }, m.email + (m.user_id ? ' · Konto ✓' : ' · noch kein Konto'))),
      m.user_id === ich.user_id ? h('div', {}, `${m.funktion} (eigene Funktion)`) : h('div', {}, fs),
      m.user_id === ich.user_id ? h('div', {}) : h('div', {}, ob),
      h('div', { class: 'knoepfe' }, m.user_id === ich.user_id ? null : h('button', { class: 'btn light klein', onclick: async () => {
        await db(sb.from('mitglieder').update({ aktiv: !m.aktiv }).eq('email', m.email)); await laden(); zeigeEinstellungen(); } }, m.aktiv ? 'Sperren' : 'Freigeben')));
  });
  const fCode = h('input', { required: true, placeholder: 'z. B. Zfhr 2' });
  const fTyp = h('select', {}, ...['Kdt Stv', 'Hptfw', 'Four', 'Zfhr', 'Büroordonnanz', 'Ordonnanz'].map(t => h('option', {}, t)));
  const offene = dienste.filter(d => dienstStatus(d) !== 'geplant');
  const teil = await db(sb.from('dienst_teilnehmer').select('*'));
  app.replaceChildren(seite('Einstellungen', null,
    abschnitt('Was lade ich wo hoch?', h('div', { class: 'tabelle' },
        h('div', { class: 'zeile' }, h('div', { class: 'datum' }, 'Terminliste (Excel)'), h('div', { class: 'was' }, h('strong', {}, 'Direkt hier: Dienste → beim Dienst «Terminliste importieren»'), h('span', { class: 'klein' }, 'Vorschau prüfen, dann übernehmen. Vorher URE und KVK als Dienste anlegen.'))),
        h('div', { class: 'zeile' }, h('div', { class: 'datum' }, 'Picasso (PDF)'), h('div', { class: 'was' }, h('strong', {}, 'Drive-Ordner Army (Knopf unten), dann Claude schreiben: «Lies den Picasso im Army-Ordner und mach mir die Rapport-Liste»'), h('span', { class: 'klein' }, 'Die Liste von Claude unter Rapporte → «Rapporte einfügen» übernehmen.'))),
        h('div', { class: 'zeile' }, h('div', { class: 'datum' }, 'Andere Unterlagen'), h('div', { class: 'was' }, h('strong', {}, 'Drive-Ordner Army, dann Claude sagen, was daraus werden soll'), h('span', { class: 'klein' }, 'Keine klassifizierten Unterlagen.')))),
      h('a', { class: 'btn', href: 'https://drive.google.com/drive/folders/' + DRIVE_ORDNER, target: '_blank', rel: 'noopener' }, 'Dateien hochladen (Drive-Ordner Army)')),
    abschnitt('Mitglieder einladen', h('form', { class: 'formular reihe', onsubmit: async e => {
      e.preventDefault();
      await db(sb.from('mitglieder').insert({ email: neu.email.value.trim().toLowerCase(), name: neu.name.value.trim() || null, funktion: neu.funktion.value, ober_funktion: neu.ober.value || null }));
      meldung('Eingeladen. Die Person erstellt ihr Konto selbst unter «Erstes Mal hier?».', 'ok'); await laden(); zeigeEinstellungen();
    } }, h('label', {}, 'Mail', neu.email), h('label', {}, 'Name', neu.name), h('label', {}, 'Funktion', neu.funktion), h('label', {}, 'Ordonnanz für', neu.ober),
      h('button', { class: 'btn', type: 'submit' }, 'Einladen')),
      h('p', { class: 'klein' }, 'Die Person öffnet die Plattform, wählt «Erstes Mal hier? Konto erstellen» und setzt ihr Passwort. Nur eingeladene Adressen funktionieren.'),
      h('div', { class: 'tabelle' }, h('div', { class: 'zeile kopf' }, h('div', {}, 'Person'), h('div', {}, 'Funktion'), h('div', {}, 'Ordonnanz für'), h('div', {})), ...zeilen)),
    h('section', { class: 'alt' }, h('div', { class: 'wrap' }, h('h2', {}, 'Funktionen'),
      h('p', {}, funktionen.map(f => f.code).join(' · ')),
      h('form', { class: 'formular reihe', onsubmit: async e => {
        e.preventDefault(); await db(sb.from('funktionen').insert({ code: fCode.value.trim(), typ: fTyp.value })); await laden(); zeigeEinstellungen();
      } }, h('label', {}, 'Neue Funktion', fCode), h('label', {}, 'Typ', fTyp), h('button', { class: 'btn', type: 'submit' }, 'Hinzufügen')))),
    abschnitt('Laufende und abgeschlossene Dienste ändern', offene.length ? h('div', { class: 'tabelle' }, ...offene.map(d => h('div', { class: 'zeile' },
      h('div', { class: 'datum' }, `${datumCH(d.beginn)} – ${datumCH(d.ende)}`), h('div', { class: 'was' }, h('strong', {}, `${d.titel} (${d.art})`)),
      h('div', { class: 'knoepfe' }, h('button', { class: 'btn light klein', onclick: () => dienstFormular(d, teil) }, 'Bearbeiten')))))
      : h('p', {}, 'Keine.'))));
}
