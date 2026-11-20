-- Army-Plattform, Erweiterung 3: LIK und PALF-Gliederung der Rapport-Beiträge
-- Einmal ausführen: Supabase → SQL Editor → alles einfügen → Run (nach 002_rapporte.sql).

-- LIK = Lagerapport im Kampf (Zwischenbesprechung)
alter table public.rapporte drop constraint rapporte_art_check;
alter table public.rapporte add constraint rapporte_art_check check (art in ('DR','KR','LIK'));

-- Jeder Beitrag ist nach PALF gegliedert: Personelles, Ausbildung, Logistik, Führung
-- (je Rückblick und Ausblick) und Divers. Bisherige Beiträge werden zu «Divers».
alter table public.rapport_beitraege add column abschnitt text not null default 'divers'
  check (abschnitt in ('p_rueck','p_aus','a_rueck','a_aus','l_rueck','l_aus','f_rueck','f_aus','divers'));
alter table public.rapport_beitraege drop constraint rapport_beitraege_pkey;
alter table public.rapport_beitraege add primary key (rapport_id, funktion, abschnitt);

-- Im DR gibt es keinen Punkt Ausbildung
create or replace function public.beitrag_regeln() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.rapport_offen(new.rapport_id) then
    raise exception 'Dieser Rapport ist abgeschlossen.';
  end if;
  if new.abschnitt like 'a\_%' and exists (select 1 from public.rapporte where id = new.rapport_id and art = 'DR') then
    raise exception 'Im DR gibt es keinen Punkt Ausbildung.';
  end if;
  new.geaendert := now();
  new.geaendert_von := auth.uid();
  return new;
end $$;
revoke execute on function public.beitrag_regeln() from anon, authenticated, public;
