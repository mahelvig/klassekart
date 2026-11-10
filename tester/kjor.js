/* Tester Klassekart i en ekte nettleser (Chromium via Playwright).

   Kjør fra repo-roten:  npm install  og så  npm test
   Skjermbilder havner i tester/skjermbilder/. Konto og lagring i skyen
   testes mot en etterligning av Supabase (falsk-supabase.js), ikke mot det
   ekte prosjektet. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { chromium, devices } = require('playwright');

const ROT = path.join(__dirname, '..');
const BILDER = path.join(__dirname, 'skjermbilder');
const ELEVER = [
  'Ada Berg', 'Emil Dahl', 'Sara Lie', 'Noah Moe', 'Ines Holm', 'Jonas Vik',
  'Nora Strand', 'Lukas Ruud', 'Emma Aas', 'Oliver Bakke', 'Maja Lund',
  'Filip Nygård', 'Ida Haugen', 'Jakob Berge', 'Sofie Eide', 'William Hagen',
  'Leah Solberg', 'Henrik Dahle', 'Astrid Moen', 'Magnus Fjeld',
  'Thea Knutsen', 'Isak Brekke', 'Frida Aune', 'Tobias Lien', 'Linnea Vold',
  'Karl Johansen',
].join('\n');

let feilet = 0;
function sjekk(ok, tekst) {
  console.log((ok ? '  ok    ' : '  FEIL  ') + tekst);
  if (!ok) feilet++;
}

/* ---- 1. Lasterekkefølge ----
   Skriptene i js/ deler globalt navnerom og lastes i rekkefølgen i
   index.html. Kode som kjører mens en fil lastes (utenfor funksjoner),
   kan ikke bruke navn som først deklareres i en senere fil. */
function sjekkLasterekkefolge() {
  console.log('Lasterekkefølge');
  const html = fs.readFileSync(path.join(ROT, 'index.html'), 'utf8');
  const filer = [...html.matchAll(/<script src="(js\/[^"]+)"/g)].map((m) => m[1]);
  const trær = filer.map((f) =>
    acorn.parse(fs.readFileSync(path.join(ROT, f), 'utf8'), { ecmaVersion: 'latest' }),
  );
  const hvor = {};
  const samle = (p, i) => {
    if (!p) return;
    if (p.type === 'Identifier') hvor[p.name] = i;
    else if (p.type === 'ObjectPattern') p.properties.forEach((q) => samle(q.value || q.argument, i));
    else if (p.type === 'ArrayPattern') p.elements.forEach((q) => samle(q, i));
  };
  trær.forEach((t, i) =>
    t.body.forEach((n) => {
      if (n.type === 'FunctionDeclaration') hvor[n.id.name] = i;
      if (n.type === 'VariableDeclaration') n.declarations.forEach((d) => samle(d.id, i));
    }),
  );
  const funn = [];
  trær.forEach((t, i) => {
    (function gaa(n, forelder, nokkel) {
      if (!n || typeof n.type !== 'string') return;
      const iife = forelder && forelder.type === 'CallExpression' && nokkel === 'callee';
      if (/Function/.test(n.type) && !iife) return; // kropper kjøres senere
      if (n.type === 'Identifier') {
        const egenskap =
          forelder &&
          ((forelder.type === 'MemberExpression' && nokkel === 'property' && !forelder.computed) ||
            (forelder.type === 'Property' && nokkel === 'key' && !forelder.computed));
        if (!egenskap && hvor[n.name] > i)
          funn.push(`${filer[i]} bruker ${n.name} fra ${filer[hvor[n.name]]}`);
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach((x) => gaa(x, n, k));
        else if (v && typeof v.type === 'string') gaa(v, n, k);
      }
    })(t, null, null);
  });
  sjekk(funn.length === 0, 'ingen fil bruker navn fra en senere fil ved lasting' + (funn.length ? ': ' + funn.join('; ') : ''));
}

/* ---- enkel filtjener for repoet ---- */
/* ---- 1b. Content-Security-Policy ----
   Adressene i CSP-en står også i skriptlenken nederst i index.html og i
   js/oppsett.js. Stemmer de ikke, stopper nettleseren Supabase-biblioteket
   eller all kontakt med Supabase, og da virker ikke innloggingen. */
function sjekkCsp() {
  console.log('Content-Security-Policy');
  const les = (f) => fs.readFileSync(path.join(ROT, f), 'utf8');
  const direktiver = (html) => {
    const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    return Object.fromEntries(
      (m ? m[1] : '').split(';').map((d) => d.trim().split(/\s+/)).map(([navn, ...verdier]) => [navn, verdier]),
    );
  };
  const html = les('index.html');
  const d = direktiver(html);
  const skript = (html.match(/<script\s+src="(https:[^"]+)"/) || [])[1];
  const prosjekt = (les('js/oppsett.js').match(/url:\s*'([^']+)'/) || [])[1];
  const lik = (a, b) => JSON.stringify(a || []) === JSON.stringify(b);
  sjekk(lik(d['default-src'], ["'none'"]), 'alt som ikke er nevnt, er stengt (default-src none)');
  sjekk(
    lik(d['script-src'], ["'self'", skript]),
    'skript: bare siden selv og Supabase-biblioteket i versjonen siden laster',
  );
  sjekk(
    (d['connect-src'] || []).includes(prosjekt) && d['connect-src'].every((a) => a.endsWith(new URL(prosjekt).host)),
    'kontakt: bare Supabase-prosjektet fra js/oppsett.js',
  );
  const p = direktiver(les('personvern.html'));
  sjekk(lik(p['default-src'], ["'none'"]) && !p['script-src'], 'personvernsiden tillater ingen skript');
}

const TYPER = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
};
function startTjener() {
  const tjener = http.createServer((req, res) => {
    const fil = path.join(ROT, decodeURIComponent(req.url.split('?')[0]));
    if (!fil.startsWith(ROT) || !fs.existsSync(fil) || fs.statSync(fil).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPER[path.extname(fil)] || 'application/octet-stream' });
    fs.createReadStream(fil).pipe(res);
  });
  return new Promise((ok) => tjener.listen(0, () => ok(tjener)));
}

// nettleseren melder brudd på Content-Security-Policy som feil i konsollen
function cspBrudd(m, feil) {
  if (m.type() === 'error' && /Content Security Policy/.test(m.text()))
    feil.push('CSP: ' + m.text().split('\n')[0].slice(0, 200));
}
async function nySide(nettleser, url, oppsett, feil) {
  const ctx = await nettleser.newContext(oppsett);
  // Supabase-skriptet fra CDN trengs ikke for å teste uten konto
  await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  const side = await ctx.newPage();
  side.on('pageerror', (e) => feil.push(e.message));
  side.on('console', (m) => cspBrudd(m, feil));
  side.on('dialog', (d) => {
    feil.push('innebygd nettleserdialog: ' + d.message());
    d.dismiss();
  });
  await side.goto(url);
  return side;
}
async function klasseMedElever(s, trykk) {
  await s[trykk]('#innLokal');
  await s[trykk]('.klassekort:not(.ny) >> nth=0');
  await s[trykk]('#importmodus');
  await s.fill('#importtekst', ELEVER);
  await s[trykk]('#importLegg');
  await s[trykk]('#trekk');
  await s.waitForTimeout(300);
}
// navn som går over flere linjer, med mål som forklarer hvorfor
const delteNavn = (s) =>
  s.$$eval('#kart .plass .navn', (x) =>
    x
      .filter((n) => n.offsetHeight > parseFloat(getComputedStyle(n).lineHeight) * 1.5)
      .map((n) => {
        const p = getComputedStyle(n.parentElement);
        const ledig = n.parentElement.clientWidth - parseFloat(p.paddingLeft) - parseFloat(p.paddingRight);
        return (
          `${n.textContent} (bredde ${n.offsetWidth}, plass ${ledig}, høyde ${n.offsetHeight}, ` +
          `skrift ${getComputedStyle(n).fontSize}, linje ${getComputedStyle(n).lineHeight}, ` +
          `${n.classList.contains('passer') ? 'passer' : 'passer ikke'}, ` +
          `Atkinson ${document.fonts.check('700 12px "Atkinson Hyperlegible"') ? 'lastet' : 'ikke lastet'})`
        );
      }),
  );
const ingenDelteNavn = async (s, tekst) => {
  const delte = await delteNavn(s);
  sjekk(delte.length === 0, tekst + (delte.length ? ': ' + delte.join('; ') : ''));
};
const ingenSideScroll = (s) =>
  s.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/* ---- 2. Dialogene ---- */
