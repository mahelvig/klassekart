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

revoke all on public.profiler, public.klasser, public.klassemedlemmer from anon;
grant select, insert, update, delete on public.profiler, public.klasser, public.klassemedlemmer to authenticated;
revoke execute on function public.er_medlem(uuid), public.finn_kollega(text), public.medlemmer_i(uuid[]) from public, anon;
grant execute on function public.er_medlem(uuid), public.finn_kollega(text), public.medlemmer_i(uuid[]) to authenticated;


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
