-- Klassekart – oppsett av databasen i Supabase
-- Lim inn alt i Supabase → SQL Editor → New query, og trykk Run.
-- Skriptet kan kjøres flere ganger.
--
-- Serveren lagrer bare kryptert innhold. Elevnavn, regler og kart krypteres i
-- nettleseren før de sendes, så databasen kan ikke lese dem.

-- ============================================================
-- 1. SKOLENS E-POSTDOMENE – endre denne linjen!
--    Bare adresser som slutter på dette domenet kan opprette konto.
-- ============================================================
create or replace function public.tillatt_domene() returns text
language sql immutable as $$ select 'osloskolen.no' $$;


-- ============================================================
-- 2. Tabeller
-- ============================================================
create table if not exists public.profiler (
  id                    uuid primary key references auth.users on delete cascade,
  epost                 text not null unique,
  offentlig_nokkel      text not null,  -- RSA, brukes av kolleger når de deler
  privat_passord        text not null,  -- privat nøkkel, kryptert med passordet
  privat_gjenoppretting text not null,  -- privat nøkkel, kryptert med koden
  egen_nokkel           text not null,  -- nøkkel til egendata, pakket med egen offentlige nøkkel
  egendata              text,           -- kryptert: rom og innstillinger
  opprettet             timestamptz not null default now()
);

create table if not exists public.klasser (
  id           uuid primary key default gen_random_uuid(),
  data         text not null,            -- kryptert: navn, elever, regler, kart
  versjon      integer not null default 1,
  opprettet_av uuid default auth.uid() references public.profiler on delete set null,
  endret       timestamptz not null default now(),
  endret_av    uuid references public.profiler on delete set null
);

create table if not exists public.klassemedlemmer (
  klasse_id   uuid not null references public.klasser on delete cascade,
  bruker_id   uuid not null references public.profiler on delete cascade,
  nokkel      text not null,             -- klassens nøkkel, pakket for dette medlemmet
  lagt_til_av uuid references public.profiler on delete set null,
  primary key (klasse_id, bruker_id)
);
create index if not exists klassemedlemmer_bruker on public.klassemedlemmer (bruker_id);

-- Rom (pultoppsett) er ikke personopplysninger og deles ukryptert med alle kolleger
create table if not exists public.rom (
  id           uuid primary key default gen_random_uuid(),
  navn         text not null unique,
  rader        jsonb not null,           -- pulter per gruppe per rad, f.eks. [[2,3,2],[2,3,2]]
  sperret      jsonb not null default '[]',
  opprettet_av uuid default auth.uid() references public.profiler on delete set null,
  endret       timestamptz not null default now(),
  endret_av    uuid references public.profiler on delete set null
);

-- Skoler man kan velge mellom. Brukerne kan bare lese listen (se seksjon 4).
create table if not exists public.skoleliste (
  navn text primary key
);

-- Rom deles med kollegene på samme skole. Skolen velges ved første innlogging.
alter table public.profiler add column if not exists skole text;
alter table public.rom      add column if not exists skole text;
alter table public.rom drop constraint if exists rom_navn_key;
create unique index if not exists rom_skole_navn on public.rom (skole, navn);



-- ============================================================
-- 3. Hjelpefunksjoner
-- ============================================================
create or replace function public.er_medlem(p_klasse uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from klassemedlemmer
    where klasse_id = p_klasse and bruker_id = auth.uid()
  );
$$;

-- Finn en kollega å dele med. Gir bare offentlig nøkkel, ikke noe annet.
create or replace function public.finn_kollega(p_epost text)
returns table (id uuid, epost text, offentlig_nokkel text)
language sql stable security definer set search_path = public as $$
  select p.id, p.epost, p.offentlig_nokkel
  from profiler p
  where auth.uid() is not null and p.epost = lower(trim(p_epost));
$$;

-- Skolen til den som er innlogget
create or replace function public.min_skole() returns text
language sql stable security definer set search_path = public as $$
  select skole from profiler where id = auth.uid();
$$;

-- Skolene man kan velge mellom. Legges til manuelt (se bunnen av filen), så alle
-- bruker samme skrivemåte.
create or replace function public.skoler() returns table (skole text)
language sql stable security definer set search_path = public as $$
  select s.navn from skoleliste s
  where auth.uid() is not null
  order by 1;
$$;

-- Velg skole. Må finnes i skolelisten (uansett store/små bokstaver). Rom jeg
-- laget før skolen var valgt, følger med.
create or replace function public.sett_skole(p_skole text) returns text
language plpgsql security definer set search_path = public as $$
declare
  ren text;
  finnes text;