async function sjekkDialoger(nettleser, url, feil) {
  console.log('Dialoger (PC)');
  const s = await nySide(nettleser, url, { viewport: { width: 1200, height: 800 } }, feil);
  await s.click('#innLokal');
  await s.click('.klassekort.ny');
  await s.waitForSelector('#sporsmal[open]');
  sjekk((await s.evaluate(() => document.activeElement.id)) === 'sporsmalSvar', 'tekstfeltet har fokus');
  await s.keyboard.press('Escape');
  sjekk(!(await s.isVisible('#sporsmal')), 'Esc lukker dialogen');

  await s.click('.klassekort.ny');
  await s.fill('#sporsmalSvar', '9B');
  await s.keyboard.press('Enter');
  await s.waitForTimeout(200);
  sjekk((await s.textContent('#tittel')).includes('9B'), 'Enter lager klassen 9B');

  await s.click('#tilKlasser');
  await s.click('.klassekort.ny');
  await s.fill('#sporsmalSvar', '9B');
  await s.click('#sporsmalOk');
  await s.waitForSelector('#sporsmal[open]');
  sjekk((await s.textContent('#sporsmalTekst')).includes('finnes fra før'), 'melding om at klassen finnes');
  sjekk(!(await s.isVisible('#sporsmalAvbryt')), 'meldingen har bare OK');
  await s.click('#sporsmalOk');

  const slett = s.locator('.klassekort', { hasText: '9B' }).locator('text=Slett');
  await slett.click();
  await s.waitForSelector('#sporsmal[open]');
  sjekk((await s.evaluate(() => document.activeElement.id)) === 'sporsmalAvbryt', 'Avbryt har fokus ved sletting');
  sjekk(await s.$eval('#sporsmalOk', (b) => b.classList.contains('fare')), 'slett-knappen er rød');
  await s.screenshot({ path: path.join(BILDER, 'pc-slett-klasse.png') });
  await s.mouse.click(5, 5);
  sjekk(!(await s.isVisible('#sporsmal')), 'klikk utenfor avbryter');
  await slett.click();
  await s.click('#sporsmalOk');
  await s.waitForTimeout(200);
  sjekk(!(await s.isVisible('.klassekort:has-text("9B")')), 'klassen er slettet etter bekreftelse');
  sjekk(!(await s.isVisible('#merKnapp')) && (await s.isVisible('.klassekort')), 'PC: ingen Mer-knapp');
}

/* ---- 3. Lagring: rom og status ---- */
async function sjekkLagring(nettleser, url, feil) {
  console.log('Lagring per rom, og lagrestatus');
  const s = await nySide(nettleser, url, { viewport: { width: 1200, height: 800 } }, feil);
  const plasser = () => s.evaluate(() => JSON.stringify(Object.entries(D.aktiv.plasser).sort()));
  const rom = () => s.evaluate(() => D.aktiv.rom);
  await klasseMedElever(s, 'click');
  await s.waitForFunction(() => document.getElementById('skystatus').textContent.includes('Lagret kl.'));
  sjekk(true, 'toppen viser «✓ Lagret kl. …» uten konto');
  const statusSynlig = () => s.evaluate(() => !document.getElementById('skystatus').classList.contains('borte'));
  sjekk(await statusSynlig(), '«✓ Lagret» vises rett etter lagring');
  // fire sekunder pluss selve uttoningen: vent på resultatet, ikke på klokka
  const tonetUt = await s
    .waitForFunction(
      () => {
        const e = document.getElementById('skystatus');
        return e.classList.contains('borte') && getComputedStyle(e).opacity === '0';
      },
      null,
      { timeout: 10000 },
    )
    .then(
      () => true,
      () => false,
    );
  sjekk(tonetUt, '«✓ Lagret» har tonet ut etter fire sekunder');
  await s.click('#trekk');
  await s.waitForTimeout(500);
  sjekk(await statusSynlig(), '«✓ Lagret» kommer tilbake ved neste lagring');
  const standard = await plasser();

  await s.selectOption('#velgRom', '');
  await s.fill('#sporsmalSvar', '218');
  await s.keyboard.press('Enter');
  await s.waitForTimeout(200);
  sjekk((await rom()) === '218' && (await plasser()) === '[]', 'nytt rom starter tomt');
  await s.click('#romFerdig'); // et nytt rom åpnes i redigering
  await s.click('#trekk');
  const rom218 = await plasser();

  await s.selectOption('#velgRom', 'Standardrom');
  sjekk((await plasser()) === standard, 'tilbake i standardrommet: plasseringen er der fortsatt');
  await s.selectOption('#velgRom', '218');
  sjekk((await plasser()) === rom218, 'tilbake i 218: plasseringen der er også husket');

  await s.waitForTimeout(500); // lagringen venter litt før den skriver
  await s.reload();
  await s.click('.klassekort:not(.ny) >> nth=0');
  sjekk((await rom()) === '218' && (await plasser()) === rom218, 'etter omlasting åpner klassen i 218 med samme plassering');
  await s.selectOption('#velgRom', 'Standardrom');
  sjekk((await plasser()) === standard, 'etter omlasting er standardrommet også husket');

  // «Endre rommet» på standardrommet lager en kopi: elevene skal bli sittende
  await s.click('#endreRom');
  await s.click('#sporsmalOk');
  await s.click('#sporsmalOk');
  await s.waitForTimeout(200);
  sjekk((await rom()) === 'Mitt rom' && (await plasser()) === standard, 'kopi av standardrommet: elevene blir sittende');
  await s.click('#romAvbryt');
  sjekk(
    (await rom()) === 'Standardrom' && (await plasser()) === standard &&
      !(await s.evaluate(() => 'Mitt rom' in D.rom)),
    'Avbryt fjerner kopien og går tilbake til standardrommet',
  );

  await s.click('#kart .plass:not(.tom) >> nth=0');
  sjekk(
    (await s.isVisible('.popup')) && !(await s.$('#kart .plass.valgt')),
    'med mus åpner et klikk på en elev pultpanelet, som før',
  );
  await s.evaluate(() => document.body.click());

  // sletter man et rom, forsvinner klassens plassering i det
  await s.selectOption('#velgRom', '218');
  await s.click('#endreRom');
  await s.click('#slettRom');
  await s.click('#sporsmalOk');
  await s.waitForTimeout(200);
  sjekk(
    (await rom()) === 'Standardrom' &&
      (await plasser()) === standard &&
      !(await s.evaluate(() => '218' in (klasse().romkart || {}))),
    'slettet rom: klassen går til standardrommet og glemmer 218',
  );
}

/* ---- 4. Lagrede kart ---- */
async function sjekkLagredeKart(nettleser, url, feil) {
  console.log('Lagrede kart');
  const s = await nySide(nettleser, url, { viewport: { width: 1200, height: 800 } }, feil);
  const plasser = () => s.evaluate(() => JSON.stringify(Object.entries(D.aktiv.plasser).sort()));
  const kart = () => s.evaluate(() => Object.values(D.kart).map((x) => ({ navn: x.navn, auto: !!x.auto })));
  // dialogen svarer først når den er lukket; gi appen et øyeblikk etterpå
  const svart = async () => {
    await s.waitForFunction(() => !document.getElementById('sporsmal').open);
    await s.waitForTimeout(100);
  };
  const flyttForHaand = () => s.dragAndDrop('#kart .plass:not(.tom) >> nth=0', '#kart .plass:not(.tom) >> nth=1');
  await klasseMedElever(s, 'click');

  await s.click('#trekk');
  sjekk((await kart()).length === 0, 'ny trekning av et urørt trekk lager ingen kopi');

  await flyttForHaand();
  const forHaand = await plasser();
  await s.click('#trekk');
  const etter = await kart();
  sjekk(
    etter.length === 1 && etter[0].auto && /^Før trekning \d\d:\d\d$/.test(etter[0].navn),
    'trekning etter flytting for hånd lagrer «Før trekning …» automatisk',
  );
  sjekk(await s.isVisible('.beskjed-knapper >> text=Angre'), 'beskjeden etter trekningen har Angre');
  await s.screenshot({ path: path.join(BILDER, 'pc-etter-trekning.png') });
  await s.click('.beskjed-knapper >> text=Angre');
  sjekk((await plasser()) === forHaand, 'Angre i beskjeden gir tilbake kartet ordnet for hånd');

  await s.click('#brukKart');
  await s.waitForSelector('#sporsmal[open]');
  sjekk(/^Uke \d+$/.test(await s.inputValue('#sporsmalSvar')), 'lagring foreslår «Uke …» som navn');
  sjekk((await s.$$('#sporsmalForslag button')).length === 3, 'tre forslag å trykke på');
  await s.click('#sporsmalForslag >> text=Prøvedag');
  await s.click('#sporsmalOk');
  await svart();
  const lagret = (await kart()).find((x) => x.navn === 'Prøvedag');
  sjekk(lagret && !lagret.auto, 'kartet er lagret som «Prøvedag»');
  sjekk((await s.evaluate(() => klasse().historikk.length)) === 1, 'lagring husker naboene til neste trekning');
  sjekk((await s.textContent('#tidligere')).trim() === 'Lagrede kart (2)', 'knappen viser antall lagrede kart');

  await s.click('#tidligere');
  sjekk(await s.evaluate(() => document.getElementById('lagrede').open), 'Lagrede kart åpner panelet');
  sjekk((await s.$$('#lagredeListe .lagret')).length === 2, 'panelet viser begge kartene');
  sjekk(
    (await s.textContent('.lagret:has-text("Prøvedag")')).includes('I bruk nå') &&
      (await s.textContent('.lagret:has-text("Før trekning")')).includes('Automatisk'),
    'merkene «I bruk nå» og «Automatisk» står på riktige kart',
  );
  await s.screenshot({ path: path.join(BILDER, 'pc-lagrede-kart.png') });

  await s.click('.lagret:has-text("Før trekning") >> text=Åpne');
  sjekk(!(await s.evaluate(() => document.getElementById('lagrede').open)), 'Åpne lukker panelet');
  sjekk((await plasser()) === forHaand, 'det åpnede kartet er det som ble ordnet for hånd');
  await s.click('#tidligere');
  await s.click('.lagret:has-text("Før trekning") .mer');
  await s.click('.lagret:has-text("Før trekning") >> text=Gi nytt navn');
  await s.fill('#sporsmalSvar', 'Beholdes');
  await s.click('#sporsmalOk');
  await svart();
  const omdopt = (await kart()).find((x) => x.navn === 'Beholdes');
  sjekk(omdopt && !omdopt.auto, 'et automatisk kart som får navn, blir et vanlig lagret kart');
  await s.click('.lagret:has-text("Beholdes") .mer');
  await s.click('.lagret:has-text("Beholdes") >> text=Slett');
  await s.click('#sporsmalOk');
  await svart();
  sjekk(!(await kart()).some((x) => x.navn === 'Beholdes'), 'Slett fjerner kartet');
  await s.click('#lagredeLukk');

  // bare de fem siste automatiske kartene beholdes
  for (let i = 0; i < 7; i++) {
    await flyttForHaand();
    await s.click('#trekk');
  }
  sjekk((await kart()).filter((x) => x.auto).length === 5, 'bare de fem siste automatiske kartene beholdes');

  await s.waitForTimeout(500);
  await s.reload();
  await s.click('.klassekort:not(.ny) >> nth=0');
  sjekk((await kart()).some((x) => x.navn === 'Prøvedag'), 'navnene er der etter omlasting');
}

