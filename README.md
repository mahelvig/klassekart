# Klassekart

Lag klassekart med trekning, regler for hvem som skal sitte sammen eller ikke, låste og sperrede pulter, flere rom og lagrede kart.

## Personvern

- Klasselister limes inn og tolkes i nettleseren. Bare fornavn, med etternavnets forbokstav ved like navn, tas vare på.
- Med konto krypteres alt om klassene i nettleseren før det lagres i Supabase. Databasen ser bare kryptert innhold.
- Hver klasse har sin egen nøkkel, som deles med kolleger via deres offentlige nøkkel. Ingen deler passord.
- Uten konto lagres alt bare i nettleseren på maskinen.

## Oppsett

1. Kjør `klassekart-supabase.sql` i Supabase → SQL Editor (endre e-postdomenet øverst ved behov).
2. Sett Supabase-adressen og den publiserbare nøkkelen i `SKY` i `index.html`.
3. Publiser `index.html`, for eksempel med GitHub Pages, og legg adressen inn i Supabase under Authentication → URL Configuration.

Den publiserbare nøkkelen er ment å ligge i nettsiden. Tilgangen styres av tilgangsreglene (RLS) i databasen.
