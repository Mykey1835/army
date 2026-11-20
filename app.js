// Army-Plattform – Oberfläche (ohne Build-Schritt). Rechte prüft die Datenbank (supabase/schema.sql).
'use strict';

const cfg = window.ARMY_CONFIG || {};
const app = document.getElementById('app');
const nav = document.getElementById('tabs');
let sb = null;
let ich = null;          // eigenes Mitglied
let kdt = false, ordonnanz = false;
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
  [kdt, ordonnanz] = await Promise.all([db(sb.rpc('ist_kdt')), db(sb.rpc('ist_ordonnanz'))]);
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
  const reiter = [['start', 'Start'], ['termine', 'Terminliste']];
  if (kdt) reiter.push(['dienste', 'Dienste'], ['organigramm', 'Organigramm'], ['einstellungen', 'Einstellungen']);
  nav.replaceChildren(...reiter.map(([id, t]) => h('li', {}, h('a', { href: '#' + id }, t))),
    h('li', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); sb.auth.signOut(); } }, 'Abmelden')));
}

function zeige() {
  const seiteId = (location.hash || '#start').slice(1);
  for (const a of nav.querySelectorAll('a')) a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + seiteId);
  nav.classList.remove('open');
  const nurKdt = ['dienste', 'organigramm', 'einstellungen'];
  if (nurKdt.includes(seiteId) && !kdt) { location.hash = '#start'; return; }
  ({ start: zeigeStart, termine: zeigeTermine, dienste: zeigeDienste, organigramm: zeigeOrganigramm, einstellungen: zeigeEinstellungen }[seiteId] || zeigeStart)();
}

// ---------- Start: Anleitung ----------
async function zeigeStart() {
  const meine = kdt ? 'Kdt' : (ordonnanz ? ich.ober_funktion : ich.funktion);
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
    ['3', 'Funktion schliesst ab', 'Die Funktion prüft und hakt ab oder gibt mit Notiz zurück.']];
  const a = [
    ['1', 'Terminliste öffnen', 'Oben den Dienst wählen. Zuoberst steht, was noch keinen Termin hat.'],
    ['2', 'Pendenzen erfassen', 'Eigene To-dos mit Datum oder relativ zum Dienst («3 Tage vor Beginn»). Haken «dienstübergreifend»: kommt im nächsten Dienst für deine Funktion wieder.'],
    ['3', 'Melden', '«Erledigt (x)» oder «Nichts zu melden (n)». Meldet deine Ordonnanz «vorbereitet», prüfst du und schliesst ab.']];
  if (kdt) a.push(['4', 'Führen', 'Unter «Dienste» Dienste anlegen und freischalten, unter «Organigramm» sehen, wer online ist und wer was offen hat, unter «Einstellungen» Leute einladen.']);
  return a;
}

// ---------- Terminliste ----------
async function zeigeTermine() {
  const kopf = h('div', { class: 'filter' });
  const dWahl = h('select', { onchange: () => { auswahl.dienst = dWahl.value; zeigeTermine(); } },
    ...dienste.map(d => h('option', { value: d.id, selected: d.id === auswahl.dienst }, `${d.titel} (${d.art}, ${datumCH(d.beginn)})`)));
  kopf.append(h('label', {}, 'Dienst', dienste.length ? dWahl : h('span', {}, ' – kein Dienst offen')));
  if (kdt) kopf.append(h('label', {}, 'Funktion', h('select', { onchange: e => { auswahl.funktion = e.target.value; zeigeTermine(); } },
    h('option', { value: '' }, 'alle'), ...funktionen.filter(f => f.typ !== 'Ordonnanz').map(f => h('option', { value: f.code, selected: f.code === auswahl.funktion }, f.code)))));
  const inhalt = h('div', {});
  app.replaceChildren(seite('Terminliste', null, abschnitt(null, kopf, inhalt)));
  if (!auswahl.dienst) return;
  let abfrage = sb.from('todos').select('*').eq('dienst_id', auswahl.dienst).order('datum', { nullsFirst: true }).order('erstellt');
  if (kdt && auswahl.funktion) abfrage = abfrage.eq('funktion', auswahl.funktion);
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
        h('span', { class: 'klein' }, [kdt ? x.funktion : null, x.grundlage, x.an_wen ? 'an ' + x.an_wen : null, x.wie, x.dienstuebergreifend ? 'dienstübergreifend' : null].filter(Boolean).join(' · ')),
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
  };
  const gewaehlt = new Set(teil.filter(t => t.dienst_id === d.id).map(t => t.email));
  const nur = h('input', { type: 'checkbox', checked: !!d.nur_teilnehmer });
  const haken = mitglieder.filter(m => m.aktiv).map(m => h('input', { type: 'checkbox', value: m.email, checked: gewaehlt.has(m.email) }));
  const dialog = h('dialog', { class: 'dialog' });
  dialog.append(h('form', { class: 'formular', onsubmit: async e => {
    e.preventDefault();
    if (f.ende.value < f.beginn.value) return meldung('Ende liegt vor Beginn.', 'fehler');
    const daten = { art: f.art.value, titel: f.titel.value.trim(), beginn: f.beginn.value, ende: f.ende.value, nur_teilnehmer: nur.checked };
    const gespeichert = d.id ? await db(sb.from('dienste').update(daten).eq('id', d.id).select().single())
                             : await db(sb.from('dienste').insert(daten).select().single());
    await db(sb.rpc('teilnehmer_setzen', { d_id: gespeichert.id, nur: nur.checked, adressen: haken.filter(c => c.checked).map(c => c.value) }));
    dialog.close(); dialog.remove(); auswahl.dienst = gespeichert.id; await laden(); zeige();
  } },
    h('h3', {}, d.id ? 'Dienst bearbeiten' : 'Neuer Dienst'),
    h('div', { class: 'reihe' }, h('label', {}, 'Art', f.art), h('label', {}, 'Titel', f.titel)),
    h('div', { class: 'reihe' }, h('label', {}, 'Beginn', f.beginn), h('label', {}, 'Ende', f.ende)),
    h('label', { class: 'haken' }, nur, 'Nur für ausgewählte Teilnehmer (sonst alle Mitglieder)'),
    h('div', { class: 'haken-liste' }, ...haken.map((c, i) => h('label', { class: 'haken' }, c, mitglieder.filter(m => m.aktiv)[i].name || c.value))),
    h('div', { class: 'knoepfe' }, h('button', { class: 'btn', type: 'submit' }, 'Speichern'),
      h('button', { class: 'btn light', type: 'button', onclick: () => { dialog.close(); dialog.remove(); } }, 'Abbrechen'))));
  document.body.append(dialog); dialog.showModal();
}

