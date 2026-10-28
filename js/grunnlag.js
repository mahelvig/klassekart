/* Lagring, små hjelpere, datamodellen og setene i rommet. */
'use strict';

/* ============ lagring ============ */
const LOKAL = 'klassekart:lokal';
// eldre versjoner hadde én lagringsplass per «bruker» på maskinen
const PROFILER = 'klassekart:profiler';
const SIST = 'klassekart:sist';
const GAMMEL = 'klassekart:v3';
const brukernokkel = (n) =>
  'klassekart:v3:' + String(n).toLowerCase().replace(/\s+/g, '_');

const lager = {
  async hent(n) {
    try {
      if (window.storage && window.storage.get) {
        const r = await window.storage.get(n, false);
        return r ? JSON.parse(r.value) : null;
      }
      return JSON.parse(localStorage.getItem(n) || 'null');
    } catch (e) {
      return null;
    }
  },
  async skriv(n, v) {
    try {
      const s = JSON.stringify(v);
      if (window.storage && window.storage.set)
        await window.storage.set(n, s, false);
      else localStorage.setItem(n, s);
      return true;
    } catch (e) {
      return false;
    }
  },
};

/* ============ hjelpere ============ */
const $ = (id) => document.getElementById(id);
const nokkel = (r, g, i) => r + '-' + g + '-' + i;
const parN = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const uid = () => 'e' + Math.random().toString(36).slice(2, 9);
const kopi = (o) => JSON.parse(JSON.stringify(o));
function stokk(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/* ============ data ============ */
const START_NAVN = [];
function nyElev(navn, kjonn, gruppe) {
  return {
    id: uid(),
    navn,
    kjonn: kjonn || null,
    gruppe: gruppe || null,
    sone: 'fri',
    sammen: [],
    unna: [],
  };
}
/* Standardrommet er fast og kan ikke endres, omdøpes eller slettes */
const STANDARDROM = 'Standardrom';
const standardromOppsett = () => ({
  rader: [
    [2, 3, 2],
    [2, 3, 2],
    [2, 3, 2],
    [2, 3, 2],
    [2, 3, 2],
  ],
  sperret: [],
});
function standarddata(medStartelever) {
  const bruk = medStartelever !== false && OPPSETT.brukStartelever;
  const kn = (bruk && OPPSETT.startklasse) || 'Ny klasse';
  const elever = bruk ? START_NAVN.map((n) => nyElev(n[0], n[1])) : [];
  return {
    versjon: 3,
    klasser: { [kn]: { elever, historikk: [] } },
    rom: {
      [STANDARDROM]: standardromOppsett(),
    },
    kart: {},
    aktiv: {
      klasse: kn,
      rom: 'Standardrom',
      plasser: {},
      laaste: [],
      spre: false,
      spreKlasse: false,
      nyeNaboer: true,
      speil: false,
      farger: {},
    },
  };
}
let D = standarddata();
let angrestabel = [];

const klasse = () =>
  D.klasser[D.aktiv.klasse] || { elever: [], historikk: [] };
const rommet = () =>
  D.rom[D.aktiv.rom] || { rader: [[2, 3, 2]], sperret: [] };
const elever = () => klasse().elever;
const elevMed = (id) => elever().find((e) => e.id === id) || null;
const erSperret = (k) => rommet().sperret.includes(k);
const erLaast = (k) => D.aktiv.laaste.includes(k);

/* Hver klasse husker sitt pågående kart i hvert rom (romkart), og hvilket
   rom den sist var i (sist). Da sletter ikke et rombytte noe. Eldre data
   har bare sist, som da gjelder for rommet som står der. */
function huskOppsett() {
  const k = D.klasser[D.aktiv.klasse];
  if (!k) return;
  const a = D.aktiv;
  k.sist = {
    rom: a.rom,
    plasser: kopi(a.plasser),
    laaste: a.laaste.slice(),
    farger: kopi(a.farger),
    trukket: a.trukket || null,
  };
  k.romkart = k.romkart || {};
  if (Object.keys(a.plasser).length || Object.keys(a.farger).length)
    k.romkart[a.rom] = {
      plasser: kopi(a.plasser),
      laaste: a.laaste.slice(),
      farger: kopi(a.farger),
      trukket: a.trukket || null,
    };
  else delete k.romkart[a.rom];
}
// legger klassens kart for rommet i D.aktiv (tomt hvis det ikke finnes)
function hentRomkart() {
  const k = klasse();
  const s =
    (k.romkart || {})[D.aktiv.rom] ||
    (k.sist && k.sist.rom === D.aktiv.rom ? k.sist : {});
  const ids = new Set(k.elever.map((e) => e.id));
  D.aktiv.plasser = {};
  Object.entries(s.plasser || {}).forEach(([p, id]) => {
    if (ids.has(id)) D.aktiv.plasser[p] = id;
  });
  D.aktiv.laaste = (s.laaste || []).slice();
  D.aktiv.farger = kopi(s.farger || {});
  // avtrykket av siste trekning: er kartet urørt siden, trengs ingen kopi
  D.aktiv.trukket = s.trukket || null;
}
function gjenopprett(n) {
  const s = D.klasser[n].sist || {};
  D.aktiv.klasse = n;
  if (D.rom[s.rom]) D.aktiv.rom = s.rom;
  hentRomkart();
}
function apneKlasse(n, merkBrukt) {
  huskOppsett();
  gjenopprett(n);
  if (merkBrukt !== false) D.klasser[n].brukt = new Date().toISOString();
  angrestabel = [];
  $('angre').disabled = true;
  apenElev = null;
}

let lagretimer = null,
  endringsteller = 0;
function lagre() {
  huskOppsett();
  endringsteller++;
  if (iSky()) return planleggSynk();
  clearTimeout(lagretimer);
  lagretimer = setTimeout(async () => {
    if (await lager.skriv(LOKAL, D)) visLagret();
    else visSkystatus('Ikke lagret – nettleseren stoppet det', true);
  }, 350);
}
/* Viser i toppen at alt lagres av seg selv, og når det sist skjedde.
   Beskjeden toner ut etter noen sekunder og kommer igjen ved neste
   lagring. «Lagrer …» og feil (visSkystatus) blir stående. */
const LAGRET_SYNLIG = 4000;
let lagretTimer = null;
function visLagret(tid) {
  const s = $('skystatus');
  // før første lagring (hvile) er det ikke plass til teksten på mobil
  s.className = 'skystatus' + (tid === false ? ' hvile' : '');
  s.textContent = '✓ ' + (tid === false ? 'Lagres automatisk' : 'Lagret');
  if (tid !== false) {
    const t = document.createElement('span');
    t.className = 'tid';
    t.textContent =
      ' kl. ' +
      new Date().toLocaleTimeString('no-NO', {
        hour: '2-digit',
        minute: '2-digit',
      });
    s.appendChild(t);
  }
  s.title = iSky()
    ? 'Alt lagres automatisk og kryptert i kontoen din.'
    : 'Alt lagres automatisk i denne nettleseren.';
  clearTimeout(lagretTimer);
  lagretTimer = setTimeout(() => s.classList.add('borte'), LAGRET_SYNLIG);
}

/* ============ seter ============ */
function seter() {
  const ut = [];
  rommet().rader.forEach((rad, r) =>
    rad.forEach((n, g) => {
      for (let i = 0; i < n; i++)
        ut.push({ k: nokkel(r, g, i), r, g, i });
    }),
  );
  return ut;
}
function naboPar() {
  const finnes = new Set(seter().map((s) => s.k));
  const par = [];
  seter().forEach((s) => {
    const h = nokkel(s.r, s.g, s.i + 1);
    if (finnes.has(h)) par.push([s.k, h]);
  });
  return par;
}
function ryddPlasser() {
  const gyldige = new Set(seter().map((s) => s.k));
  Object.keys(D.aktiv.plasser).forEach((k) => {
    if (!gyldige.has(k)) delete D.aktiv.plasser[k];
  });
  D.aktiv.laaste = D.aktiv.laaste.filter(
    (k) => gyldige.has(k) && !erSperret(k),
  );
  rommet().sperret.forEach((k) => delete D.aktiv.plasser[k]);
  Object.keys(D.aktiv.farger).forEach((k) => {
    if (!gyldige.has(k) || erSperret(k)) delete D.aktiv.farger[k];
  });
  const idSett = new Set(elever().map((e) => e.id));
  Object.keys(D.aktiv.plasser).forEach((k) => {
    if (!idSett.has(D.aktiv.plasser[k])) delete D.aktiv.plasser[k];
  });
}
