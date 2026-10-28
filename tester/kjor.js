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
  await s.waitForTimeout(4600);
  sjekk(
    !(await statusSynlig()) && (await s.evaluate(() => getComputedStyle(document.getElementById('skystatus')).opacity)) === '0',
    '«✓ Lagret» har tonet ut etter fire sekunder',
  );
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
    await sjekkLagring(nettleser, url, feil);
    await sjekkLagredeKart(nettleser, url, feil);
    await sjekkSikkerhet(nettleser, url, feil);
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