// ---------- Organigramm (Kdt) ----------
async function zeigeOrganigramm() {
  await laden(); // frische Online-Zeiten
  const todos = auswahl.dienst ? await db(sb.from('todos').select('funktion,status,datum').eq('dienst_id', auswahl.dienst)) : [];
  const t = heute();
  const d = dienste.find(x => x.id === auswahl.dienst);
  const karten = funktionen.filter(f => f.typ !== 'Ordonnanz').map(f => {
    const leute = mitglieder.filter(m => m.aktiv && (m.funktion === f.code || m.ober_funktion === f.code));
    const eigene = todos.filter(x => x.funktion === f.code);
    const offen = eigene.filter(x => x.status === 'offen').length;
    const vorb = eigene.filter(x => x.status === 'vorbereitet').length;
    const spaet = eigene.filter(x => x.datum && x.datum < t && (x.status === 'offen' || x.status === 'vorbereitet')).length;
    return h('div', { class: 'card org' },
      h('h3', {}, f.code),
      leute.length ? h('ul', { class: 'leute' }, ...leute.map(m => h('li', {},
        h('span', { class: 'punkt' + (istOnline(m) ? ' an' : '') }), (m.name || m.email) + (m.funktion !== f.code ? ' (Ordonnanz)' : ''),
        h('span', { class: 'klein' }, istOnline(m) ? ' online' : m.user_id ? (m.zuletzt_online ? ' zuletzt ' + new Date(m.zuletzt_online).toLocaleString('de-CH', { dateStyle: 'short', timeStyle: 'short' }) : ' noch nie online') : ' eingeladen, kein Konto'))))
        : h('p', { class: 'klein' }, 'nicht besetzt'),
      h('p', {}, `${offen} offen · ${vorb} vorbereitet` + (spaet ? ` · ${spaet} überfällig` : '')),
      h('a', { class: 'btn light klein', href: '#termine', onclick: () => { auswahl.funktion = f.code; } }, 'Pendenzen'));
  });
  app.replaceChildren(seite('Organigramm', d ? `${d.titel} (${d.art})` : 'kein Dienst gewählt', abschnitt(null, h('div', { class: 'cards' }, ...karten))));
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
      h('div', {}, fs), h('div', {}, ob),
      h('div', { class: 'knoepfe' }, m.user_id === ich.user_id ? null : h('button', { class: 'btn light klein', onclick: async () => {
        await db(sb.from('mitglieder').update({ aktiv: !m.aktiv }).eq('email', m.email)); await laden(); zeigeEinstellungen(); } }, m.aktiv ? 'Sperren' : 'Freigeben')));
  });
  const fCode = h('input', { required: true, placeholder: 'z. B. Zfhr 2' });
  const fTyp = h('select', {}, ...['Kdt Stv', 'Hptfw', 'Four', 'Zfhr', 'Büroordonnanz', 'Ordonnanz'].map(t => h('option', {}, t)));
  const offene = dienste.filter(d => dienstStatus(d) !== 'geplant');
  const teil = await db(sb.from('dienst_teilnehmer').select('*'));
  app.replaceChildren(seite('Einstellungen', null,
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
