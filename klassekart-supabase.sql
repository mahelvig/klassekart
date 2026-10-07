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

-- Skoler som allerede finnes, så kolleger velger samme skrivemåte
create or replace function public.skoler() returns table (skole text)
language sql stable security definer set search_path = public as $$
  select distinct p.skole from profiler p
  where auth.uid() is not null and p.skole is not null
  order by 1;
$$;

-- Velg skole. Finnes skolen fra før (uansett store/små bokstaver), brukes den
-- skrivemåten. Rom jeg laget før skolen var valgt, følger med.
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
    raise exception 'Skriv inn navnet på skolen';
  end if;
  select p.skole into finnes from profiler p where lower(p.skole) = lower(ren) limit 1;
  ren := coalesce(finnes, ren);
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
