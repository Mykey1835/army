// Army-Plattform – Import der Terminliste (Excel .xlsx) mit Vorschau.
// Liest die Datei nur im Browser; gespeichert wird erst nach Bestätigung des Kdt.
'use strict';

// ---------- .xlsx lesen (ZIP + XML, ohne fremde Bibliothek) ----------
async function xlsxLesen(datei) {
  if (datei.size > 10 * 1024 * 1024) throw new Error('Datei zu gross (max. 10 MB).');
  const buf = new Uint8Array(await datei.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Das ist keine Excel-Datei (.xlsx).');
  const anzahl = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dateien = {};
  for (let i = 0; i < anzahl; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Excel-Datei beschädigt.');
    const nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), kLen = dv.getUint16(p + 32, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nLen));
    dateien[name] = { methode: dv.getUint16(p + 10, true), groesse: dv.getUint32(p + 20, true), entpackt: dv.getUint32(p + 24, true), lokal: dv.getUint32(p + 42, true) };
    if (dateien[name].entpackt > 50 * 1024 * 1024) throw new Error('Datei entpackt zu gross (max. 50 MB).');
    p += 46 + nLen + xLen + kLen;
  }
  const lies = async name => {
    const d = dateien[name];
    if (!d) return null;
    const start = d.lokal + 30 + dv.getUint16(d.lokal + 26, true) + dv.getUint16(d.lokal + 28, true);
    const roh = buf.subarray(start, start + d.groesse);
    const daten = d.methode === 0 ? roh
      : new Uint8Array(await new Response(new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    return new DOMParser().parseFromString(new TextDecoder().decode(daten), 'application/xml');
  };
  const sst = await lies('xl/sharedStrings.xml');
  const texte = sst ? [...sst.getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
  const blatt = Object.keys(dateien).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0];
  const xml = await lies(blatt);
  if (!xml) throw new Error('Kein Tabellenblatt gefunden.');
  const zeilen = [];
  for (const row of xml.getElementsByTagName('row')) {
    if (zeilen.length >= 2000) break; // Grenze: höchstens 2000 Zeilen
    const z = [];
    let lauf = -1;
    for (const c of row.getElementsByTagName('c')) {
      const ref = c.getAttribute('r') || '';
      lauf = ref ? ref.replace(/\d+/g, '').split('').reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0) - 1 : lauf + 1;
      const spalte = lauf;
      const typ = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0];
      let wert = null;
      if (typ === 's' && v) wert = texte[parseInt(v.textContent, 10)] ?? null;
      else if (typ === 'inlineStr') wert = [...c.getElementsByTagName('t')].map(t => t.textContent).join('');
      else if (v) wert = typ === 'str' || typ === 'b' || typ === 'e' ? v.textContent : Number(v.textContent);
      if (spalte >= 0 && spalte < 200) z[spalte] = wert;
    }
    zeilen.push(z);
  }
  return zeilen;
}
const excelDatum = n => typeof n === 'number' && n > 20000 && n < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 864e5).toISOString().slice(0, 10) : null;
const sauber = t => (t == null ? '' : String(t)).replace(/\s+/g, ' ').trim();
// Personaldaten (Mailadressen, Telefonnummern) nicht übernehmen
const ohnePersonaldaten = t => sauber(t)
  .replace(/[\w.+-]+\s*(@|\(at\)|\[at\])\s*[\w-]+(\.[\w-]+)+/gi, '[Adresse]')
  .replace(/756[.\s]?\d{4}[.\s]?\d{4}[.\s]?\d{2}/g, '[AHV]')
  .replace(/(\+|00)?\d[\d\s\/.\-()]{7,}\d/g, x => x.replace(/\D/g, '').length >= 9 ? '[Nummer]' : x);

// ---------- Zuordnung «durch wen» → Funktion ----------
function funktionAus(durch) {
  const t = sauber(durch).toLowerCase();
  if (!t) return '';
  const hat = (typ) => funktionen.find(f => f.typ === typ)?.code || '';
  if (/(^|[^a-z])(kp|einh) kdt stv/.test(t)) return hat('Kdt Stv');
  if (/(^|[^a-z])(kp|einh) kdt/.test(t)) return hat('Kdt');
  if (/(^|[^a-z])(einh )?four/.test(t)) return hat('Four');
  if (/(^|[^a-z])(kp|einh) fw|hptfw/.test(t)) return hat('Hptfw');
  if (/(^|[^a-z])zfhr/.test(t)) return hat('Zfhr');
  if (/büro/.test(t)) return hat('Büroordonnanz');
  return '';
}