/* ---- Sikkerhet ----
   Data kan komme fra en klasse en kollega har delt, eller fra en
   sikkerhetskopi. Ingenting i dem skal kunne kjøre kode i appen. */
async function sjekkSikkerhet(nettleser, url, feil) {
  console.log('Sikkerhet');
  const s = await nySide(nettleser, url, { viewport: { width: 1200, height: 800 } }, feil);
  await s.click('#innLokal');
  await s.click('.klassekort:not(.ny) >> nth=0');
  const ONDT = 'x"><img src=x onerror="window.angrepet=1">';

  // en ondsinnet ID rett i dataene: escapingen alene må stoppe den
  await s.evaluate((ond) => {
    const e = (id, navn) => ({ id, navn, kjonn: null, sammen: [], unna: [], sone: 'fri', gruppe: null });
    klasse().elever.push(e(ond, 'Ond'), e('vanlig', 'Ada'));
    D.aktiv.plasser = { '0-0-0': 'vanlig' };
    D.aktiv.farger = { '0-0-0': 'constructor', '0-0-1': 99 };
    tegn();
  }, ONDT);
  await s.click('#kart .plass >> nth=0');
  await s.click('.elevrad:has-text("Ada") .knapp.liten');
  await s.waitForTimeout(200);
  sjekk(!(await s.evaluate(() => window.angrepet)), 'en ondsinnet elev-ID kjører ikke kode i panelene');
  await s.evaluate(() => document.body.click());

  // en ondsinnet sikkerhetskopi: eleven med ugyldig ID tas bort
  const kopi = JSON.stringify({
    versjon: 3,
    klasser: { Angrep: { elever: [
      { id: ONDT, navn: 'Ond', sammen: [], unna: [] },
      { id: 'e1', navn: 'Ola', sammen: [ONDT], unna: [] },
    ], historikk: [] } },
    rom: { Standardrom: { rader: [[2, 3, 2]], sperret: [] } },
    kart: {},
    aktiv: { klasse: 'Angrep', rom: 'Standardrom', plasser: { '0-0-0': 'e1' }, laaste: [], farger: { '0-0-0': '__proto__' } },
  });
  // lesInn venter på svar i dialogen, så den startes uten å vente på den
  await s.evaluate((t) => {
    lesInn(t);
  }, kopi);
  await s.click('#sporsmalOk');
  await s.waitForTimeout(200);
  const elever = await s.evaluate(() => D.klasser.Angrep.elever.map((e) => e.id + ':' + e.sammen.length));
  sjekk(
    elever.length === 1 && elever[0] === 'e1:0',
    'en sikkerhetskopi med ugyldig elev-ID leses inn uten den eleven',
  );
  await s.click('#tilKlasser');
  await s.click('.klassekort:has-text("Angrep")');
  await s.click('#kart .plass >> nth=0');
  sjekk(!(await s.evaluate(() => window.angrepet)), 'klassen fra kopien kan åpnes uten at noe kjøres');

  // rom deles ukryptert med hele skolen: et rom som ikke er rader med små
  // heltall, tas bort i stedet for å tegnes
  const rom = await s.evaluate(() => {
    D.rom.MangeRader = { rader: Array.from({ length: 5000 }, () => [0]), sperret: [] };
    D.rom.Kjempestort = { rader: [[1e9]], sperret: [] };
    D.rom.Tekst = { rader: [[2, 'x']], sperret: [] };
    D.rom.IkkeLister = { rader: [2, 3], sperret: [] };
    D.rom.Greit = { rader: [[2, 2]], sperret: [7, '0-0-1'] };
    normaliser();
    tegn();
    return Object.keys(D.rom).sort().join(',') + ' ' + JSON.stringify(D.rom.Greit.sperret);
  });
  sjekk(
    rom === 'Greit,Standardrom ["0-0-1"]',
    'ugyldige rom tas bort, og gyldige beholdes' + (rom === 'Greit,Standardrom ["0-0-1"]' ? '' : ': ' + rom),
  );

  // skulle noe likevel slippe forbi escapingen, stopper Content-Security-Policy det
  const foer = feil.length;
  const innsmuglet = await s.evaluate(async () => {
    const d = document.createElement('div');
    d.innerHTML = '<img src="favicon.svg" onload="window.innsmuglet = 1">';
    document.body.appendChild(d);
    const skript = document.createElement('script');
    skript.textContent = 'window.innsmuglet = 2';
    document.body.appendChild(skript);
    const fremmed = document.createElement('script');
    fremmed.src = 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js';
    document.body.appendChild(fremmed);
    let sendt = false;
    try {
      await fetch('https://example.com/', { mode: 'no-cors' });
      sendt = true;
    } catch (err) {}
    await new Promise((ok) => setTimeout(ok, 300));
    [d, skript, fremmed].forEach((e) => e.remove());
    return { kjort: window.innsmuglet || 0, sendt };
  });
  await s.waitForTimeout(100);
  // bruddene over er ventet: ta dem ut av feillisten, og tell dem
  const nye = feil.splice(foer);
  const meldt = nye.filter((t) => t.startsWith('CSP: ')).length;
  feil.push(...nye.filter((t) => !t.startsWith('CSP: ')));
  sjekk(
    innsmuglet.kjort === 0 && !innsmuglet.sendt && meldt >= 4,
    'innsmuglet skript kjøres ikke, og får ikke sendt noe ut' +
      (innsmuglet.kjort === 0 && !innsmuglet.sendt && meldt >= 4 ? '' : ': ' + JSON.stringify({ ...innsmuglet, meldt })),
  );
}

