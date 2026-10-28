# Klassekart

Lag klassekart med trekning, regler for hvem som skal sitte sammen eller ikke, låste og sperrede pulter, flere rom og lagrede kart.

Publisert på [hvemsitterhvor.no](https://hvemsitterhvor.no).

## Personvern

- Klasselister limes inn og tolkes i nettleseren. Bare fornavn, med etternavnets forbokstav ved like navn, tas vare på.
- Med konto krypteres alt om klassene i nettleseren før det lagres i Supabase. Databasen ser bare kryptert innhold.
- Hver klasse har sin egen nøkkel, som deles med kolleger via deres offentlige nøkkel. Ingen deler passord.
- Uten konto lagres alt bare i nettleseren på maskinen.

## Oppsett

1. Kjør `klassekart-supabase.sql` i Supabase → SQL Editor (endre e-postdomenet øverst ved behov).
2. Sett Supabase-adressen og den publiserbare nøkkelen i `SKY` i `js/oppsett.js`.
3. Publiser repoet, for eksempel med GitHub Pages, og legg adressen inn i Supabase under Authentication → URL Configuration.

Den publiserbare nøkkelen er ment å ligge i nettsiden. Tilgangen styres av tilgangsreglene (RLS) i databasen.

## Filene

Siden er ren HTML, CSS og JavaScript uten byggesteg.

| Fil | Innhold |
| --- | --- |
| `index.html` | Markup for hele appen |
| `css/klassekart.css` | All styling, også mobil og utskrift |
| `js/oppsett.js` | Supabase-prosjekt og startklasse |
| `js/grunnlag.js` | Lagring, hjelpere og datamodellen |
| `js/trekning.js` | Trekning etter reglene, angre og nabominne |
| `js/kart.js` | Tegning av kartet, paneler, dialoger og verktøylinjen |
| `js/grupper.js` | Gruppefarger og tilfeldige grupper |
| `js/klasser.js` | Klasseoversikten, rom, import og sikkerhetskopier |
| `js/sky.js` | Kryptering og lagring i Supabase |
| `js/innlogging.js` | Kontomeny, innlogging og oppstart |
| `personvern.html` | Personvernerklæringen |
| `klassekart-supabase.sql` | Tabeller, tilgangsregler og funksjoner i Supabase |

Skriptene deler ett globalt navnerom og lastes i rekkefølgen i `index.html`. Kode som kjører mens en fil lastes (for eksempel `vedKlikk('knapp', funksjon)` utenfor en funksjon), kan bare bruke navn fra samme fil eller tidligere filer. Testen under sjekker dette.

## Testing

```
npm install
npm test
```

Testene åpner siden i Chromium, både som PC og som iPhone, og sjekker dialogene, mobilvisningen og at ingen skript avhenger av et som lastes senere. Skjermbilder lagres i `tester/skjermbilder/`. Innlogging med konto testes ikke, siden det krever kontakt med Supabase.