// ---------- «wann» → Termin ----------
const WOCHENTAG = { montag: 0, dienstag: 1, mittwoch: 2, donnerstag: 3, freitag: 4, samstag: 5, sonntag: 6 };
const EINHEIT = { tag: 1, tage: 1, woche: 7, wochen: 7, wo: 7, monat: 30, monate: 30 };
function anderer(dienst, art) { // nächster Dienst der Art vor (oder am) Beginn des gewählten Dienstes
  return dienste.filter(d => d.art === art && d.beginn <= dienst.beginn && d.beginn >= plusTage(dienst.beginn, -400))
    .sort((a, b) => b.beginn.localeCompare(a.beginn))[0];
}
function terminAus(wann, dienst) {
  const w = sauber(wann).toLowerCase();
  let m;
  const tagIn = s => { const k = Object.keys(WOCHENTAG).find(x => s.includes(x)); return k === undefined ? 0 : WOCHENTAG[k]; };
  // relativ zum gewählten Dienst → Anker (rechnet sich bei Verschiebung neu)
  if ((m = w.match(/^(\d+)\s*(tage?|wochen?|monate?)\s+vor\s+(dienstbeginn|wk|fdt|einrücken)/))) return { anker: 'Beginn', tage: -m[1] * EINHEIT[m[2]] };
  if ((m = w.match(/^(\d+)\s*(tage?|wochen?)\s+nach\s+(dem\s+)?einrücken/))) return { anker: 'Beginn', tage: +m[1] * EINHEIT[m[2]] };
  if ((m = w.match(/^(\d+)\.\s*tag\s+nach\s+einrücken/))) return { anker: 'Beginn', tage: +m[1] };
  if ((m = w.match(/^(\d+)\s*(tage?|wochen?|monate?)\s+nach\s+(dienst|wk|fdt)/))) return { anker: 'Ende', tage: +m[1] * EINHEIT[m[2]] };
  if ((m = w.match(/^(\d+)\s*tage?\s+vor\s+entlassung/))) return { anker: 'Ende', tage: -m[1] };
  if ((m = w.match(/^(\d+)\.\s*letzter\s+(wk-|dienst)?tag/))) return { anker: 'Ende', tage: -(m[1] - 1) };
  if (/^letzter\s+(wk-|dienst)?tag/.test(w)) return { anker: 'Ende', tage: 0 };
  if ((m = w.match(/^(\w+)\s+(\d+)\s*wo(che)?\s+nach\s+(wk|dienst)/)) && Object.hasOwn(WOCHENTAG, m[1])) return { anker: 'Ende', tage: +m[2] * 7 + WOCHENTAG[m[1]] - 4 };
  if ((m = w.match(/^(\d+)\.\s*tag\s+(wk-|dienst)?woche/))) return { anker: 'Beginn', tage: +m[1] - 1 };
  if ((m = w.match(/^(\d+)\.\s*(wk-|dienst)?woche/))) return { anker: 'Beginn', tage: (m[1] - 1) * 7 + tagIn(w) };
  if (/^(anlässlich )?(start|beginn|dienstbeginn)/.test(w)) return { anker: 'Beginn', tage: 0 };
  // relativ zu einem anderen Dienst (URE, URB, KVK) → festes Datum
  const bezug = (art) => { const d = anderer(dienst, art); return d ? d.beginn : null; };
  if ((m = w.match(/^(\d+)\s*(tage?|wochen?|monate?)\s+(vor|nach)\s+(ure|ura\/urb|urb|kvk)/))) {
    const b = bezug(m[4] === 'ure' ? 'URE' : m[4] === 'kvk' ? 'KVK' : 'URB');
    return b ? { datum: plusTage(b, (m[3] === 'vor' ? -1 : 1) * m[1] * EINHEIT[m[2]]) } : null;
  }
  if ((m = w.match(/^(\w+)\s+vor\s+kvk/)) && Object.hasOwn(WOCHENTAG, m[1])) { const b = bezug('KVK'); return b ? { datum: plusTage(b, WOCHENTAG[m[1]] - 7) } : null; }
  if ((m = w.match(/^(\d+)\.\s*tag\s+kvk/))) { const b = bezug('KVK'); return b ? { datum: plusTage(b, m[1] - 1) } : null; }
  if (/^ure\b/.test(w)) { const b = bezug('URE'); return b ? { datum: b } : null; }
  if (/^(ura\/urb|urb)\b/.test(w)) { const b = bezug('URB'); return b ? { datum: b } : null; }
  return null; // z. B. «täglich», «wird am URE definiert» → noch nicht terminiert
}

