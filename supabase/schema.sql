-- Army-Plattform: Datenbank und Rechte
-- Einmal ausführen: Supabase → SQL Editor → alles einfügen → Run.
-- Vorher in der letzten Zeile DEINE Militär-Mailadresse eintragen (klein geschrieben).

-- Funktionen (Stellen). Mehrere Zugführer: weitere Codes wie «Zfhr 2» anlegen.
create table public.funktionen (
  code text primary key,
  typ text not null check (typ in ('Kdt','Kdt Stv','Hptfw','Four','Zfhr','Büroordonnanz','Ordonnanz')),
  reihenfolge int not null default 50
);
insert into public.funktionen (code, typ, reihenfolge) values
  ('Kdt','Kdt',1), ('Kdt Stv','Kdt Stv',2), ('Hptfw','Hptfw',3), ('Four','Four',4),
  ('Zfhr','Zfhr',5), ('Büroordonnanz','Büroordonnanz',6), ('Ordonnanz','Ordonnanz',7);

-- Mitglieder: nur wer hier steht, kann ein Konto erstellen.
create table public.mitglieder (
  email text primary key check (email = lower(email)),
  name text,
  funktion text not null references public.funktionen(code) on update cascade,
  ober_funktion text references public.funktionen(code) on update cascade, -- nur Ordonnanz
  user_id uuid unique,
  zuletzt_online timestamptz,
  aktiv boolean not null default true
);

create table public.dienste (
  id uuid primary key default gen_random_uuid(),
  art text not null check (art in ('Dienst','KVK','URE','URB')),
  titel text not null,
  beginn date not null,
  ende date not null check (ende >= beginn),
  freigeschaltet_bis date, -- Haken «freischalten»: offen bis zu diesem Tag
  erstellt timestamptz not null default now()
);

-- Teilnehmer: leer = alle Mitglieder; sonst nur die eingetragenen.
create table public.dienst_teilnehmer (
  dienst_id uuid references public.dienste(id) on delete cascade,
  email text references public.mitglieder(email) on update cascade on delete cascade,
  primary key (dienst_id, email)
);

create table public.todos (
  id uuid primary key default gen_random_uuid(),
  dienst_id uuid not null references public.dienste(id) on delete restrict,
  was text not null check (length(was) between 1 and 500),
  funktion text not null references public.funktionen(code) on update cascade,
  grundlage text, an_wen text, wie text,
  anker text check (anker in ('Beginn','Ende')), -- relativer Termin
  tage int check (tage between -400 and 400),
  datum date,
  gesperrt boolean not null default false,       -- vom Kdt gesetzt: nicht verschiebbar
  status text not null default 'offen' check (status in ('offen','vorbereitet','erledigt','negativ')),
  notiz text check (length(notiz) <= 1000),
  dienstuebergreifend boolean not null default false,
  erstellt_von uuid default auth.uid(),
  erstellt timestamptz not null default now(),
  geaendert_von uuid,
  geaendert timestamptz
);
create index on public.todos (dienst_id, funktion);

-- Hilfsfunktionen (laufen mit Besitzerrechten, lesen nur das eigene Mitglied)
create function public.ich() returns public.mitglieder
language sql stable security definer set search_path = public as $$
  select * from public.mitglieder where user_id = auth.uid() and aktiv
$$;

create function public.ist_kdt() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mitglieder m join public.funktionen f on f.code = m.funktion
                 where m.user_id = auth.uid() and m.aktiv and f.typ = 'Kdt')
$$;

create function public.ist_ordonnanz() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.mitglieder m join public.funktionen f on f.code = m.funktion
                 where m.user_id = auth.uid() and m.aktiv and f.typ = 'Ordonnanz')
$$;

-- Funktion, deren To-dos ich sehe (Ordonnanz: die zugeteilte Funktion)
create function public.meine_funktion() returns text
language sql stable security definer set search_path = public as $$
  select case when f.typ = 'Ordonnanz' then m.ober_funktion else m.funktion end
  from public.mitglieder m join public.funktionen f on f.code = m.funktion
  where m.user_id = auth.uid() and m.aktiv
$$;

-- Ein Dienst ist für das Team offen: 7 Tage vor Beginn bis 14 Tage nach Ende, oder freigeschaltet.
create function public.dienst_sichtbar(d_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.dienste d
    where d.id = d_id
      and (current_date between d.beginn - 7 and d.ende + 14
           or coalesce(d.freigeschaltet_bis, date '1900-01-01') >= current_date)
      and (not exists (select 1 from public.dienst_teilnehmer t where t.dienst_id = d.id)
           or exists (select 1 from public.dienst_teilnehmer t join public.mitglieder m on m.email = t.email
                      where t.dienst_id = d.id and m.user_id = auth.uid())))
$$;

-- Nur eingeladene Adressen dürfen ein Konto erstellen; danach Konto mit Mitglied verbinden.
create function public.konto_pruefen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.mitglieder where email = lower(new.email) and aktiv and user_id is null) then
    raise exception 'Diese Adresse ist nicht eingeladen.';
  end if;
  return new;
end $$;

create function public.konto_verbinden() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.mitglieder set user_id = new.id where email = lower(new.email) and user_id is null;
  return new;
end $$;

create trigger konto_pruefen before insert on auth.users for each row execute function public.konto_pruefen();
create trigger konto_verbinden after insert on auth.users for each row execute function public.konto_verbinden();

-- «Zuletzt online» setzen (nur das eigene Mitglied)
create function public.ping() returns void
language sql security definer set search_path = public as $$
  update public.mitglieder set zuletzt_online = now() where user_id = auth.uid()
$$;