/* ---- 4b. Tilgjengelighet ---- */
async function sjekkTilgjengelighet(nettleser, url, feil) {
  console.log('Tilgjengelighet');
  const s = await nySide(nettleser, url, { viewport: { width: 1200, height: 800 } }, feil);
  await klasseMedElever(s, 'click');
  // navnet skjermlesere får: synlig tekst, aria-label eller en label
  const utenNavn = (velger) =>
    s.$$eval(velger, (x) =>
      x.filter((e) => !(e.getAttribute('aria-label') || (e.labels && e.labels.length) || e.textContent.trim()))
        .length,
    );
  const tomme = await s.$$eval('#kart .plass.tom', (x) => x.length);
  sjekk(
    tomme > 0 && (await utenNavn('#kart .plass')) === 0,
    `alle pulter har et navn for skjermlesere, også de ${tomme} ledige`,
  );
  sjekk(
    (await s.getAttribute('#kart .plass.tom >> nth=0', 'aria-label')).startsWith('Ledig pult, '),
    'en ledig pult leses opp som «Ledig pult» med radnummer',
  );
  await s.click('#elevliste .elevrad .knapp.liten >> nth=0');
  await s.click('#kart .plass >> nth=0');
  const lister = await s.$$eval('.regelboks select, .popup select', (x) =>
    x.map((e) => e.getAttribute('aria-label') || ''),
  );
  sjekk(
    lister.length === 3 && lister.every(Boolean),
    'nedtrekkslistene i reglene og på pulten har navn' +
      (lister.length === 3 && lister.every(Boolean) ? '' : ': ' + JSON.stringify(lister)),
  );
  await s.keyboard.press('Escape');

  // med tastatur: «Hopp til kartet» kommer før elevlisten og går til Trekk
  await s.evaluate(() => {
    document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  let trykk = 0;
  while (trykk < 6 && !(await s.evaluate(() => document.activeElement.id === 'hoppTilKart'))) {
    await s.keyboard.press('Tab');
    trykk++;
  }
  const synlig = await s.evaluate(() => {
    const r = document.getElementById('hoppTilKart').getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.width > 0;
  });
  sjekk(trykk <= 3 && synlig, `«Hopp til kartet» nås med ${trykk} trykk på Tab og vises da`);
  await s.keyboard.press('Enter');
  sjekk(
    await s.evaluate(() => document.activeElement.id === 'trekk'),
    '«Hopp til kartet» flytter fokus til «Trekk plassering»',
  );
}

/* ---- 4c. Trekning, import og grupper ----
   Kjernelogikken, prøvd direkte på funksjonene i siden. Trekningen er
   tilfeldig, så reglene sjekkes over mange trekninger med en kontroll som
   er skrevet uavhengig av trekningens egen regning. For klasser på denne
   størrelsen ga 5000 trekninger ingen regelbrudd. */
async function sjekkLogikk(nettleser, url, feil) {
  console.log('Trekning, import og grupper');
  const s = await nySide(nettleser, url, { viewport: { width: 1200, height: 800 } }, feil);
  await s.click('#innLokal');
  await s.click('.klassekort:not(.ny) >> nth=0');
  const resultat = await s.evaluate(() => {
    const ut = [];
    const t = (ok, tekst, detalj) =>
      ut.push([!!ok, tekst, detalj === undefined ? '' : typeof detalj === 'string' ? detalj : JSON.stringify(detalj)]);
    const STD = () => Array.from({ length: 5 }, () => [2, 3, 2]);
    const lagKlasse = (navn, rom = 'Standardrom') => {
      klasse().elever = navn.map((n, i) => nyElev(n, i % 2 ? 'g' : 'j'));
      klasse().historikk = [];
      Object.assign(D.aktiv, { rom, plasser: {}, laaste: [], farger: {}, spre: false, nyeNaboer: true, makker: false });
      return elever();
    };
    const nummerert = (n) => Array.from({ length: n }, (_, i) => 'E' + i);
    const par = (felt, a, b) => {
      a[felt].push(b.id);
      b[felt].push(a.id);
    };
    const radTil = () => {
      const r = {};
      Object.entries(D.aktiv.plasser).forEach(([k, id]) => (r[id] = Number(k.split('-')[0])));
      return r;
    };
    const naboer = () => {
      const sett = new Set();
      naboPar().forEach(([a, b]) => {
        const ia = D.aktiv.plasser[a],
          ib = D.aktiv.plasser[b];
        if (ia && ib) sett.add(parN(ia, ib));
      });
      return sett;
    };
    // regelbrudd i kartet som vises nå, regnet ut uten trekningens egen kode
    const kontroll = () => {
      const n = naboer(),
        rad = radTil(),
        gs = sonegrenser(),
        brudd = [];
      elever().forEach((e) => {
        e.unna.forEach((id) => e.id < id && n.has(parN(e.id, id)) && brudd.push('unna'));
        e.sammen.forEach((id) => e.id < id && !n.has(parN(e.id, id)) && brudd.push('sammen'));
        if (e.sone === 'foran' && rad[e.id] > gs.foranMaks) brudd.push('foran');
        if (e.sone === 'bak' && rad[e.id] < gs.bakMin) brudd.push('bak');
      });
      return brudd;
    };
    const allePlassertEnGang = (antall) => {
      const ids = Object.values(D.aktiv.plasser);
      return ids.length === antall && new Set(ids).size === antall && ids.every((id) => elevMed(id));
    };

    /* ===== trekning ===== */
    lagKlasse(nummerert(26));
    t(
      naboPar().length === 20 && !naboPar().some(([a, b]) => a === '0-0-1' && b === '0-1-0'),
      'naboer er pulter i samme gruppe, ikke over midtgangen',
      naboPar().length,
    );
    const gs5 = sonegrenser();
    D.rom.TreRader = { rader: [[2, 2], [2, 2], [2, 2]], sperret: [] };
    D.aktiv.rom = 'TreRader';
    const gs3 = sonegrenser();
    D.aktiv.rom = 'Standardrom';
    t(
      gs5.foranMaks === 1 && gs5.bakMin === 3 && gs3.foranMaks === 0 && gs3.bakMin === 2,
      'foran er de to første radene og bak de to siste (én rad hver i små rom)',
      { gs5, gs3 },
    );

    // et kart satt opp for hånd, der hver regel er brutt én gang
    let [A, B, C, Dd, E, F] = lagKlasse(['Ada', 'Bo', 'Cem', 'Dina', 'Eva', 'Finn']);
    par('unna', A, B);
    par('sammen', C, Dd);
    E.sone = 'foran';
    F.sone = 'bak';
    D.aktiv.plasser = { '0-0-0': A.id, '0-0-1': B.id, '1-0-0': C.id, '2-0-0': Dd.id, '4-1-0': E.id, '0-2-0': F.id };
    const meldt = brudd(byggCtx());
    const ventet = [
      'Ada og Bo havnet ved siden av hverandre likevel.',
      'Eva fikk ikke plass foran.',
      'Finn fikk ikke plass bak.',
      'Cem fikk ingen å sitte ved siden av.',
    ];
    // hvem av de to som nevnes først, følger ID-ene, som er tilfeldige
    const sammenMeldt = meldt.some((m) => /^(Cem og Dina|Dina og Cem) fikk ikke sitte sammen\.$/.test(m));
    t(
      sammenMeldt && ventet.every((v) => meldt.includes(v)) && kontroll().sort().join() === 'bak,foran,sammen,unna',
      'regelbrudd i et kart meldes med navn',
      meldt,
    );

    // 26 elever og åtte regler: alle regler holder i hver trekning
    const regelklasse = () => {
      const e = lagKlasse(nummerert(26));
      par('unna', e[0], e[1]);
      par('unna', e[2], e[3]);
      par('unna', e[4], e[5]);
      par('sammen', e[6], e[7]);
      par('sammen', e[8], e[9]);
      e[10].sone = 'foran';
      e[11].sone = 'foran';
      e[12].sone = 'bak';
      return e;
    };
    regelklasse();
    let medBrudd = 0,
      feilAntall = 0,
      medMerknad = 0,
      like = 0,
      forrige = '';
    for (let i = 0; i < 20; i++) {
      trekkPlassering();
      if (kontroll().length) medBrudd++;
      if (!allePlassertEnGang(26)) feilAntall++;
      if (!document.getElementById('melding').hidden) medMerknad++;
      const naa = avtrykk(D.aktiv.plasser);
      if (naa === forrige) like++;
      forrige = naa;
    }
    t(feilAntall === 0, 'hver trekning gir alle 26 elever én plass hver', feilAntall);
    t(medBrudd === 0, 'reglene for sammen, ikke sammen, foran og bak holder i 20 trekninger', medBrudd);
    t(medMerknad === 0, 'når alle regler holder, vises ingen «Merk»', medMerknad);
    t(like === 0, 'hver trekning gir et nytt kart', like);

    // angre
    const foerTrekk = avtrykk(D.aktiv.plasser);
    trekkPlassering();
    const etterTrekk = avtrykk(D.aktiv.plasser);
    angre();
    t(etterTrekk !== foerTrekk && avtrykk(D.aktiv.plasser) === foerTrekk, 'Angre henter tilbake kartet fra før trekningen');

    // åtte elever som alle skal holdes unna hverandre: uten regelen ville
    // to av dem nesten alltid havnet ved siden av hverandre
    const atte = lagKlasse(nummerert(26)).slice(0, 8);
    atte.forEach((a, i) => atte.slice(i + 1).forEach((b) => par('unna', a, b)));
    let sammenLikevel = 0;
    for (let i = 0; i < 10; i++) {
      trekkPlassering();
      if (kontroll().length) sammenLikevel++;
    }
    t(sammenLikevel === 0, 'åtte elever som ikke skal sitte ved siden av hverandre, holdes fra hverandre i 10 trekninger', sammenLikevel);

    // låste pulter
    const [foran, bak] = lagKlasse(nummerert(26));
    D.aktiv.plasser = { '0-0-0': foran.id, '4-2-1': bak.id };
    D.aktiv.laaste = ['0-0-0', '4-2-1'];
    let flyttet = 0,
      feilAntall2 = 0;
    for (let i = 0; i < 10; i++) {
      trekkPlassering();
      if (D.aktiv.plasser['0-0-0'] !== foran.id || D.aktiv.plasser['4-2-1'] !== bak.id) flyttet++;
      if (!allePlassertEnGang(26)) feilAntall2++;
    }
    t(flyttet === 0 && feilAntall2 === 0, 'låste elever blir sittende, og alle andre får plass rundt dem', { flyttet, feilAntall2 });

    // sperrede pulter, også helt foran der elevene ellers plasseres først
    D.rom.Proverom = { rader: STD(), sperret: ['0-0-0', '0-0-1', '1-1-1'] };
    lagKlasse(nummerert(26), 'Proverom');
    let paaSperret = 0,
      feilAntall3 = 0;
    for (let i = 0; i < 10; i++) {
      trekkPlassering();
      if (rommet().sperret.some((k) => D.aktiv.plasser[k])) paaSperret++;
      if (!allePlassertEnGang(26)) feilAntall3++;
    }
    t(paaSperret === 0 && feilAntall3 === 0, 'ingen plasseres på en sperret pult, og alle får plass på de andre', { paaSperret, feilAntall3 });

    // flere elever enn pulter
    lagKlasse(nummerert(40));
    trekkPlassering();
    const merk = document.getElementById('melding').textContent;
    const utenPlass = (merk.match(/Uten plass: ([^.]*?)(?=Rommet|$)/) || ['', ''])[1].split(', ').filter(Boolean);
    t(
      allePlassertEnGang(35) && merk.includes('Rommet har 35 pulter, men klassen har 40 elever') && merk.includes('Uten plass: '),
      'med flere elever enn pulter fylles rommet, og resten står under «Merk»',
      merk.slice(0, 200),
    );
    t(
      elever().filter((e) => !Object.values(D.aktiv.plasser).includes(e.id)).length === 5 && utenPlass.length >= 5,
      'de fem uten plass er nevnt',
      utenPlass,
    );

    // nye naboer: ingen sitter ved siden av samme elev som i forrige kart
    lagKlasse(nummerert(26));
    trekkPlassering();
    let gjentatt = 0;
    for (let i = 0; i < 10; i++) {
      const foer = naaVaerendeNaboer();
      klasse().historikk = [foer];
      trekkPlassering();
      gjentatt += naaVaerendeNaboer().filter((p) => foer.includes(p)).length;
    }
    t(gjentatt === 0, '«Unngå naboer fra tidligere kart» gir bare nye naboer i 10 trekninger', gjentatt);

    // kjønn
    lagKlasse(nummerert(26));
    D.aktiv.spre = true;
    let likeKjonn = 0;
    for (let i = 0; i < 10; i++) {
      trekkPlassering();
      naboer().forEach((p) => {
        const [a, b] = p.split('|').map(elevMed);
        if (a.kjonn === b.kjonn) likeKjonn++;
      });
    }
    D.aktiv.spre = false;
    t(likeKjonn === 0, '«Fordel gutter og jenter jevnt»: ingen nabopar av samme kjønn med 13 av hver', likeKjonn);

    // tomme pulter havner bakerst
    lagKlasse(nummerert(20));
    let bakerst = 0;
    for (let i = 0; i < 10; i++) {
      trekkPlassering();
      if (Math.max(...Object.values(radTil())) > 2) bakerst++;
    }
    t(bakerst === 0, 'med 20 elever brukes de tre fremste radene, og de ledige pultene er bakerst', bakerst);

    /* ===== import av klasseliste ===== */
    const les = (tekst) => {
      const r = lesKlasseliste(tekst);
      const korte = forkortNavn(r.elever.map((e) => e.navn));
      return {
        navn: korte.map((n, i) => n + (r.elever[i].gruppe ? ' [' + r.elever[i].gruppe + ']' : '')).join(' | '),
        forslag: r.forslag,
      };
    };
    const imp = (tekst, ventet, hva) => {
      const fikk = les(tekst).navn;
      t(fikk === ventet, 'import: ' + hva, fikk);
    };
    imp('Kari Nordmann\nOla Hansen\nAli Khan', 'Kari | Ola | Ali', 'bare fornavnet tas vare på');
    imp('  Kari Nordmann  \r\n\r\nOla   Hansen\r\n', 'Kari | Ola', 'tomme linjer, ekstra mellomrom og Windows-linjeskift');
    imp(
      'Emma Hansen\nEmma Haugen\nEmma Berg\nOla Dahl',
      'Emma Han | Emma Hau | Emma B | Ola',
      'like fornavn får akkurat så mye av etternavnet som trengs',
    );
    imp('Åse Ødegård\nÅse Østby\nZoë Müller', 'Åse Ød | Åse Øs | Zoë', 'æ, ø, å og andre tegn');
    imp('Nordmann, Kari Marie\nHansen, Ola\nKhan, Ali', 'Kari | Ola | Ali', '«Etternavn, Fornavn»');
    imp(
      'Kari Marie Nordmann\nOla Hansen\nAnne-Marie Berg',
      'Kari | Ola | Anne-Marie',
      'mellomnavn tas bort, og dobbeltnavn med bindestrek beholdes',
    );
    imp(
      'Nr\tNavn\tKlasse\n1\tKari Nordmann\t2STA\n2\tOla Hansen\t2STB\n3\tAli Khan\t2STA',
      'Kari [2STA] | Ola [2STB] | Ali [2STA]',
      'tabell fra Excel, med klasse per elev',
    );
    imp('1. Kari Nordmann\n2. Ola Hansen\n3. Ali Khan', 'Kari | Ola | Ali', 'nummerert liste');
    imp(
      '1\nKari Nordmann\n2STA\n2\nOla Hansen\n2STB\n3\nAli Khan\n2STA',
      'Kari [2STA] | Ola [2STB] | Ali [2STA]',
      'liste fra PDF med nummer, navn og klasse på hver sin linje',
    );
    imp(
      'Kari Nordmann (3ME)\nOla\nHansen (3ME)\nAli Khan (3STA)',
      'Kari [3ME] | Ola [3ME] | Ali [3STA]',
      'fotoliste, også når et navn er brutt over to linjer',
    );
    const skoleplattformen =
      'NO/NOR1267\nKlasse\nElev\nFaglærer\n01 3ME Kari Nordmann Per Lærer\n02 3ME Ola Hansen Per Lærer\n' +
      '03 3STA Ali Khan Per Lærer\n04 3STA Emma Berg Per Lærer';
    imp(skoleplattformen, 'Kari [3ME] | Ola [3ME] | Ali [3STA] | Emma [3STA]', 'liste med klasse foran og lærerens navn bak hver elev');
    imp(
      'Foss videregående skole\n2026/2027\n12.08.2026\nKari Nordmann\nOla Hansen\n1/2',
      'Kari | Ola',
      'skolenavn, skoleår, dato og sidetall hoppes over',
    );
    imp('   \n\n', '', 'tom tekst gir ingen elever');
    t(les(skoleplattformen).forslag === 'NO/NOR1267', 'import: fagkoden foreslås som navn på klassen', les(skoleplattformen).forslag);
    const aldriElev = [
      'Nr\tNavn\tKlasse\n1\tKari Nordmann\t2STA\n2\tOla Hansen\t2STB',
      'Kari Nordmann\t2STA\nOla Hansen\t2STB\nAli Khan\t2STA',
      'Kari Nordmann (3ME)\nOla Hansen (3ME)\nAli Khan (3STA)',
      'Kari\nNordmann (3ME)\nOla Hansen (3ME)\nAli Khan (3STA)',
      'Nr Navn Klasse\n1 Kari Nordmann\n2 Ola Hansen',
      'Foss videregående skole\nKari Nordmann\nOla Hansen',
    ].map((x) => les(x).forslag);
    t(
      aldriElev.every((f) => f === ''),
      'import: en elev, en kolonneoverskrift eller skolenavnet foreslås aldri som navn på klassen',
      aldriElev,
    );

    // «Som tekst»: kjønn i parentes, og elever som beholdes, beholder reglene
    const [ada, emil, sara] = lagKlasse(['Ada', 'Emil', 'Sara']);
    ada.kjonn = emil.kjonn = sara.kjonn = null;
    par('unna', ada, emil);
    par('sammen', ada, sara);
    document.getElementById('tekstmodus').click();
    document.getElementById('elevtekst').value = 'Ada (j)\nEmil (G)\nNoah';
    document.getElementById('lagreTekst').click();
    const etter = elever().map((e) => e.navn + ':' + e.kjonn).join(',');
    const adaNaa = elever().find((e) => e.navn === 'Ada');
    t(etter === 'Ada:j,Emil:g,Noah:null', '«Som tekst»: (j) og (g) bak navnet setter kjønn', etter);
    t(
      adaNaa.id === ada.id && adaNaa.unna.join() === emil.id && adaNaa.sammen.length === 0,
      '«Som tekst»: den som blir stående, beholder reglene, og regler mot en som er tatt bort, forsvinner',
      { unna: adaNaa.unna.length, sammen: adaNaa.sammen.length },
    );

    /* ===== grupper ===== */
    const ant = (maate, tall, n) => antallGrupper({ maate, tall }, n);
    const antall = [ant('storrelse', 4, 26), ant('antall', 5, 26), ant('storrelse', 100, 26), ant('antall', 100, 26), ant('storrelse', 0, 26)];
    t(antall.join() === '7,5,1,26,26', 'grupper: antallet følger valget, og holder seg mellom én gruppe og én per elev', antall);

    const e26 = regelklasse();
    const ids = e26.map((e) => e.id);
    let skjevt = 0,
      mangler = 0,
      regelfeil = 0;
    for (let i = 0; i < 20; i++) {
      const g = delInnGrupper(ids, 7);
      const st = g.map((x) => x.length);
      if (Math.max(...st) - Math.min(...st) > 1 || g.length !== 7) skjevt++;
      if (g.flat().slice().sort().join() !== ids.slice().sort().join()) mangler++;
      const hvor = {};
      g.forEach((x, gi) => x.forEach((id) => (hvor[id] = gi)));
      e26.forEach((e) => {
        e.unna.forEach((id) => hvor[e.id] === hvor[id] && regelfeil++);
        e.sammen.forEach((id) => hvor[e.id] !== hvor[id] && regelfeil++);
      });
    }
    t(skjevt === 0 && mangler === 0, 'grupper: alle elever er med én gang, og gruppene er like store (±1)', { skjevt, mangler });
    t(regelfeil === 0, 'grupper: «ikke sammen» havner i hver sin gruppe og «sammen» i samme, i 20 trekninger', regelfeil);

    const liste = [
      { navn: 'A', elever: [e26[0].id, e26[1].id, e26[6].id] },
      { navn: 'B', elever: [e26[7].id, e26[2].id] },
    ];
    const gb = gruppebrudd(liste);
    const ikkeSammen = /^E[01] og E[01] skal ikke være sammen\.$/,
      skalSammen = /^E[67] og E[67] skal være sammen\.$/;
    t(
      gb[0].length === 2 && gb[0].some((x) => ikkeSammen.test(x)) && gb[0].some((x) => skalSammen.test(x)) &&
        gb[1].length === 1 && skalSammen.test(gb[1][0]),
      'grupper: regelbrudd vises på gruppene det gjelder',
      gb,
    );
    const navn = gruppenavn(8);
    t(new Set(navn).size === 8 && navn.every((n) => /^\S+ \S+$/.test(n)), 'grupper: åtte grupper får åtte ulike navn', navn);

    // makkergrupper: 3–5 elever som sitter nær hverandre
    let feilStorrelse = 0,
      ikkeDekket = 0;
    lagKlasse(nummerert(26));
    for (let i = 0; i < 10; i++) {
      trekkPlassering();
      lagMakkergrupper();
      const per = {};
      Object.values(D.aktiv.farger).forEach((f) => (per[f] = (per[f] || 0) + 1));
      if (Object.values(per).some((n) => n < 3 || n > 5)) feilStorrelse++;
      if (Object.keys(D.aktiv.farger).sort().join() !== Object.keys(D.aktiv.plasser).sort().join()) ikkeDekket++;
    }
    t(feilStorrelse === 0 && ikkeDekket === 0, 'makkergrupper: alle som har plass, er i en gruppe på 3–5', { feilStorrelse, ikkeDekket });
    trekkPlassering();
    lagMakkergrupper();
    // hvor pulten står: rad, og nummer fra venstre på tvers av midtgangene
    const sted = (k) => {
      const [r, g, i] = k.split('-').map(Number);
      return { r, x: rommet().rader[r].slice(0, g).reduce((a, b) => a + b, 0) + i };
    };
    const samlet = Object.entries(D.aktiv.farger).every(([k, f]) =>
      Object.entries(D.aktiv.farger).some(([k2, f2]) => {
        if (k2 === k || f2 !== f) return false;
        const a = sted(k),
          b = sted(k2);
        return Math.abs(a.r - b.r) <= 1 && Math.abs(a.x - b.x) <= 1;
      }),
    );
    t(samlet, 'makkergrupper: alle har en fra gruppen på pulten ved siden av, rett foran eller rett bak');
    return ut;
  });
  resultat.forEach(([ok, tekst, detalj]) => sjekk(ok, tekst + (ok || !detalj ? '' : ': ' + detalj)));
}

/* ---- 4d. Kopier av rom ----
   Rommene deles med skolen, og en kopi som er helt lik originalen, er bare
   støy i alles romliste. */
async function sjekkRomkopier(nettleser, url, feil) {
  console.log('Kopier av rom');
  const s = await nySide(nettleser, url, { viewport: { width: 1200, height: 800 } }, feil);
  await klasseMedElever(s, 'click');
  const tilstand = () =>
    s.evaluate(() => ({
      rom: D.aktiv.rom,
      alle: Object.keys(D.rom).sort().join(','),
      plassert: Object.keys(D.aktiv.plasser).length,
      redigerer: romModus,
    }));
  const lagRom = () =>
    s.evaluate(() => {
      D.rom.B312 = { rader: Array.from({ length: 5 }, () => [2, 3, 2]), sperret: ['4-0-0'] };
      byttRom('B312');
      trekkPlassering();
      settRomModus(true);
    });
  await lagRom();
  sjekk(
    (await s.textContent('#dupliserRom')).includes('Lag en kopi') &&
      (await s.evaluate(() => !document.getElementById('romFerdig').parentElement.contains(document.getElementById('dupliserRom')))),
    'kopiknappen heter ikke «Lagre», og står ikke sammen med Ferdig',
  );

  // en kopi uten endringer tas ikke vare på
  await s.click('#dupliserRom');
  await s.fill('#sporsmalSvar', 'B312 – prøve');
  await s.click('#sporsmalOk');
  const iRom = (navn) => s.waitForFunction((n) => D.aktiv.rom === n, navn, { timeout: 5000 }).then(() => true, () => false);
  sjekk(await iRom('B312 – prøve'), 'kopien åpnes for redigering');
  await s.click('#romFerdig');
  let t = await tilstand();
  sjekk(
    t.rom === 'B312' && t.alle === 'B312,Standardrom' && t.plassert === 26 && !t.redigerer,
    'Ferdig uten endringer: kopien forkastes, og klassen står i originalen med alle på plass' +
      (t.rom === 'B312' && t.alle === 'B312,Standardrom' && t.plassert === 26 ? '' : ': ' + JSON.stringify(t)),
  );
  sjekk((await s.textContent('#beskjed')).includes('helt lik B312'), 'læreren får beskjed om at kopien var lik');

  // det samme når redigeringen avbrytes
  await s.evaluate(() => settRomModus(true));
  await s.click('#dupliserRom');
  await s.fill('#sporsmalSvar', 'B312 – prøve');
  await s.click('#sporsmalOk');
  await iRom('B312 – prøve');
  await s.click('#romAvbryt');
  t = await tilstand();
  sjekk(t.rom === 'B312' && t.alle === 'B312,Standardrom', 'Avbryt: kopien forkastes også' + (t.alle === 'B312,Standardrom' ? '' : ': ' + JSON.stringify(t)));

  // foreslått navn uten at noe er skrevet til: ingen kopi
  await s.evaluate(() => settRomModus(true));
  await s.click('#dupliserRom');
  await s.click('#sporsmalOk');
  await s.waitForTimeout(200);
  t = await tilstand();
  sjekk(t.rom === 'B312' && t.alle === 'B312,Standardrom', 'uten et eget navn lages det ingen kopi');

  // en kopi som blir endret, beholdes
  await s.click('#dupliserRom');
  await s.fill('#sporsmalSvar', 'B312 – hestesko');
  await s.click('#sporsmalOk');
  await iRom('B312 – hestesko');
  await s.evaluate(() => endreRom((S) => S[0][0].push(null)));
  await s.click('#romFerdig');
  t = await tilstand();
  sjekk(
    t.rom === 'B312 – hestesko' && t.alle === 'B312,B312 – hestesko,Standardrom',
    'en kopi med et annet oppsett beholdes' + (t.rom === 'B312 – hestesko' ? '' : ': ' + JSON.stringify(t)),
  );

  // eldre kopier som er like originalen: skjules, og klassen flyttes
  const etter = await s.evaluate(() => {
    byttRom('B312');
    D.rom['B312 (kopi)'] = { rader: kopi(D.rom.B312.rader), sperret: ['4-0-0'] };
    D.rom['B312 (kopi) (kopi)'] = { rader: kopi(D.rom.B312.rader), sperret: ['4-0-0'] };
    D.rom['Annet (kopi)'] = { rader: [[2, 2]], sperret: [] }; // ingen original
    const iOriginalen = avtrykk(D.aktiv.plasser);
    byttRom('B312 (kopi) (kopi)');
    byttRom('B312 (kopi)');
    trekkPlassering();
    lagreKart('Uke 1', true);
    const plasser = avtrykk(D.aktiv.plasser);
    // slik det skjer når dataene hentes: flytt, og åpne så klassen
    huskOppsett();
    flyttFraLikeKopier();
    gjenopprett(D.aktiv.klasse);
    tegn();
    return {
      rom: D.aktiv.rom,
      liste: [...document.getElementById('velgRom').options].map((o) => o.textContent).join(','),
      sammePlasser: avtrykk(D.aktiv.plasser) === plasser,
      kart: Object.values(D.kart).filter((x) => x.navn === 'Uke 1').map((x) => x.rom).join(','),
      romkart: Object.keys(klasse().romkart).sort().join(','),
      tattVarePaa: Object.values(D.kart).some((x) => x.navn === 'Fra B312' && x.rom === 'B312' && avtrykk(x.plasser) === iOriginalen),
    };
  });
  sjekk(
    etter.liste === 'Annet (kopi),B312,B312 – hestesko,Standardrom,+ Nytt rom …',
    'like kopier står ikke i romlisten' + (etter.liste.startsWith('Annet (kopi),B312,B312 – hestesko,Standardrom') ? '' : ': ' + etter.liste),
  );
  sjekk(
    etter.rom === 'B312' && etter.sammePlasser && etter.kart === 'B312' && !etter.romkart.includes('(kopi)'),
    'klassens plassering og lagrede kart er flyttet fra kopien til originalen' +
      (etter.rom === 'B312' && etter.sammePlasser && etter.kart === 'B312' ? '' : ': ' + JSON.stringify(etter)),
  );
  sjekk(etter.tattVarePaa, 'plasseringen klassen hadde i originalen fra før, er tatt vare på som et lagret kart');

  // uten konto slettes like kopier når siden åpnes; med konto venter den som
  // laget rommet til kollegene har rukket å åpne siden
  await s.evaluate(() => lager.skriv(LOKAL, D));
  await s.reload();
  await s.waitForSelector('#oversikt:not([hidden])');
  const lokalt = await s.evaluate(() => Object.keys(D.rom).sort().join(','));
  sjekk(
    lokalt === 'Annet (kopi),B312,B312 – hestesko,Standardrom',
    'uten konto er de like kopiene slettet neste gang siden åpnes' + (lokalt.includes('B312 (kopi)') ? ': ' + lokalt : ''),
  );
  const medKonto = await s.evaluate(() => {
    const prov = (naa, eier) => {
      D.rom['B312 (kopi)'] = { rader: kopi(D.rom.B312.rader), sperret: ['4-0-0'], _id: 'x', _eier: eier };
      sky.klar = true;
      sky.id = 'meg';
      slettEgneLikeKopier(Date.parse(naa));
      sky.klar = false;
      const finnes = Object.hasOwn(D.rom, 'B312 (kopi)');
      delete D.rom['B312 (kopi)'];
      return finnes;
    };
    return [prov('2026-12-09', 'meg'), prov('2026-12-11', 'meg'), prov('2026-12-11', 'kollega')];
  });
  sjekk(
    medKonto.join() === 'true,false,true',
    'med konto slettes kopien først etter 10. desember, og bare av den som laget den' +
      (medKonto.join() === 'true,false,true' ? '' : ': ' + medKonto.join()),
  );
}

/* ---- 5. Mobil ---- */
async function sjekkMobil(nettleser, url, feil) {
  console.log('Mobil (iPhone 13)');
  const s = await nySide(nettleser, url, devices['iPhone 13'], feil);
  await klasseMedElever(s, 'tap');
  await s.screenshot({ path: path.join(BILDER, 'mobil-klasse.png') });
  sjekk(await ingenSideScroll(s), 'klassevisningen: ingen sidelengs scroll');
  sjekk((await s.$eval('#kart', (k) => k.getBoundingClientRect().top)) < 300, 'kartet starter i øvre halvdel av skjermen');
  await ingenDelteNavn(s, 'ingen navn delt midt i ordet');
  await s.waitForFunction(() => document.getElementById('skystatus').textContent.includes('Lagret'));
  sjekk(
    await s.evaluate(() => {
      const st = document.getElementById('skystatus').getBoundingClientRect();
      const konto = document.getElementById('kontoKnapp').getBoundingClientRect();
      const tilbake = document.getElementById('tilKlasser').getBoundingClientRect();
      return st.width > 0 && st.right <= konto.left && st.left >= tilbake.right;
    }),
    'lagrestatusen får plass i toppen uten å overlappe',
  );

  const sma = await s.$$eval('input:not([type=checkbox]):not([type=file]), select, textarea', (x) =>
    x.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id));
  sjekk(sma.length === 0, 'skjemafelt har minst 16 px skrift, så iPhone ikke zoomer' + (sma.length ? ': ' + sma : ''));
  const minst = await s.$$eval('.elevrad button', (x) => Math.min(...x.map((b) => Math.min(b.offsetWidth, b.offsetHeight))));
  sjekk(minst >= 34, 'knappene i elevlisten er store nok å treffe (' + minst + ' px)');

  // bytte elever med to trykk
  const pult = (k) => `#kart .plass[data-k="${k}"]`;
  const [k0, k1] = await s.$$eval('#kart .plass:not(.tom)', (x) => x.slice(0, 2).map((p) => p.dataset.k));
  const tomK = await s.$eval('#kart .plass.tom', (p) => p.dataset.k);
  const navn = (k) => s.evaluate((k) => (klasse().elever.find((e) => e.id === D.aktiv.plasser[k]) || {}).navn || '', k);
  const [n0, n1] = [await navn(k0), await navn(k1)];
  await s.tap(pult(k0));
  sjekk(
    (await s.$$('#kart .plass.valgt')).length === 1 && (await s.textContent('#beskjed')).includes(n0 + ' er valgt'),
    'første trykk på en elev velger eleven',
  );
  await s.tap(pult(k1));
  sjekk((await navn(k0)) === n1 && (await navn(k1)) === n0, 'neste trykk på en annen elev bytter plass');
  sjekk(!(await s.$('#kart .plass.valgt')), 'etter byttet er ingen pult valgt');
  await s.tap('#angre');
  sjekk((await navn(k0)) === n0 && (await navn(k1)) === n1, 'Angre bytter tilbake');
  await s.tap(pult(k0));
  await s.tap(pult(tomK));
  sjekk((await navn(tomK)) === n0 && (await navn(k0)) === '', 'trykk på en tom pult flytter eleven dit');
  await s.tap('#angre');
  await s.tap(pult(k0));
  await s.tap(pult(k0));
  sjekk(await s.isVisible('.popup'), 'nytt trykk på samme elev åpner pultpanelet');
  await s.evaluate(() => document.body.click());
  await s.tap(pult(k0));
  await s.tap('#tittel');
  sjekk(!(await s.$('#kart .plass.valgt')) && (await navn(k0)) === n0, 'trykk utenfor kartet avbryter byttet');

  await s.tap('#merKnapp');
  sjekk((await s.$$('.popup .menyvalg')).length === 4, 'Mer-menyen har fire valg');
  await s.screenshot({ path: path.join(BILDER, 'mobil-mer.png') });
  await s.tap('.popup .menyvalg >> text=Sett fra tavla');
  sjekk(await s.$eval('#kart', (k) => k.classList.contains('speilet')), 'Sett fra tavla virker fra Mer-menyen');
  await s.tap('#merKnapp');
  await s.tap('.popup .menyvalg >> text=✓ Sett fra tavla');

  await s.tap('#endreRom');
  await s.tap('#sporsmalOk'); // lag kopi av standardrommet
  await s.tap('#sporsmalOk'); // med foreslått navn
  await s.waitForTimeout(200);
  await s.screenshot({ path: path.join(BILDER, 'mobil-romredigering.png') });
  sjekk(await ingenSideScroll(s), 'romredigering: ingen sidelengs scroll');
  sjekk(await s.$eval('#romFerdig', (b) => b.getBoundingClientRect().right <= innerWidth), 'Ferdig-knappen er innenfor skjermen');
  await s.tap('#romFerdig');
  await s.tap('#trekk'); // nytt rom har tomme plasser

  await s.tap('#merKnapp');
  await s.tap('.popup .menyvalg >> text=Vis for klassen');
  await s.waitForTimeout(300);
  await s.screenshot({ path: path.join(BILDER, 'mobil-visning.png') });
  await ingenDelteNavn(s, 'visning for klassen: ingen navn delt');
  sjekk(
    await s.evaluate(() => document.getElementById('lukkVisning').getBoundingClientRect().top > document.querySelector('.romtopp h1').getBoundingClientRect().bottom),
    'Lukk-knappen ligger ikke over tittelen',
  );
  sjekk(!(await s.isVisible('.tastatur')), '«(Esc)» vises ikke på berøringsskjerm');
  await s.tap('#lukkVisning');
  await s.tap('#merKnapp');
  await s.tap('.popup .menyvalg >> text=Lagre kartet …');
  await s.tap('#sporsmalOk');
  await s.tap('#tidligere');
  sjekk(
    await s.evaluate(() => {
      const r = document.getElementById('lagrede').getBoundingClientRect();
      return Math.abs(r.bottom - innerHeight) < 2 && r.width === innerWidth;
    }),
    'Lagrede kart åpnes som et ark nedenfra',
  );
  await s.screenshot({ path: path.join(BILDER, 'mobil-lagrede-kart.png') });
  await s.tap('#lagredeLukk');
  await s.tap('#tilKlasser');
  sjekk(await ingenSideScroll(s), 'klasseoversikten: ingen sidelengs scroll');
  // Merk: helsidebilder (fullPage) nullstiller berøringsemuleringen i
  // Chromium, så de tas ikke midt i testene over.
}

/* ---- 4. Konto og «Forbli innlogget» ----
   Supabase byttes ut med tester/falsk-supabase.js, som lagrer i
   nettleseren. Da kan hele kontoflyten testes uten nett, med ekte
   kryptering. */
async function sideMedFalskSky(nettleser, url, feil) {
  const ctx = await nettleser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.route('https://cdn.jsdelivr.net/**', (r) =>
    r.fulfill({
      path: path.join(__dirname, 'falsk-supabase.js'),
      contentType: 'text/javascript',
      headers: { 'Access-Control-Allow-Origin': '*' },
    }),
  );
  // integritetssjekken (SRI) ville stoppet det falske skriptet
  await ctx.route('**/index.html', async (r) => {
    const svar = await r.fetch();
    const html = (await svar.text()).replace(/\s*integrity="[^"]*"/, '');
    r.fulfill({ response: svar, body: html });
  });
  const s = await ctx.newPage();
  s.on('pageerror', (e) => feil.push(e.message));
  s.on('console', (m) => cspBrudd(m, feil));
  await s.goto(url);
  return s;
}
/* Venter til appen enten viser klassene eller ber om passord, og ikke er
   midt i en innlogging (da står innloggingsskjemaet fortsatt synlig). */
async function hvorErVi(s) {
  await s.waitForFunction(() => {
    const synlig = (id) => document.getElementById(id).checkVisibility();
    const holder = document.getElementById('innKnapp').disabled;
    return synlig('oversikt') || (synlig('stegInn') && !holder);
  });
  await s.waitForTimeout(300); // en automatisk opplåsing kan fortsatt pågå
  return (await s.isVisible('#oversikt')) ? 'klassene' : 'innlogging';
}
async function sjekkInnlogging(nettleser, url, feil) {
  console.log('Konto og «Forbli innlogget»');
  const EPOST = 'larer@osloskolen.no',
    PASSORD = 'et langt testpassord';
  const s = await sideMedFalskSky(nettleser, url, feil);
  sjekk((await hvorErVi(s)) === 'innlogging', 'ny besøkende får innloggingssiden');

  // ny konto, med «Forbli innlogget»
  await s.click('#innBytt');
  await s.fill('#innEpost', EPOST);
  await s.fill('#innPassord', PASSORD);
  await s.fill('#innGjenta', PASSORD);
  await s.check('#innHusk');
  await s.click('#innKnapp');
  await s.waitForSelector('#stegKode:not([hidden])');
  await s.check('#kodeOk');
  await s.click('#kodeFortsett');
  await s.waitForSelector('#stegSkole:not([hidden])');
  await s.fill('#skoleNavn', 'Testskolen');
  await s.click('#skoleKnapp');
  sjekk((await hvorErVi(s)) === 'klassene', 'ny konto er opprettet og logget inn');

  await s.click('.klassekort:not(.ny) >> nth=0');
  await s.click('#importmodus');
  await s.fill('#importtekst', ELEVER);
  await s.click('#importLegg');
  await s.click('#trekk');
  await s.evaluate(() => tomSynk());

  for (const gang of ['første', 'andre', 'tredje']) {
    await s.reload();
    sjekk((await hvorErVi(s)) === 'klassene', `${gang} gang siden lastes på nytt: rett inn uten passord`);
  }
  sjekk(
    (await s.textContent('#klassegrid')).includes('26 elever'),
    'klassen med 26 elever er lagret kryptert og hentet igjen',
  );
  sjekk(
    await s.evaluate(() => Object.values(D.klasser).some((k) => k.romkart && k.romkart.Standardrom)),
    'plasseringen per rom (romkart) er også med i skyen',
  );
  await s.click('.klassekort:not(.ny) >> nth=0');
  await s.click('#trekk');
  await s.waitForFunction(() => document.getElementById('skystatus').textContent.includes('Lagret kl.'));
  sjekk(true, 'med konto viser toppen «✓ Lagret kl. …» etter lagring');

  /* Rommene deles med skolen. Gir en kollega et rom nytt navn, skal
     klassens plassering og lagrede kart følge med rommet. */
  const ulagretEtter = await s.evaluate(async () => {
    D.rom['218'] = { rader: Array.from({ length: 5 }, () => [2, 3, 2]), sperret: [] };
    byttRom('218');
    trekkPlassering();
    lagreKart('Uke 1', true);
    await tomSynk();
    return ulagret;
  });
  sjekk(ulagretEtter === false, 'et nytt rom og klassen som bruker det, lagres i samme omgang');
  await s.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('falsk-supabase:db'));
    d.tabeller.rom.find((r) => r.navn === '218').navn = 'Rom 218';
    localStorage.setItem('falsk-supabase:db', JSON.stringify(d));
  });
  await s.reload();
  await hvorErVi(s);
  await s.click('.klassekort:not(.ny) >> nth=0');
  const etterNavn = await s.evaluate(() => ({
    rom: D.aktiv.rom,
    plassert: Object.keys(D.aktiv.plasser).length,
    romkart: Object.keys(klasse().romkart || {}).sort().join(','),
    kart: Object.values(D.kart).map((x) => x.navn + ' i ' + x.rom).join(','),
  }));
  sjekk(
    etterNavn.rom === 'Rom 218' && etterNavn.plassert === 26,
    'klassen åpner i rommet med det nye navnet, med alle 26 på plass' +
      (etterNavn.rom === 'Rom 218' && etterNavn.plassert === 26 ? '' : ': ' + JSON.stringify(etterNavn)),
  );
  sjekk(
    etterNavn.romkart === 'Rom 218,Standardrom' && etterNavn.kart === 'Uke 1 i Rom 218',
    'plasseringen per rom og det lagrede kartet har fulgt rommet' +
      (etterNavn.romkart === 'Rom 218,Standardrom' && etterNavn.kart === 'Uke 1 i Rom 218'
        ? ''
        : ': ' + JSON.stringify(etterNavn)),
  );
  await s.click('#tidligere');
  sjekk(
    !(await s.textContent('#lagredeListe')).includes('(slettet)'),
    'det lagrede kartet står ikke som «(slettet)»',
  );
  await s.click('#lagredeLukk');
  // klassen skrives én gang med de nye navnene, ikke ved hver innlasting
  const versjoner = () =>
    s.evaluate(async () => {
      await tomSynk();
      const d = JSON.parse(localStorage.getItem('falsk-supabase:db'));
      return d.tabeller.klasser.map((k) => k.versjon).join(',');
    });
  const v1 = await versjoner();
  await s.reload();
  await hvorErVi(s);
  const v2 = await versjoner();
  sjekk(v1 === v2, 'klassene skrives ikke på nytt når ingenting er endret' + (v1 === v2 ? '' : `: ${v1} → ${v2}`));
  await s.click('.klassekort:not(.ny) >> nth=0');
  await s.click('#tilKlasser');

  // logg ut: da skal nøkkelen være glemt
  await s.click('#kontoKnapp');
  await Promise.all([s.waitForNavigation(), s.click('.popup .menyvalg >> text=Logg ut')]);
  sjekk((await hvorErVi(s)) === 'innlogging', 'etter utlogging må man logge inn igjen');

  // uten «Forbli innlogget»: passord ved neste besøk, men klassene er der
  await s.fill('#innEpost', EPOST);
  await s.fill('#innPassord', PASSORD);
  sjekk(!(await s.isChecked('#innHusk')), '«Forbli innlogget» er ikke huket av fra før');
  await s.click('#innKnapp');
  sjekk((await hvorErVi(s)) === 'klassene', 'innlogging uten «Forbli innlogget» virker');
  await s.reload();
  sjekk((await hvorErVi(s)) === 'innlogging', 'uten «Forbli innlogget» spørres det om passord neste gang');

  /* Glemt passord uten gjenopprettingskode («start på nytt»): klassene bare
     læreren var med i, slettes, og delte klasser forlates. Før ble de
     liggende i databasen uten at noen kunne åpne eller slette dem. */
  const DB = 'falsk-supabase:db';
  await s.evaluate((navn) => {
    const d = JSON.parse(localStorage.getItem(navn));
    const meg = d.brukere['larer@osloskolen.no'].id;
    d.tabeller.klasser.push({ id: 'delt', data: 'x', versjon: 1, opprettet_av: meg });
    d.tabeller.klassemedlemmer.push(
      { klasse_id: 'delt', bruker_id: meg, nokkel: 'n' },
      { klasse_id: 'delt', bruker_id: 'kollega', nokkel: 'n' },
    );
    localStorage.setItem(navn, JSON.stringify(d));
  }, DB);
  const foer = await s.evaluate((navn) => JSON.parse(localStorage.getItem(navn)).tabeller.klasser.length, DB);
  const kode = await s.evaluate(() => passordEtterGlemt('', true, 'et helt nytt passord'));
  const etter = await s.evaluate((navn) => {
    const t = JSON.parse(localStorage.getItem(navn)).tabeller;
    return {
      klasser: t.klasser.map((k) => k.id).join(','),
      medlemmer: t.klassemedlemmer.map((m) => m.klasse_id + ':' + m.bruker_id).join(','),
    };
  }, DB);
  sjekk(/^[A-Z0-9]{4}(-[A-Z0-9]{4})+$/.test(kode || ''), '«start på nytt» uten kode gir en ny gjenopprettingskode');
  sjekk(
    foer >= 2 && etter.klasser === 'delt' && etter.medlemmer === 'delt:kollega',
    '«start på nytt» sletter egne klasser og forlater delte' +
      (etter.klasser === 'delt' && etter.medlemmer === 'delt:kollega' ? '' : ': ' + JSON.stringify({ foer, ...etter })),
  );
}