// ---------- Terminliste einlesen ----------
function terminlisteAuswerten(zeilen, dienst) {
  const kopf = zeilen.findIndex(z => z && z.some(x => sauber(x).toLowerCase() === 'was') && z.some(x => sauber(x).toLowerCase() === 'durch wen'));
  if (kopf < 0) throw new Error('Kopfzeile mit «was» und «durch wen» nicht gefunden. Ist das eine Terminliste?');
  const sp = {};
  zeilen[kopf].forEach((x, i) => { const k = sauber(x).toLowerCase(); if (k && !(k in sp)) sp[k] = i; });
  const feld = (z, k) => sp[k] === undefined ? null : z[sp[k]];
  const eintraege = [];
  for (const z of zeilen.slice(kopf + 1)) {
    if (!z || !sauber(feld(z, 'was'))) continue;
    const wann = sauber(feld(z, 'wann'));
    let termin = terminAus(wann, dienst);
    if (termin && termin.anker && !(Math.abs(termin.tage) <= 400)) termin = null; // ausserhalb −400…400 Tage: von Hand terminieren
    if (!termin) { // festes Datum nur, wenn es zum Dienst passt (Vorlagen tragen oft alte Jahre)
      const dat = excelDatum(feld(z, 'datum'));
      if (dat && dat >= plusTage(dienst.beginn, -400) && dat <= plusTage(dienst.ende, 60)) termin = { datum: dat };
    }
    const wieRoh = ohnePersonaldaten(feld(z, 'wie'));
    const zeit = (wann.match(/\b([01]\d|2[0-3])[0-5]\d\b/) || [])[0];
    const notiz = ['Terminliste' + (sauber(feld(z, 'pos')) ? ' ' + sauber(feld(z, 'pos')) : '') + ': ' + (wann || 'ohne «wann»'),
      zeit ? 'Zeit ' + zeit : null, wieRoh && !/^(schriftlich|mündlich)$/i.test(wieRoh) ? 'Form: ' + wieRoh : null,
      sauber(feld(z, 'periodizität')) && sauber(feld(z, 'periodizität')) !== 'Einzeltermin' ? sauber(feld(z, 'periodizität')) : null].filter(Boolean).join(' · ');
    const durch = sauber(feld(z, 'durch wen'));
    eintraege.push({
      durch, funktion: funktionAus(durch), wann,
      daten: {
        was: ohnePersonaldaten(feld(z, 'was')).slice(0, 500),
        grundlage: ohnePersonaldaten(feld(z, 'grundlage')).slice(0, 300) || null,
        an_wen: ohnePersonaldaten(feld(z, 'an wen')).slice(0, 300) || null,
        wie: /^schriftlich$/i.test(wieRoh) ? 'schriftlich' : /^mündlich$/i.test(wieRoh) ? 'mündlich' : null,
        notiz: ohnePersonaldaten(notiz).slice(0, 1000),
        anker: termin?.anker || null, tage: termin?.anker ? termin.tage : null, datum: termin?.datum || null,
      },
    });
  }
  return eintraege;
}

function terminText(d, dienst) {
  if (d.anker) return `${datumCH(plusTage(d.anker === 'Beginn' ? dienst.beginn : dienst.ende, d.tage))} (${Math.abs(d.tage)} T ${d.tage < 0 ? 'vor' : 'nach'} ${d.anker})`;
  return d.datum ? datumCH(d.datum) : 'noch nicht terminiert';
}