-- To-do-Regeln: relativer Termin, Sperre, Ordonnanz
create function public.todo_regeln() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.dienste; kdt boolean := public.ist_kdt();
begin
  if tg_op = 'UPDATE' and not kdt then
    if new.dienst_id <> old.dienst_id or new.funktion <> old.funktion or new.gesperrt <> old.gesperrt
       or new.erstellt_von is distinct from old.erstellt_von then
      raise exception 'Nur der Kdt darf Dienst, Funktion oder Sperre ändern.';
    end if;
    if old.gesperrt and (new.datum is distinct from old.datum or new.anker is distinct from old.anker
                         or new.tage is distinct from old.tage) then
      raise exception 'Dieser Termin ist vom Kdt gesetzt und nicht verschiebbar.';
    end if;
    if public.ist_ordonnanz() and new.status <> old.status and new.status not in ('offen','vorbereitet') then
      raise exception 'Ordonnanz kann nur «vorbereitet» melden.';
    end if;
  end if;
  if tg_op = 'INSERT' and not kdt then
    new.gesperrt := false;
    new.erstellt_von := auth.uid();
    if public.ist_ordonnanz() then
      new.status := 'offen';
    end if;
  end if;
  -- Der Kdt setzt einen Termin → gesperrt (nicht bei automatischem Neurechnen oder Übernehmen)
  if kdt and pg_trigger_depth() = 1 and (new.datum is not null or new.anker is not null) and
     (tg_op = 'INSERT' or new.datum is distinct from old.datum or new.anker is distinct from old.anker
      or new.tage is distinct from old.tage) then
    new.gesperrt := true;
  end if;
  if new.anker is not null then
    if new.tage is null then new.tage := 0; end if;
    select * into d from public.dienste where id = new.dienst_id;
    new.datum := case new.anker when 'Beginn' then d.beginn else d.ende end + new.tage;
  end if;
  if tg_op = 'UPDATE' then
    new.geaendert := now();
    new.geaendert_von := auth.uid();
  end if;
  return new;
end $$;
create trigger todo_regeln before insert or update on public.todos for each row execute function public.todo_regeln();

-- Dienst verschoben → relative Termine neu rechnen
create function public.dienst_termine() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.todos set datum = case anker when 'Beginn' then new.beginn else new.ende end + tage
  where dienst_id = new.id and anker is not null;
  return new;
end $$;
create trigger dienst_termine after update of beginn, ende on public.dienste
  for each row execute function public.dienst_termine();

-- Neuer Dienst → dienstübergreifende To-dos des letzten Dienstes gleicher Art übernehmen
create function public.dienst_uebernehmen() returns trigger
language plpgsql security definer set search_path = public as $$
declare vorher uuid;
begin
  select id into vorher from public.dienste
  where art = new.art and id <> new.id and beginn < new.beginn order by beginn desc limit 1;
  if vorher is not null then
    insert into public.todos (dienst_id, was, funktion, grundlage, an_wen, wie, anker, tage, datum, gesperrt,
                              dienstuebergreifend, erstellt_von)
    select new.id, was, funktion, grundlage, an_wen, wie, anker, tage,
           null, (gesperrt and anker is not null), true, erstellt_von
    from public.todos where dienst_id = vorher and dienstuebergreifend;
  end if;
  return new;
end $$;
create trigger dienst_uebernehmen after insert on public.dienste
  for each row execute function public.dienst_uebernehmen();

-- Rechte (Row Level Security)
alter table public.funktionen enable row level security;
alter table public.mitglieder enable row level security;
alter table public.dienste enable row level security;
alter table public.dienst_teilnehmer enable row level security;
alter table public.todos enable row level security;

create policy lesen on public.funktionen for select to authenticated using (true);
create policy kdt on public.funktionen for all to authenticated using (public.ist_kdt()) with check (public.ist_kdt());

create policy lesen on public.mitglieder for select to authenticated using (public.ist_kdt() or user_id = auth.uid());
create policy kdt on public.mitglieder for all to authenticated using (public.ist_kdt()) with check (public.ist_kdt());

create policy lesen on public.dienste for select to authenticated using (public.ist_kdt() or public.dienst_sichtbar(id));
create policy kdt on public.dienste for all to authenticated using (public.ist_kdt()) with check (public.ist_kdt());

create policy lesen on public.dienst_teilnehmer for select to authenticated using (public.ist_kdt());
create policy kdt on public.dienst_teilnehmer for all to authenticated using (public.ist_kdt()) with check (public.ist_kdt());

create policy lesen on public.todos for select to authenticated
  using (public.ist_kdt() or (funktion = public.meine_funktion() and public.dienst_sichtbar(dienst_id)));
create policy anlegen on public.todos for insert to authenticated
  with check (public.ist_kdt() or (funktion = public.meine_funktion() and not public.ist_ordonnanz()
                                   and public.dienst_sichtbar(dienst_id)));
create policy aendern on public.todos for update to authenticated
  using (public.ist_kdt() or (funktion = public.meine_funktion() and public.dienst_sichtbar(dienst_id)))
  with check (public.ist_kdt() or (funktion = public.meine_funktion() and public.dienst_sichtbar(dienst_id)));
create policy loeschen on public.todos for delete to authenticated using (public.ist_kdt());

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon, public;
grant execute on function public.ich(), public.ist_kdt(), public.ist_ordonnanz(), public.meine_funktion(),
  public.dienst_sichtbar(uuid), public.ping() to authenticated;
grant execute on function public.konto_pruefen(), public.konto_verbinden() to supabase_auth_admin;

-- Erster Kdt (DEINE Militär-Mailadresse, klein geschrieben):
insert into public.mitglieder (email, funktion) values ('deine.adresse@beispiel.ch', 'Kdt');