begin
  if auth.uid() is null then
    raise exception 'Ikke innlogget';
  end if;
  ren := nullif(btrim(regexp_replace(coalesce(p_skole, ''), '\s+', ' ', 'g')), '');
  if ren is null then
    raise exception 'Velg skolen din';
  end if;
  select s.navn into finnes from skoleliste s where lower(s.navn) = lower(ren) limit 1;
  if finnes is null then
    raise exception 'Skolen finnes ikke i listen ennå. Send e-post til hvemsitterhvor@gmail.com, så blir den lagt til.';
  end if;
  ren := finnes;
  update profiler set skole = ren where id = auth.uid();
  update rom set skole = ren where opprettet_av = auth.uid() and skole is null;
  return ren;
end $$;

alter table public.rom alter column skole set default public.min_skole();

-- Hvem er med i klassene jeg selv er med i?
create or replace function public.medlemmer_i(p_klasser uuid[])
returns table (klasse_id uuid, bruker_id uuid, epost text)
language sql stable security definer set search_path = public as $$
  select m.klasse_id, m.bruker_id, p.epost
  from klassemedlemmer m join profiler p on p.id = m.bruker_id
  where m.klasse_id = any (p_klasser) and er_medlem(m.klasse_id);
$$;


-- ============================================================
-- 4. Tilgangsregler (Row Level Security)
-- ============================================================
alter table public.profiler        enable row level security;
alter table public.klasser         enable row level security;
alter table public.klassemedlemmer enable row level security;

drop policy if exists "egen profil les"    on public.profiler;
drop policy if exists "egen profil ny"     on public.profiler;
drop policy if exists "egen profil endre"  on public.profiler;
create policy "egen profil les"   on public.profiler for select to authenticated using (id = auth.uid());
create policy "egen profil ny"    on public.profiler for insert to authenticated with check (id = auth.uid() and epost = lower(auth.jwt() ->> 'email'));
create policy "egen profil endre" on public.profiler for update to authenticated using (id = auth.uid()) with check (id = auth.uid() and epost = lower(auth.jwt() ->> 'email'));

drop policy if exists "klasse les"    on public.klasser;
drop policy if exists "klasse ny"     on public.klasser;
drop policy if exists "klasse endre"  on public.klasser;
drop policy if exists "klasse slett"  on public.klasser;
create policy "klasse les"   on public.klasser for select to authenticated using (er_medlem(id) or opprettet_av = auth.uid());
create policy "klasse ny"    on public.klasser for insert to authenticated with check (opprettet_av = auth.uid());
create policy "klasse endre" on public.klasser for update to authenticated using (er_medlem(id));
create policy "klasse slett" on public.klasser for delete to authenticated using (er_medlem(id));

drop policy if exists "medlem les"    on public.klassemedlemmer;
drop policy if exists "medlem ny"     on public.klassemedlemmer;
drop policy if exists "medlem endre"  on public.klassemedlemmer;
drop policy if exists "medlem slett"  on public.klassemedlemmer;
create policy "medlem les"   on public.klassemedlemmer for select to authenticated
  using (bruker_id = auth.uid() or er_medlem(klasse_id));
-- medlemmer kan dele videre; den som lager en klasse kan melde seg selv inn
create policy "medlem ny"    on public.klassemedlemmer for insert to authenticated
  with check (
    er_medlem(klasse_id)
    or (bruker_id = auth.uid()
        and exists (select 1 from klasser k where k.id = klasse_id and k.opprettet_av = auth.uid()))
  );
create policy "medlem endre" on public.klassemedlemmer for update to authenticated using (er_medlem(klasse_id));
create policy "medlem slett" on public.klassemedlemmer for delete to authenticated using (er_medlem(klasse_id) or bruker_id = auth.uid());

alter table public.rom enable row level security;
drop policy if exists "rom les"    on public.rom;
drop policy if exists "rom ny"     on public.rom;
drop policy if exists "rom endre"  on public.rom;
drop policy if exists "rom slett"  on public.rom;
create policy "rom les"   on public.rom for select to authenticated using (skole = min_skole());
create policy "rom ny"    on public.rom for insert to authenticated with check (opprettet_av = auth.uid() and skole = min_skole());
create policy "rom endre" on public.rom for update to authenticated using (skole = min_skole()) with check (skole = min_skole());
-- bare den som laget rommet, kan slette det
create policy "rom slett" on public.rom for delete to authenticated using (opprettet_av = auth.uid() and skole = min_skole());

-- skolelisten: ingen policyer, så bare skoler() (security definer) leser den
alter table public.skoleliste enable row level security;
revoke all on public.skoleliste from anon, authenticated;

revoke all on public.profiler, public.klasser, public.klassemedlemmer, public.rom from anon;
grant select, insert, update, delete on public.profiler, public.klasser, public.klassemedlemmer, public.rom to authenticated;
revoke execute on function public.er_medlem(uuid), public.finn_kollega(text), public.medlemmer_i(uuid[]),
  public.min_skole(), public.skoler(), public.sett_skole(text) from public, anon;
