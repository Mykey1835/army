-- Army-Plattform, Erweiterung 2: Rapporte (DR/KR), Abmachungen, Wappen
-- Einmal ausführen: Supabase → SQL Editor → alles einfügen → Run (nach schema.sql).

-- Wappen je Dienst (Dateiname im Ordner wappen/ der Webseite)
alter table public.dienste add column wappen text check (wappen ~ '^[a-z0-9-]+\.(png|svg|jpg)$');

-- Protokoll führen dürfen: Kdt und die Ordonnanz des Kdt
create function public.ist_protokoll() returns boolean
language sql stable security definer set search_path = public as $$
  select public.ist_kdt() or exists (
    select 1 from public.mitglieder m
    join public.funktionen f on f.code = m.funktion
    join public.funktionen o on o.code = m.ober_funktion
    where m.user_id = auth.uid() and m.aktiv and f.typ = 'Ordonnanz' and o.typ = 'Kdt')
$$;

create table public.rapporte (
  id uuid primary key default gen_random_uuid(),
  dienst_id uuid not null references public.dienste(id) on delete restrict,
  art text not null check (art in ('DR','KR')),   -- Dienstrapport, Kompanierapport
  datum date not null,
  zeit text check (zeit ~ '^[0-2][0-9][0-5][0-9]$'), -- z. B. 1730
  abgeschlossen boolean not null default false,
  erstellt timestamptz not null default now()
);

-- Beitrag jeder Funktion zu einem Rapport (Infos, Besprechungspunkte)
create table public.rapport_beitraege (
  rapport_id uuid references public.rapporte(id) on delete cascade,
  funktion text references public.funktionen(code) on update cascade,
  text text not null default '' check (length(text) <= 5000),
  geaendert timestamptz not null default now(),
  geaendert_von uuid default auth.uid(),
  primary key (rapport_id, funktion)
);

-- Abmachungen sind To-dos mit Bezug zum Rapport
alter table public.todos add column rapport_id uuid references public.rapporte(id) on delete set null;

create function public.rapport_offen(r_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.rapporte where id = r_id and not abgeschlossen)
$$;

-- Beiträge: nur offene Rapporte; geändert-Felder setzen
create function public.beitrag_regeln() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.rapport_offen(new.rapport_id) then
    raise exception 'Dieser Rapport ist abgeschlossen.';
  end if;
  new.geaendert := now();
  new.geaendert_von := auth.uid();
  return new;
end $$;
create trigger beitrag_regeln before insert or update on public.rapport_beitraege
  for each row execute function public.beitrag_regeln();

-- To-do-Regeln: Protokoll-Ordonnanz darf Abmachungen erfassen
create or replace function public.todo_regeln() returns trigger
language plpgsql security definer set search_path = public as $$
declare d public.dienste; kdt boolean := public.ist_kdt(); o jsonb; n jsonb;
  protokoll boolean := public.ist_protokoll();
begin
  if tg_op = 'UPDATE' and not kdt then
    o := to_jsonb(old) - 'geaendert' - 'geaendert_von';
    n := to_jsonb(new) - 'geaendert' - 'geaendert_von';
    if public.ist_ordonnanz() then
      if (n - 'status') <> (o - 'status')
         or not ((old.status, new.status) in (('offen','vorbereitet'), ('vorbereitet','offen'))) then
        raise exception 'Ordonnanz kann nur «vorbereitet» melden oder zurücknehmen.';
      end if;
    elsif old.gesperrt then
      if (n - 'status' - 'notiz') <> (o - 'status' - 'notiz') then
        raise exception 'Dieses To-do ist vom Kdt gesetzt: nur Status und Notiz änderbar.';
      end if;
    else
      if n->'dienst_id' <> o->'dienst_id' or n->'funktion' <> o->'funktion' or n->'gesperrt' <> o->'gesperrt'
         or n->'erstellt_von' <> o->'erstellt_von' or n->'erstellt' <> o->'erstellt'
         or n->'rapport_id' <> o->'rapport_id' then
        raise exception 'Nur der Kdt darf Dienst, Funktion, Rapport oder Sperre ändern.';
      end if;
    end if;
  end if;
  if tg_op = 'INSERT' and new.rapport_id is not null and not exists (
       select 1 from public.rapporte where id = new.rapport_id and dienst_id = new.dienst_id and not abgeschlossen) then
    raise exception 'Rapport abgeschlossen oder falscher Dienst.';
  end if;
  if tg_op = 'INSERT' and not kdt then
    if protokoll and new.rapport_id is not null then
      new.gesperrt := new.datum is not null or new.anker is not null; -- Abmachung: Sperre nur mit Termin
    else
      new.gesperrt := false;
      new.rapport_id := null;
    end if;
    new.status := 'offen';
    new.erstellt_von := auth.uid();
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

-- Rechte
alter table public.rapporte enable row level security;
alter table public.rapport_beitraege enable row level security;

create policy lesen on public.rapporte for select to authenticated
  using (public.ist_kdt() or public.dienst_sichtbar(dienst_id));
create policy protokoll on public.rapporte for insert to authenticated
  with check (public.ist_protokoll() and (public.ist_kdt() or public.dienst_sichtbar(dienst_id)));
create policy protokoll_aendern on public.rapporte for update to authenticated
  using (public.ist_protokoll()) with check (public.ist_protokoll());
create policy kdt_loeschen on public.rapporte for delete to authenticated using (public.ist_kdt());

create policy lesen on public.rapport_beitraege for select to authenticated
  using (exists (select 1 from public.rapporte r where r.id = rapport_id));
create policy schreiben on public.rapport_beitraege for insert to authenticated
  with check ((public.ist_protokoll() or funktion = public.meine_funktion())
              and exists (select 1 from public.rapporte r where r.id = rapport_id));
create policy aendern on public.rapport_beitraege for update to authenticated
  using ((public.ist_protokoll() or funktion = public.meine_funktion())
         and exists (select 1 from public.rapporte r where r.id = rapport_id))
  with check ((public.ist_protokoll() or funktion = public.meine_funktion())
              and exists (select 1 from public.rapporte r where r.id = rapport_id));

-- Abmachungen eines sichtbaren Rapports sieht das ganze Kader; Protokoll erfasst sie für alle Funktionen
create policy rapport_lesen on public.todos for select to authenticated
  using (rapport_id is not null and public.dienst_sichtbar(dienst_id));
create policy protokoll_anlegen on public.todos for insert to authenticated
  with check (rapport_id is not null and public.ist_protokoll() and public.dienst_sichtbar(dienst_id));

grant select, insert, update, delete on public.rapporte, public.rapport_beitraege to authenticated;
revoke execute on function public.ist_protokoll(), public.rapport_offen(uuid), public.beitrag_regeln()
  from anon, authenticated, public;
grant execute on function public.ist_protokoll(), public.rapport_offen(uuid) to authenticated;
