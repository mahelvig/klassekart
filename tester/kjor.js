/* Tester Klassekart i en ekte nettleser (Chromium via Playwright).

   Kjør fra repo-roten:  npm install  og så  npm test
   Skjermbilder havner i tester/skjermbilder/. Innlogging med konto testes
   ikke, siden det krever kontakt med Supabase. */
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

async function nySide(nettleser, url, oppsett, feil) {
  const ctx = await nettleser.newContext(oppsett);
  // Supabase-skriptet fra CDN trengs ikke for å teste uten konto
  await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
  const side = await ctx.newPage();
  side.on('pageerror', (e) => feil.push(e.message));
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
const delteNavn = (s) =>
  s.$$eval('#kart .plass .navn', (x) =>
    x
      .filter((n) => n.offsetHeight > parseFloat(getComputedStyle(n).lineHeight) * 1.5)
      .map((n) => n.textContent),
  );
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

/* ---- 3. Mobil ---- */
async function sjekkMobil(nettleser, url, feil) {
  console.log('Mobil (iPhone 13)');
  const s = await nySide(nettleser, url, devices['iPhone 13'], feil);
  await klasseMedElever(s, 'tap');
  await s.screenshot({ path: path.join(BILDER, 'mobil-klasse.png') });
  sjekk(await ingenSideScroll(s), 'klassevisningen: ingen sidelengs scroll');
  sjekk((await s.$eval('#kart', (k) => k.getBoundingClientRect().top)) < 300, 'kartet starter i øvre halvdel av skjermen');
  sjekk((await delteNavn(s)).length === 0, 'ingen navn delt midt i ordet');

  const sma = await s.$$eval('input:not([type=checkbox]):not([type=file]), select, textarea', (x) =>
    x.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id));
  sjekk(sma.length === 0, 'skjemafelt har minst 16 px skrift, så iPhone ikke zoomer' + (sma.length ? ': ' + sma : ''));
  const minst = await s.$$eval('.elevrad button', (x) => Math.min(...x.map((b) => Math.min(b.offsetWidth, b.offsetHeight))));
  sjekk(minst >= 34, 'knappene i elevlisten er store nok å treffe (' + minst + ' px)');

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
  sjekk((await delteNavn(s)).length === 0, 'visning for klassen: ingen navn delt');
  sjekk(
    await s.evaluate(() => document.getElementById('lukkVisning').getBoundingClientRect().top > document.querySelector('.romtopp h1').getBoundingClientRect().bottom),
    'Lukk-knappen ligger ikke over tittelen',
  );
  sjekk(!(await s.isVisible('.tastatur')), '«(Esc)» vises ikke på berøringsskjerm');
  await s.tap('#lukkVisning');
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
}

(async () => {
  fs.mkdirSync(BILDER, { recursive: true });
  sjekkLasterekkefolge();
  const tjener = await startTjener();
  const url = `http://localhost:${tjener.address().port}/index.html`;
  const nettleser = await chromium.launch();
  const feil = [];
  try {
    await sjekkDialoger(nettleser, url, feil);
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