grant execute on function public.er_medlem(uuid), public.finn_kollega(text), public.medlemmer_i(uuid[]),
  public.min_skole(), public.skoler(), public.sett_skole(text) to authenticated;


-- ============================================================
-- 5. Bare skolens e-postadresser kan registrere seg
-- ============================================================
create or replace function public.sjekk_domene() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) not like '%@' || lower(tillatt_domene()) then
    raise exception 'Bare e-postadresser fra skolen (@%) kan opprette konto', tillatt_domene();
  end if;
  return new;
end $$;

drop trigger if exists klassekart_sjekk_domene on auth.users;
create trigger klassekart_sjekk_domene
  before insert on auth.users
  for each row execute function public.sjekk_domene();

-- Samme krav når noen bytter e-postadresse, ellers kunne en konto flyttes
-- til en adresse utenfor skolen etter at den er opprettet.
drop trigger if exists klassekart_sjekk_domene_endring on auth.users;
create trigger klassekart_sjekk_domene_endring
  before update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.sjekk_domene();


-- ============================================================
-- 5b. Grenser per konto
--     Maks 30 klasser per lærer. Elevtallet (60 per klasse) kontrolleres i
--     nettleseren, siden databasen ikke kan lese kryptert innhold. Her settes
--     bare en øvre grense på hvor mye en klasse kan fylle.
--     Må stemme med MAKS_KLASSER i index.html.
-- ============================================================
create or replace function public.sjekk_klassegrenser() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.opprettet_av is not null
     and (select count(*) from klasser where opprettet_av = new.opprettet_av) >= 30 then
    raise exception 'Grensen på 30 klasser er nådd. Send e-post til hvemsitterhvor@gmail.com hvis du trenger flere klasser.';
  end if;
  if length(new.data) > 1000000 then
    raise exception 'Klassen er for stor. Send e-post til hvemsitterhvor@gmail.com hvis du trenger flere elever i en klasse.';
  end if;
  return new;
end $$;

drop trigger if exists klassekart_klassegrenser on public.klasser;
create trigger klassekart_klassegrenser
  before insert or update of data on public.klasser
  for each row execute function public.sjekk_klassegrenser();


-- ============================================================
-- 5c. Grenser for rom
--     Rommene deles med hele skolen, så grensen gjelder per skole: maks 100 rom
--     per skole og 100 pulter per rom. Må stemme med MAKS_ROM og MAKS_PULTER
--     i index.html.
-- ============================================================
create or replace function public.sjekk_romgrenser() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  pulter integer;
begin
  if tg_op = 'INSERT' and new.skole is not null
     and (select count(*) from rom where skole = new.skole) >= 100 then
    raise exception 'Skolen har nådd grensen på 100 rom. Send e-post til hvemsitterhvor@gmail.com hvis dere trenger flere rom.';
  end if;
  if jsonb_typeof(new.rader) <> 'array' or jsonb_typeof(new.sperret) <> 'array'
     or length(new.navn) > 50 then
    raise exception 'Ugyldig rom';
  end if;
  select coalesce(sum(v::integer), 0) into pulter
  from jsonb_array_elements(new.rader) r, jsonb_array_elements_text(r) v;
  if pulter > 100 or jsonb_array_length(new.sperret) > 100 then
    raise exception 'Et rom kan ha opptil 100 pulter. Send e-post til hvemsitterhvor@gmail.com hvis du trenger flere pulter i et rom.';
  end if;
  return new;
end $$;

drop trigger if exists klassekart_romgrenser on public.rom;
create trigger klassekart_romgrenser
  before insert or update of navn, rader, sperret on public.rom
  for each row execute function public.sjekk_romgrenser();


-- ============================================================
-- 6. Slett egen konto
--    Brukeren fjernes fra innloggingen, og profil og medlemskap følger med
--    (on delete cascade). Klasser ingen andre er med i, slettes. Klasser som er
--    delt med kolleger, blir hos dem. Rom er delt med skolen og blir stående.
-- ============================================================
create or replace function public.slett_min_konto() returns void
language plpgsql security definer set search_path = public as $$
declare
  meg uuid := auth.uid();
begin
  if meg is null then
    raise exception 'Ikke innlogget';
  end if;
  delete from klasser k
  where (k.opprettet_av = meg
         or exists (select 1 from klassemedlemmer m
                    where m.klasse_id = k.id and m.bruker_id = meg))
    and not exists (select 1 from klassemedlemmer m
                    where m.klasse_id = k.id and m.bruker_id <> meg);
  delete from auth.users where id = meg;
end $$;

revoke execute on function public.slett_min_konto() from public, anon;
grant execute on function public.slett_min_konto() to authenticated;