// ---------- Dialog mit Vorschau ----------
function terminlisteImport(dienst) {
  const dialog = h('dialog', { class: 'dialog breit' });
  const schliessen = () => { dialog.close(); dialog.remove(); };
  const datei = h('input', { type: 'file', accept: '.xlsx' });
  const inhalt = h('div', {});
  const ueber = h('input', { type: 'checkbox', checked: true });
  datei.addEventListener('change', async () => {
    inhalt.replaceChildren(h('p', {}, 'Lese die Datei …'));
    let eintraege;
    try { eintraege = terminlisteAuswerten(await xlsxLesen(datei.files[0]), dienst); }
    catch (err) { inhalt.replaceChildren(h('p', { class: 'hinweis' }, err.message)); return; }
    const vorhanden = new Set((await db(sb.from('todos').select('was,funktion').eq('dienst_id', dienst.id))).map(t => t.funktion + '|' + t.was));
    const wahl = eintraege.map(e => {
      const doppelt = e.funktion && vorhanden.has(e.funktion + '|' + e.daten.was);
      const haken = h('input', { type: 'checkbox', checked: !!e.funktion && !doppelt });
      const fn = h('select', { onchange: () => { haken.checked = !!fn.value; } }, h('option', { value: '' }, 'nicht übernehmen'),
        ...funktionen.filter(f => f.typ !== 'Ordonnanz').map(f => h('option', { value: f.code, selected: f.code === e.funktion }, f.code)));
      return { e, haken, fn, zeile: h('div', { class: 'zeile' + (e.funktion ? '' : ' fertig') },
        h('div', {}, haken), h('div', { class: 'was' }, h('strong', {}, e.daten.was), h('span', { class: 'klein' }, `durch: ${e.durch || '–'} · ${e.wann || '–'}` + (doppelt ? ' · schon vorhanden' : ''))),
        h('div', { class: 'datum' }, terminText(e.daten, dienst)), h('div', {}, fn)) };
    });
    const zaehler = () => wahl.filter(w => w.haken.checked && w.fn.value).length;
    const knopf = h('button', { class: 'btn', type: 'button', onclick: async () => {
      const neu = wahl.filter(w => w.haken.checked && w.fn.value).map(w => ({ ...w.e.daten, dienst_id: dienst.id, funktion: w.fn.value,
        dienstuebergreifend: ueber.checked, gesperrt: !!(w.e.daten.datum || w.e.daten.anker) }));
      if (!neu.length) return meldung('Nichts ausgewählt.', 'fehler');
      knopf.disabled = true;
      await db(sb.from('todos').insert(neu)); // ein Aufruf: alles oder nichts
      meldung(`${neu.length} To-dos übernommen.`, 'ok'); schliessen(); auswahl.dienst = dienst.id; location.hash = '#termine'; zeige();
    } }, 'Übernehmen');
    const titel = h('p', {});
    const neuZaehlen = () => { titel.textContent = `${eintraege.length} Zeilen gelesen, ${zaehler()} ausgewählt. Zugeordnet nach «durch wen»; Bataillons-Stellen (S1, S4, Bat Kdt …) sind abgewählt.`; };
    wahl.forEach(w => { w.haken.addEventListener('change', neuZaehlen); w.fn.addEventListener('change', neuZaehlen); });
    neuZaehlen();
    inhalt.replaceChildren(titel,
      h('label', { class: 'haken' }, ueber, 'Als dienstübergreifend übernehmen (kommt im nächsten Dienst wieder)'),
      h('p', { class: 'klein' }, 'Termine mit Datum sind gesperrt 🔒. Ohne erkennbaren Termin landen sie unter «Noch nicht terminiert». Mailadressen und Telefonnummern werden nicht übernommen.'),
      h('div', { class: 'tabelle import' }, ...wahl.map(w => w.zeile)),
      h('div', { class: 'knoepfe links' }, knopf, h('button', { class: 'btn light', type: 'button', onclick: schliessen }, 'Abbrechen')));
  });
  dialog.append(h('div', { class: 'formular' }, h('h3', {}, `Terminliste importieren: ${dienst.titel}`),
    h('label', {}, 'Excel-Datei der Terminliste (.xlsx)', datei), inhalt,
    h('div', { class: 'knoepfe links' }, h('button', { class: 'btn light', type: 'button', onclick: schliessen }, 'Schliessen'))));
  document.body.append(dialog); dialog.showModal();
}
