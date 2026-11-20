import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
const q = (s,p)=>db.query(s,p);
await db.exec(`
create role anon; create role authenticated; create role supabase_auth_admin;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
`);
let sql = fs.readFileSync(new URL('./schema.sql', import.meta.url),'utf8');
await db.exec(sql);
await db.exec(`insert into public.mitglieder (email, funktion) values ('kdt@x.ch', 'Kdt')`);
await db.exec(`grant usage on schema public to authenticated;`);
let ok=0, fail=0;
const t = async (name, fn, expectErr=false) => {
  try { const r = await fn(); if (expectErr) { console.log('FEHLT FEHLER:', name, JSON.stringify(r?.rows)); fail++; } else { ok++; return r; } }
  catch(e){ if (expectErr) { ok++; } else { console.log('FEHLER:', name, e.message); fail++; } }
};
const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid||''}'; set role authenticated;`); try { return await fn(); } finally { await db.exec('reset role'); } };
// Mitglieder (als Admin)
await db.exec(`insert into mitglieder(email,funktion) values ('four@x.ch','Four'),('zfhr@x.ch','Zfhr');
insert into mitglieder(email,funktion,ober_funktion) values ('ord@x.ch','Ordonnanz','Four');`);
// Konto erstellen
const mk = async e => (await q(`insert into auth.users(email) values ($1) returning id`,[e])).rows[0].id;
const K = await mk('kdt@x.ch'), F = await mk('four@x.ch'), Z = await mk('zfhr@x.ch'), O = await mk('ord@x.ch');
await t('fremde Adresse abgelehnt', ()=>mk('fremd@x.ch'), true);
await t('zweites Konto gleiche Adresse abgelehnt', ()=>mk('four@x.ch'), true);
// Dienste
const heute = new Date(); const d = n => new Date(heute.getTime()+n*864e5).toISOString().slice(0,10);
const D1 = (await as(K, ()=>q(`insert into dienste(art,titel,beginn,ende) values ('Dienst','WK alt',$1,$2) returning id`,[d(-400),d(-380)]))).rows[0].id;
const D2 = (await as(K, ()=>q(`insert into dienste(art,titel,beginn,ende) values ('Dienst','WK jetzt',$1,$2) returning id`,[d(5),d(25)]))).rows[0].id;
const D3 = (await as(K, ()=>q(`insert into dienste(art,titel,beginn,ende) values ('URE','URE spaeter',$1,$2) returning id`,[d(40),d(40)]))).rows[0].id;
await t('Four kann keinen Dienst anlegen', ()=>as(F, ()=>q(`insert into dienste(art,titel,beginn,ende) values ('Dienst','x',$1,$1)`,[d(1)])), true);
let r = await as(F, ()=>q(`select titel from dienste order by beginn`));
console.log('Four sieht Dienste:', r.rows.map(x=>x.titel).join(', '), '(erwartet: WK jetzt)');
// To-dos
const T1 = (await as(K, ()=>q(`insert into todos(dienst_id,was,funktion,anker,tage,gesperrt) values ($1,'Verpflegung bestellen','Four','Beginn',-3,true) returning id,datum,gesperrt`,[D2]))).rows[0];
console.log('Kdt-To-do relativ:', T1.datum.toISOString().slice(0,10), 'gesperrt', T1.gesperrt, '(erwartet', d(2), true,')');
const T2 = (await as(F, ()=>q(`insert into todos(dienst_id,was,funktion,datum,gesperrt) values ($1,'Eigenes','Four',$2,true) returning id,gesperrt`,[D2,d(7)]))).rows[0];
console.log('Four eigenes, gesperrt erzwungen false:', T2.gesperrt);
await t('Four darf eigenes verschieben', ()=>as(F, ()=>q(`update todos set datum=$2 where id=$1`,[T2.id,d(8)])));
await t('Four darf Kdt-Termin nicht verschieben', ()=>as(F, ()=>q(`update todos set tage=0 where id=$1`,[T1.id])), true);
await t('Four darf Sperre nicht lösen', ()=>as(F, ()=>q(`update todos set gesperrt=false where id=$1`,[T1.id])), true);
await t('Four kein To-do für Zfhr', ()=>as(F, ()=>q(`insert into todos(dienst_id,was,funktion) values ($1,'x','Zfhr')`,[D2])), true);
r = await as(Z, ()=>q(`select was from todos`)); console.log('Zfhr sieht', r.rows.length, 'To-dos (erwartet 0)');
r = await as(Z, ()=>q(`update todos set status='erledigt' where id=$1 returning id`,[T1.id])); console.log('Zfhr ändert fremdes:', r.rows.length, '(erwartet 0)');
r = await as(O, ()=>q(`select was from todos`)); console.log('Ordonnanz sieht', r.rows.length, 'To-dos (erwartet 2)');
await t('Ordonnanz kann vorbereitet', ()=>as(O, ()=>q(`update todos set status='vorbereitet' where id=$1`,[T1.id])));
await t('Ordonnanz kann nicht erledigen', ()=>as(O, ()=>q(`update todos set status='erledigt' where id=$1`,[T1.id])), true);
await t('Ordonnanz legt nichts an', ()=>as(O, ()=>q(`insert into todos(dienst_id,was,funktion) values ($1,'x','Four')`,[D2])), true);
await t('Four erledigt', ()=>as(F, ()=>q(`update todos set status='erledigt' where id=$1`,[T1.id])));
await t('Four löscht nicht', async()=>{ const r=await as(F, ()=>q(`delete from todos where id=$1 returning id`,[T2.id])); if(r.rows.length) throw 0; return r;});
r = await as(F, ()=>q(`select email from mitglieder`)); console.log('Four sieht Mitglieder:', r.rows.map(x=>x.email).join(','), '(erwartet four@x.ch)');
await t('Four kann sich nicht befördern', async()=>{ const r=await as(F, ()=>q(`update mitglieder set funktion='Kdt' where email='four@x.ch' returning email`)); if(r.rows.length) throw new Error('befördert!'); });
await t('ping', ()=>as(F, ()=>q(`select ping()`)));
// Dienst verschieben → relativ neu, ungesperrtes bleibt ungesperrt
await as(F, ()=>q(`update todos set anker='Ende', tage=1 where id=$1`,[T2.id]));
await as(K, ()=>q(`update dienste set beginn=$2, ende=$3 where id=$1`,[D2,d(6),d(26)]));
r = await q(`select was, datum, gesperrt from todos where dienst_id=$1 order by was`,[D2]);
console.log('nach Verschieben:', r.rows.map(x=>x.was+' '+x.datum.toISOString().slice(0,10)+' '+x.gesperrt).join(' | '), '(erwartet Eigenes', d(27), 'false; Verpflegung', d(3), 'true)');
// Dienstübergreifend
await as(K, ()=>q(`update todos set dienstuebergreifend=true`));
const D4 = (await as(K, ()=>q(`insert into dienste(art,titel,beginn,ende) values ('Dienst','WK naechstes',$1,$2) returning id`,[d(380),d(400)]))).rows[0].id;
r = await q(`select was, datum, gesperrt, status from todos where dienst_id=$1 order by was`,[D4]);
console.log('übernommen:', r.rows.map(x=>x.was+' '+(x.datum&&x.datum.toISOString().slice(0,10))+' '+x.gesperrt+' '+x.status).join(' | '));
// Teilnehmer und Freischalten
await as(K, ()=>q(`select teilnehmer_setzen($1,true,array['four@x.ch'])`,[D3]));
await t('Four kann Teilnehmer nicht setzen', ()=>as(F, ()=>q(`select teilnehmer_setzen($1,false,null)`,[D3])), true);
r = await as(Z, ()=>q(`select titel from dienste where id=$1`,[D3])); console.log('Zfhr sieht URE vor Freischaltung:', r.rows.length);
await as(K, ()=>q(`update dienste set freigeschaltet_bis=$2 where id=$1`,[D3,d(7)]));
r = await as(Z, ()=>q(`select titel from dienste where id=$1`,[D3])); console.log('Zfhr (nicht Teilnehmer) sieht URE:', r.rows.length, '(erwartet 0)');
r = await as(F, ()=>q(`select titel from dienste where id=$1`,[D3])); console.log('Four (Teilnehmer) sieht URE:', r.rows.length, '(erwartet 1)');
await t('anon liest nichts', async()=>{ await db.exec('set role anon'); try { await q('select * from todos'); } finally { await db.exec('reset role'); } }, true);
// Angriffe des Prüfers
const T5 = (await as(K, ()=>q(`insert into todos(dienst_id,was,funktion,datum) values ($1,'Offen fuer Ord','Four',$2) returning id`,[D2,d(9)]))).rows[0].id;
await t('Ord: erledigt→offen gesperrt', ()=>as(O, ()=>q(`update todos set status='offen' where id=$1`,[T1.id])), true);
await t('Ord: Text ändern gesperrt', ()=>as(O, ()=>q(`update todos set was='x' where id=$1`,[T5])), true);
await t('Ord: Datum ändern gesperrt', ()=>as(O, ()=>q(`update todos set datum=$2 where id=$1`,[T5,d(10)])), true);
await t('Ord: dienstübergreifend gesperrt', ()=>as(O, ()=>q(`update todos set dienstuebergreifend=true where id=$1`,[T5])), true);
await t('Ord: offen→vorbereitet erlaubt', ()=>as(O, ()=>q(`update todos set status='vorbereitet' where id=$1`,[T5])));
await t('Ord: vorbereitet→offen erlaubt', ()=>as(O, ()=>q(`update todos set status='offen' where id=$1`,[T5])));
await t('Four: Text eines gesperrten Kdt-To-dos gesperrt', ()=>as(F, ()=>q(`update todos set was='x' where id=$1`,[T1.id])), true);
await t('Four: Notiz eines gesperrten Kdt-To-dos erlaubt', ()=>as(F, ()=>q(`update todos set notiz='ok' where id=$1`,[T1.id])));
const mkU = async e => (await q(`insert into auth.users(email) values ($1) returning id`,[e])).rows[0].id;
await db.exec(`insert into mitglieder(email,funktion) values ('weg@x.ch','Hptfw')`);
const W = await mkU('weg@x.ch');
r = await as(W, ()=>q(`select titel from dienste`)); console.log('aktives Hptfw sieht', r.rows.length, 'Dienst(e) (erwartet 1)');
await db.exec(`update mitglieder set aktiv=false where email='weg@x.ch'`);
r = await as(W, ()=>q(`select titel from dienste`)); console.log('gesperrtes Mitglied sieht', r.rows.length, '(erwartet 0)');
const X = '00000000-0000-0000-0000-000000000099';
r = await as(X, ()=>q(`select titel from dienste`)); console.log('Konto ohne Mitglied sieht', r.rows.length, '(erwartet 0)');
await db.exec(`delete from dienst_teilnehmer`);
r = await as(Z, ()=>q(`select titel from dienste where id=$1`,[D3])); console.log('URE nach Löschen aller Teilnehmer für Zfhr:', r.rows.length, '(erwartet 0)');
await db.exec(`delete from auth.users where email='weg@x.ch'`);
r = await q(`select user_id from mitglieder where email='weg@x.ch'`); console.log('user_id nach Löschen des Kontos:', r.rows[0].user_id, '(erwartet null)');
r = await q(`select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type not in ('SELECT','INSERT','UPDATE','DELETE')`);
console.log('zu breite Rechte:', r.rows.length, '(erwartet 0)');
// Nachkontrolle Prüfer
const T6 = (await as(K, ()=>q(`insert into todos(dienst_id,was,funktion,gesperrt) values ($1,'Ohne Termin vom Kdt','Four',false) returning id`,[D2]))).rows[0].id;
await t('Four setzt Termin bei Kdt-To-do ohne Termin', ()=>as(F, ()=>q(`update todos set datum=$2 where id=$1`,[T6,d(12)])));
const D5 = (await as(K, ()=>q(`insert into dienste(art,titel,beginn,ende,nur_teilnehmer) values ('URB','URB eng',$1,$1,true) returning id`,[d(2)]))).rows[0].id;
r = await as(F, ()=>q(`select titel from dienste where id=$1`,[D5])); console.log('neuer Dienst nur_teilnehmer ohne Liste sichtbar:', r.rows.length, '(erwartet 0)');
console.log('OK', ok, 'FEHLER', fail);