(async () => {
  fs.mkdirSync(BILDER, { recursive: true });
  sjekkLasterekkefolge();
  sjekkCsp();
  const tjener = await startTjener();
  const url = `http://localhost:${tjener.address().port}/index.html`;
  const nettleser = await chromium.launch();
  const feil = [];
  try {
    await sjekkDialoger(nettleser, url, feil);
    await sjekkLagring(nettleser, url, feil);
    await sjekkLagredeKart(nettleser, url, feil);
    await sjekkSikkerhet(nettleser, url, feil);
    await sjekkTilgjengelighet(nettleser, url, feil);
    await sjekkLogikk(nettleser, url, feil);
    await sjekkRomkopier(nettleser, url, feil);
    await sjekkMobil(nettleser, url, feil);
    await sjekkInnlogging(nettleser, url, feil);
  } catch (err) {
    sjekk(false, 'testen stoppet: ' + err.message.split('\n')[0]);
  }
  console.log('Generelt');
  sjekk(feil.length === 0, 'ingen JavaScript-feil' + (feil.length ? ': ' + feil.join(' | ') : ''));
  await nettleser.close();
  tjener.close();
  console.log(feilet ? `\n${feilet} sjekk(er) feilet.` : '\nAlt i orden.');
  process.exit(feilet ? 1 : 0);
})();
