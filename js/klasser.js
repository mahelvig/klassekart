/* Klasseoversikten, rom, import og sikkerhetskopier. */
'use strict';

/* ============ klasseoversikt ============ */
function visOversikt() {
  lukkPanel();
  if (romModus) settRomModus(false);
  if (malerModus) settMalerModus(false);
  document.querySelector('.app').hidden = true;
  $('oversikt').hidden = false;
  $('topp').hidden = false;
  $('tilKlasser').hidden = true;
  oppdaterKontoUi();
  $('klassesok').value = '';
  tegnOversikt();
  lagre();
  if (iSky()) oppdaterFraSky();
}
function visKart() {
  $('oversikt').hidden = true;
  document.querySelector('.app').hidden = false;
  $('topp').hidden = false;
  $('tilKlasser').hidden = false;
  window.scrollTo(0, 0);
  tegn();
}
function naar(iso) {
  if (!iso) return '';
  const d = new Date(iso),
    i = new Date();
  const dager = Math.round(
    (new Date(i.toDateString()) - new Date(d.toDateString())) / 864e5,
  );
  if (dager === 0) return 'i dag';
  if (dager === 1) return 'i går';
  return d.toLocaleDateString('no-NO', {
    day: 'numeric',
    month: 'short',
    year: dager > 300 ? 'numeric' : undefined,
  });
}
function miniKart(romnavn, plasser, ids, farger) {
  const m = document.createElement('div');
  m.className = 'mini';
  const R = D.rom[romnavn];
  if (!R) return m;
  const t = document.createElement('div');
  t.className = 'mini-tavle';
  m.appendChild(t);
  R.rader.forEach((rad, r) => {
    const radEl = document.createElement('div');
    radEl.className = 'mini-rad';
    rad.forEach((ant, g) => {
      const gr = document.createElement('div');
      gr.className = 'mini-gruppe';
      for (let i = 0; i < ant; i++) {
        const k = nokkel(r, g, i);
        const p = document.createElement('span');
        p.className =
          'mini-plass' +
          (R.sperret.includes(k)
            ? ' sperret'
            : ids.has(plasser[k])
              ? ' full'
              : '');
        const f = (farger || {})[k];
        if (f !== undefined && !R.sperret.includes(k))
          p.style.cssText =
            'background:' +
            FARGER[f].hex +
            ';border-color:' +
            FARGER[f].hex +
            (ids.has(plasser[k]) ? '' : ';opacity:.35');
        gr.appendChild(p);
      }
      radEl.appendChild(gr);
    });
    m.appendChild(radEl);
  });
  return m;
}
function tegnOversikt() {
  const alle = Object.keys(D.klasser);
  const sok = $('klassesok').value.trim().toLowerCase();
  $('klassesok').hidden = alle.length < 6;
  $('oversiktinfo').textContent =
    alle.length + (alle.length === 1 ? ' klasse' : ' klasser');
  const navn = alle
    .filter((n) => n.toLowerCase().includes(sok))
    .sort(
      (a, b) =>
        (D.klasser[b].brukt || '').localeCompare(
          D.klasser[a].brukt || '',
        ) || a.localeCompare(b, 'no'),
    );

  const grid = $('klassegrid');
  grid.innerHTML = '';
  navn.forEach((n) => {
    const k = D.klasser[n];
    const s = k.sist || {};
    const ids = new Set(k.elever.map((e) => e.id));
    const romnavn = D.rom[s.rom] ? s.rom : D.aktiv.rom;
    const antKart = Object.values(D.kart).filter(
      (x) => x.klasse === n,
    ).length;

    const kort = document.createElement('div');
    kort.className =
      'klassekort' + (n === D.aktiv.klasse ? ' aktiv' : '');
    const apne = document.createElement('button');
    apne.type = 'button';
    apne.className = 'kort-apne';
    const tittel = document.createElement('span');
    tittel.className = 'kort-navn';
    tittel.textContent = n;
    const info = document.createElement('span');
    info.className = 'kort-info';
    const brukt = naar(k.brukt);
    const delt = (iSky() && sky.medlemmer[k._id]) || [];
    info.innerHTML =
      esc(
        k.elever.length +
          (k.elever.length === 1 ? ' elev' : ' elever') +
          ' i ' +
          romnavn,
      ) +
      '<br>' +
      esc(
        (antKart
          ? antKart + (antKart === 1 ? ' lagret kart' : ' lagrede kart')
          : 'Ingen lagrede kart') + (brukt ? ', åpnet ' + brukt : ''),
      ) +
      (delt.length
        ? '<br>' +
          esc(
            'Delt med ' + delt.map((m) => kortEpost(m.epost)).join(', '),
          )
        : '');
    apne.appendChild(tittel);
    apne.appendChild(miniKart(romnavn, s.plasser || {}, ids, s.farger));
    apne.appendChild(info);
    apne.addEventListener('click', () => {
      apneKlasse(n);
      visKart();
    });

    const handl = document.createElement('div');
    handl.className = 'kort-handlinger';
    const bNavn = document.createElement('button');
    bNavn.type = 'button';
    bNavn.textContent = 'Gi nytt navn';
    bNavn.addEventListener('click', () => omdoepKlasse(n));
    const bSlett = document.createElement('button');
    bSlett.type = 'button';
    bSlett.className = 'fare';
    bSlett.textContent = 'Slett';
    bSlett.addEventListener('click', () => slettKlasse(n));
    handl.appendChild(bNavn);
    if (iSky()) {
      const bDel = document.createElement('button');
      bDel.type = 'button';
      bDel.textContent = delt.length ? 'Delt ▾' : 'Del';
      bDel.id = 'del-' + k._id;
      bDel.addEventListener('click', (e) => {
        e.stopPropagation();
        delMeny(bDel, n);
      });
      handl.appendChild(bDel);
      if (delt.length) bSlett.textContent = 'Forlat';
    }
    handl.appendChild(bSlett);

    kort.appendChild(apne);
    kort.appendChild(handl);
    grid.appendChild(kort);
  });

  const ny = document.createElement('button');
  ny.type = 'button';
  ny.className = 'klassekort ny';
  ny.textContent = '+ Ny klasse';
  ny.addEventListener('click', lagNyKlasse);
  grid.appendChild(ny);
}
$('klassesok').addEventListener('input', tegnOversikt);

/* Grenser for hvor mye som kan ligge i en konto. Må stemme med
   klassekart-supabase.sql (klasser). Elevtallet kontrolleres bare her,
   siden databasen ikke kan lese kryptert innhold. */
const MAKS_KLASSER = 30,
  MAKS_ELEVER = 60,
  MAKS_ROM = 100, // per skole: rommene deles med alle kolleger
  MAKS_PULTER = 100,
  KONTAKT_EPOST = 'hvemsitterhvor@gmail.com';
const antallKlasser = () =>
  Object.keys(D.klasser).filter(
    (n) => n !== 'Ny klasse' || D.klasser[n].elever.length,
  ).length;
function grenseKlasser() {
  melding(
    'Du har nådd grensen på ' +
      MAKS_KLASSER +
      ' klasser. Slett en klasse du ikke bruker, eller send e-post til ' +
      KONTAKT_EPOST +
      ' hvis du trenger flere klasser.',
  );
}
function grenseElever() {
  melding(
    'En klasse kan ha opptil ' +
      MAKS_ELEVER +
      ' elever. Send e-post til ' +
      KONTAKT_EPOST +
      ' hvis du trenger flere elever i en klasse.',
  );
}
function grenseRom() {
  melding(
    'Skolen har nådd grensen på ' +
      MAKS_ROM +
      ' rom. Slett et rom dere ikke bruker, eller send e-post til ' +
      KONTAKT_EPOST +
      ' hvis dere trenger flere rom.',
  );
}
function grensePulter() {
  melding(
    'Et rom kan ha opptil ' +
      MAKS_PULTER +
      ' pulter. Send e-post til ' +
      KONTAKT_EPOST +
      ' hvis du trenger flere pulter i et rom.',
  );
}
async function lagNyKlasse() {
  const n = ((await sporOm('Navn på klassen, f.eks. 3ME')) || '').trim();
  if (!n) return;
  if (D.klasser[n]) return melding('Klassen ' + n + ' finnes fra før.');
  if (antallKlasser() >= MAKS_KLASSER) return grenseKlasser();
  // den tomme startklassen trengs ikke når du lager din første egne
  const navn = Object.keys(D.klasser);
  if (
    navn.length === 1 &&
    navn[0] === 'Ny klasse' &&
    !D.klasser[navn[0]].elever.length
  )
    delete D.klasser[navn[0]];
  D.klasser[n] = { elever: [], historikk: [] };
  apneKlasse(n);
  visKart();
  $('importmodus').click();
}
async function omdoepKlasse(n) {
  const ny = ((await sporOm('Nytt navn på klassen', n)) || '').trim();
  if (!ny || ny === n) return;
  if (D.klasser[ny]) return melding('Klassen ' + ny + ' finnes fra før.');
  D.klasser[ny] = D.klasser[n];
  delete D.klasser[n];
  Object.values(D.kart).forEach((x) => {
    if (x.klasse === n) x.klasse = ny;
  });
  if (D.aktiv.klasse === n) D.aktiv.klasse = ny;
  tegnOversikt();
  lagre();
}
async function slettKlasse(n) {
  const delt = (iSky() && sky.medlemmer[D.klasser[n]._id]) || [];
  const sporsmal = delt.length
    ? 'Forlate ' +
      n +
      '? Klassen blir værende hos ' +
      delt.map((m) => kortEpost(m.epost)).join(', ') +
      ', men du mister tilgangen.'
    : 'Slette klassen ' + n + ' med elever, regler og kart?';
  if (!(await bekreft(sporsmal, delt.length ? 'Forlat' : 'Slett', true)))
    return;
  delete D.klasser[n];
  Object.keys(D.kart).forEach((k) => {
    if (D.kart[k].klasse === n) delete D.kart[k];
  });
  if (D.aktiv.klasse === n) {
    normaliser(); // lager en tom klasse hvis dette var den siste
    apneKlasse(D.aktiv.klasse, false);
  }
  tegnOversikt();
  lagre();
}
$('leggTil').addEventListener('click', () => {
  const felt = $('nyttNavn'),
    v = felt.value.trim();
  if (!v) return;
  if (elever().length >= MAKS_ELEVER) return grenseElever();
  klasse().elever.push(nyElev(v, null, $('nyKlasse').value.trim()));
  felt.value = '';
  felt.focus();
  tegn();
});
$('nyttNavn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('leggTil').click();
});

/* ---- import av klasseliste ---- */
const SOPPEL = [
  /^#/,
  /^nr\.?$/i,
  /^klasse$/i,
  /^elev(er)?$/i,
  /^navn$/i,
  /^trinn$/i,
  /^gruppe$/i,
  /^karakteransvarlig/i,
  /^fagl(æ|ae)rer/i,
  /^oslo$/i,
  /^bilde f/i,
  /^ikke$/i,
  /^\d{1,2}\.\d{1,2}\.\d{4}/,
  /^\d+\s*\/\s*\d+$/,
  /videreg(å|aa)ende skole/i,
  /\d{4}\s*\/\s*\d{4}/,
  /^[A-ZÆØÅ]{1,3}\/[A-ZÆØÅ]{2,6}\d{3,5}$/,
];
const erSoppel = (l) => SOPPEL.some((r) => r.test(l));
const erKlassekode = (s) =>
  /^[0-9A-ZÆØÅ]{2,6}$/.test(s) && /\d/.test(s) && /[A-ZÆØÅ]/.test(s);

/* Fotolisten: «Fornavn Etternavn (3ME)», ofte brutt over flere linjer */
function fotorader(linjer) {
  const slutt = /\(([0-9A-ZÆØÅ]{2,8})\)$/;
  if (linjer.filter((l) => slutt.test(l)).length < 3) return null;
  const rader = [];
  let buffer = [];
  linjer.forEach((l) => {
    buffer.push(l);
    if (slutt.test(l)) {
      const hel = buffer.join(' ').replace(/\s+/g, ' ').trim();
      rader.push([hel.match(slutt)[1], hel.replace(slutt, '').trim()]);
      buffer = [];
    }
  });
  return rader.length >= 3 ? rader : null;
}

function tilRader(linjer) {
  const foto = fotorader(linjer);
  if (foto) return foto;

  const medTab = linjer.filter((l) => l.includes('\t'));
  if (medTab.length >= Math.max(1, linjer.length * 0.5))
    return medTab.map((l) => l.split('\t').map((s) => s.trim()));

  const nummerert = /^(\d{1,3})[.)]?\s+(.*)$/;
  const num = linjer.filter((l) => nummerert.test(l));
  if (num.length >= Math.max(1, linjer.length * 0.4))
    return num.map((l) => {
      const rest = l.match(nummerert)[2];
      const deler = rest
        .split(/\s{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
      return deler.length > 1 ? deler : [rest];
    });

  const rentTall = (l) => /^\d{1,3}$/.test(l);
  if (linjer.filter(rentTall).length >= 2) {
    const rader = [];
    let ny = null;
    linjer.forEach((l) => {
      if (rentTall(l)) {
        if (ny && ny.length) rader.push(ny);
        ny = [];
      } else if (ny) ny.push(l);
    });
    if (ny && ny.length) rader.push(ny);
    if (rader.length) return rader;
  }

  const kolonner = linjer.map((l) =>
    l
      .split(/\s{2,}/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  if (
    kolonner.filter((r) => r.length > 1).length >=
    Math.max(1, linjer.length * 0.5)
  )
    return kolonner;

  return linjer.map((l) => [l]);
}

/* Kolonner skilt med ett mellomrom: «01 3ME Kari Nordmann Ola Lærer».
   Lærernavnet er likt på alle rader og kan derfor skrelles av bakfra. */
function fellesSlutt(celler) {
  let beste = '';
  for (let k = 1; k <= 6; k++) {
    const tell = {};
    celler.forEach((c) => {
      const ord = c.split(' ');
      if (ord.length <= k + 1) return;
      const s = ord.slice(-k).join(' ');
      tell[s] = (tell[s] || 0) + 1;
    });
    let topp = '',
      ant = 0;
    Object.keys(tell).forEach((s) => {
      if (tell[s] > ant) {
        ant = tell[s];
        topp = s;
      }
    });
    if (ant >= Math.max(3, celler.length * 0.6) && !/\d/.test(topp))
      beste = topp;
    else break;
  }
  return beste;
}
function skillEnkeltceller(rader) {
  const enkle = rader.filter((r) => r.length === 1).map((r) => r[0]);
  if (enkle.length < rader.length * 0.6) return rader;
  const slutt = fellesSlutt(enkle);
  return rader.map((r) => {
    if (r.length !== 1) return r;
    let s = r[0];
    if (slutt && s.length > slutt.length + 1 && s.endsWith(' ' + slutt))
      s = s.slice(0, -(slutt.length + 1)).trim();
    const m = s.match(/^(\S+)\s+(.+)$/);
    if (m && erKlassekode(m[1])) return [m[1], m[2]];
    return [s];
  });
}

function velgKolonne(rader, navnekolonne) {
  const bredde = Math.max.apply(
    null,
    rader.map((r) => r.length),
  );
  let beste = 0,
    bestePoeng = -1;
  for (let c = 0; c < bredde; c++) {
    if (c === navnekolonne) continue;
    const v = rader.map((r) => r[c]).filter(Boolean);
    if (v.length < rader.length * 0.6) continue;
    const unike = new Set(v.map((x) => x.toLowerCase())).size / v.length;
    let poeng;
    if (navnekolonne === -1)
      poeng =
        (v.filter((x) => /\s/.test(x) && !/\d/.test(x) && x.length > 4)
          .length /
          v.length) *
        unike;
    else poeng = v.filter(erKlassekode).length / v.length;
    if (poeng > bestePoeng) {
      bestePoeng = poeng;
      beste = c;
    }
  }
  return bestePoeng > 0.4 ? beste : -1;
}

function lesKlasseliste(tekst) {
  const alle = tekst
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim());
  const linjer = alle.filter((l) => l && !erSoppel(l));
  if (!linjer.length) return { elever: [], forslag: '' };

  const rader = skillEnkeltceller(
    tilRader(linjer)
      .map((r) => r.filter((c) => c && !erSoppel(c)))
      .filter((r) => r.length),
  );
  const nk = Math.max(0, velgKolonne(rader, -1));
  const gk = velgKolonne(rader, nk);

  const sett = new Set();
  const elever = [];
  rader.forEach((r) => {
    const navn = (r[nk] || r[0] || '').replace(/\s+/g, ' ').trim();
    if (
      !navn ||
      navn.length < 2 ||
      /^\d+$/.test(navn) ||
      erKlassekode(navn)
    )
      return;
    if (sett.has(navn.toLowerCase())) return;
    sett.add(navn.toLowerCase());
    elever.push({ navn, gruppe: gk >= 0 ? r[gk] || null : null });
  });

  let forslag = '';
  for (const l of alle) {
    if (l && /^[A-ZÆØÅ]{1,3}\/[A-ZÆØÅ]{2,6}\d{3,5}$/.test(l)) {
      forslag = l;
      break;
    }
  }
  if (!forslag) {
    const forste = alle.find((l) => l && !/^\d/.test(l));
    if (
      forste &&
      forste.length < 40 &&
      !elever.some((e) => e.navn === forste)
    )
      forslag = forste;
  }
  return { elever, forslag };
}

/* Fullt navn brukes bare her, i minnet, og lagres aldri */
function oppdelNavn(fullt) {
  let n = fullt.replace(/\s+/g, ' ').trim();
  let fornavn, etter;
  const p = n
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (p.length > 1) {
    // «Etternavn, Fornavn Mellomnavn»
    fornavn = p[1].split(' ')[0];
    etter = p[0].split(' ').pop();
  } else {
    // «Fornavn Mellomnavn Etternavn»
    const ord = n.split(' ');
    fornavn = ord[0];
    etter = ord.length > 1 ? ord[ord.length - 1] : '';
  }
  etter = etter.replace(/^[^A-Za-zÆØÅæøåÀ-ÿ]+/, '');
  if (etter) etter = etter[0].toUpperCase() + etter.slice(1);
  return { fornavn, etter };
}
const lav = (s) => s.toLowerCase();

/* Fornavn, og bare så mange bokstaver av etternavnet som trengs
   for å skille elever med samme fornavn: «Emma H», «Emma Ha» … */
function forkortNavn(navneliste) {
  const d = navneliste.map(oppdelNavn);
  const niva = d.map(() => 0);
  // helt like navn skilles aldri av etternavnet – stopp på initialen
  const hel = (x) => lav(x.fornavn + ' ' + x.etter);
  const likt = {};
  d.forEach((x) => (likt[hel(x)] = (likt[hel(x)] || 0) + 1));
  const maks = d.map((x) =>
    likt[hel(x)] > 1 ? Math.min(1, x.etter.length) : x.etter.length,
  );
  const kort = (i) =>
    niva[i]
      ? d[i].fornavn + ' ' + d[i].etter.slice(0, niva[i])
      : d[i].fornavn;
  for (let runde = 0; runde < 40; runde++) {
    const grupper = {};
    d.forEach((_, i) => (grupper[lav(kort(i))] ||= []).push(i));
    let endret = false;
    Object.values(grupper).forEach((g) => {
      if (g.length < 2) return;
      g.forEach((i) => {
        if (niva[i] < maks[i]) {
          niva[i]++;
          endret = true;
        }
      });
    });
    if (!endret) break;
  }
  // helt like navn får et nummer
  const ant = {},
    nr = {};
  const ut = d.map((_, i) => kort(i));
  ut.forEach((k) => (ant[lav(k)] = (ant[lav(k)] || 0) + 1));
  return ut.map((k) => {
    if (ant[lav(k)] < 2) return k;
    nr[lav(k)] = (nr[lav(k)] || 0) + 1;
    return k + ' ' + nr[lav(k)];
  });
}

function importliste() {
  const r = lesKlasseliste($('importtekst').value);
  const k = forkortNavn(r.elever.map((e) => e.navn));
  r.elever = r.elever.map((e, i) => ({ navn: k[i], gruppe: e.gruppe }));
  return r;
}

function visBoks(hvilken) {
  $('elevlisteboks').hidden = hvilken !== 'liste';
  $('elevtekstboks').hidden = hvilken !== 'tekst';
  $('importboks').hidden = hvilken !== 'import';
}
function tomImport() {
  $('importtekst').value = '';
  $('importnavn').value = '';
  $('importstatus').textContent = '';
  $('importfasit').textContent = '';
}
$('importmodus').addEventListener('click', () => {
  // tom klasse: elevene går rett inn i den, uten valg om ny klasse
  const tom = elever().length === 0;
  $('importnavnboks').hidden = tom;
  $('importNy').hidden = tom;
  $('importLegg').textContent = tom ? 'Importer' : 'Legg til her';
  $('elevstatus').textContent = '';
  tomImport();
  visBoks('import');
  $('importtekst').focus();
});
$('importAvbryt').addEventListener('click', () => {
  tomImport();
  visBoks('liste');
});
function visImport() {
  const r = importliste();
  $('importstatus').textContent = r.elever.length
    ? 'Fant ' + r.elever.length + ' elever.'
    : $('importtekst').value.trim()
      ? 'Fant ingen navn i teksten.'
      : '';
  $('importstatus').className =
    'status' + (r.elever.length ? '' : ' varsel');
  $('importfasit').textContent = r.elever
    .slice(0, 60)
    .map((e) => e.navn + (e.gruppe ? ' (' + e.gruppe + ')' : ''))
    .join(' · ');
  if (r.forslag && !$('importnavn').value)
    $('importnavn').value = r.forslag;
}
$('importtekst').addEventListener('input', visImport);
async function importer(nyKlasse) {
  const r = importliste();
  if (!r.elever.length) {
    $('importstatus').textContent = 'Ingenting å importere.';
    return;
  }
  if (nyKlasse) {
    const n = ($('importnavn').value || r.forslag || 'Ny klasse').trim();
    if (r.elever.length > MAKS_ELEVER) return grenseElever();
    if (!D.klasser[n] && antallKlasser() >= MAKS_KLASSER)
      return grenseKlasser();
    if (
      D.klasser[n] &&
      !(await bekreft(
        'Klassen ' + n + ' finnes fra før. Erstatte elevlisten?',
        'Erstatt',
      ))
    )
      return;
    D.klasser[n] = {
      elever: r.elever.map((e) => nyElev(e.navn, null, e.gruppe)),
      historikk: [],
    };
    apneKlasse(n);
    $('elevstatus').textContent =
      'Laget ' + n + ' med ' + r.elever.length + ' elever.';
  } else {
    // samme kortnavn regnes som samme elev
    const finnes = new Set(elever().map((e) => lav(e.navn)));
    const nye = new Set(
      r.elever.map((e) => lav(e.navn)).filter((x) => !finnes.has(x)),
    );
    if (elever().length + nye.size > MAKS_ELEVER) return grenseElever();
    const hoppet = [];
    let lagt = 0;
    r.elever.forEach((e) => {
      if (finnes.has(lav(e.navn))) return hoppet.push(e.navn);
      finnes.add(lav(e.navn));
      klasse().elever.push(nyElev(e.navn, null, e.gruppe));
      lagt++;
    });
    $('elevstatus').textContent =
      'La til ' +
      lagt +
      (lagt === 1 ? ' elev.' : ' elever.') +
      (hoppet.length
        ? ' Hoppet over ' +
          hoppet.join(', ') +
          ' – de finnes alt i klassen. Legg til for hånd hvis det er en annen elev.'
        : '');
  }
  tomImport();
  visBoks('liste');
  tegn();
}
$('importNy').addEventListener('click', () => importer(true));
$('importLegg').addEventListener('click', () => importer(false));

$('tekstmodus').addEventListener('click', () => {
  $('elevtekst').value = elever()
    .map((e) => e.navn + (e.kjonn ? ' (' + e.kjonn + ')' : ''))
    .join('\n');
  visBoks('tekst');
  $('elevtekst').focus();
});
$('avbrytTekst').addEventListener('click', () => visBoks('liste'));
$('lagreTekst').addEventListener('click', () => {
  const gamle = elever();
  const nye = $('elevtekst')
    .value.split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/\(?\s*([gjGJ])\s*\)\s*$/);
      let kjonn = null,
        navn = l;
      if (m) {
        kjonn = m[1].toLowerCase();
        navn = l.slice(0, m.index).trim();
      }
      const funnet = gamle.find(
        (e) => e.navn.toLowerCase() === navn.toLowerCase(),
      );
      if (funnet) {
        funnet.navn = navn;
        if (kjonn) funnet.kjonn = kjonn;
        return funnet;
      }
      return nyElev(navn, kjonn);
    });
  if (nye.length > MAKS_ELEVER) return grenseElever();
  const beholdt = new Set(nye.map((e) => e.id));
  nye.forEach((e) => {
    e.sammen = e.sammen.filter((i) => beholdt.has(i));
    e.unna = e.unna.filter((i) => beholdt.has(i));
  });
  klasse().elever = nye;
  visBoks('liste');
  tegn();
});

/* ============ hendelser: rom ============ */
const nyttRomOppsett = () => ({
  rader: [
    [2, 3, 2],
    [2, 3, 2],
    [2, 3, 2],
    [2, 3, 2],
  ],
  sperret: [],
});
function byttRom(n) {
  if (romModus) settRomModus(false);
  D.aktiv.rom = n;
  D.aktiv.plasser = {};
  D.aktiv.laaste = [];
  tegn();
}
$('velgRom').addEventListener('change', async (e) => {
  if (e.target.value) return byttRom(e.target.value);
  const sp = 'Navn på det nye rommet, f.eks. 218';
  const n = ((await sporOm(sp)) || '').trim();
  if (!n) return tegn();
  if (D.rom[n]) return byttRom(n);
  if (Object.keys(D.rom).length >= MAKS_ROM) {
    grenseRom();
    return tegn();
  }
  if (romModus) settRomModus(false);
  romBilde = tattRomBilde();
  D.rom[n] = nyttRomOppsett();
  byttRom(n);
  settRomModus(true);
});
vedKlikk('endreRom', () => {
  if (D.aktiv.rom === STANDARDROM) return lagKopiAvStandardrom();
  settRomModus(true);
});
vedKlikk('romFerdig', () => settRomModus(false));
vedKlikk('romAvbryt', () => {
  const bilde = romBilde;
  settRomModus(false);
  if (bilde) gjenopprettRomBilde(bilde);
  tegn();
});
async function lagKopiAvStandardrom() {
  if (
    !(await bekreft(
      'Standardrommet kan ikke endres. Vil du lage en kopi du kan endre?',
      'Lag kopi',
    ))
  )
    return;
  const n = (
    (await sporOm('Navn på det nye rommet', 'Mitt rom')) || ''
  ).trim();
  if (!n) return;
  if (D.rom[n])
    return visBeskjed(
      'Det finnes allerede et rom som heter ' + n + '.',
      true,
    );
  if (Object.keys(D.rom).length >= MAKS_ROM) return grenseRom();
  romBilde = tattRomBilde();
  const R = rommet();
  D.rom[n] = { rader: kopi(R.rader), sperret: R.sperret.slice() };
  byttRom(n);
  settRomModus(true);
}
$('romnavn').addEventListener('change', (e) => {
  const nytt = e.target.value.trim();
  const gammelt = D.aktiv.rom;
  if (!nytt || nytt === gammelt) return (e.target.value = gammelt);
  if (D.rom[nytt]) {
    visBeskjed(
      'Det finnes allerede et rom som heter ' + nytt + '.',
      true,
    );
    return (e.target.value = gammelt);
  }
  D.rom[nytt] = D.rom[gammelt];
  delete D.rom[gammelt];
  Object.values(D.kart).forEach((k) => {
    if (k.rom === gammelt) k.rom = nytt;
  });
  Object.values(D.klasser).forEach((k) => {
    if (k.sist && k.sist.rom === gammelt) k.sist.rom = nytt;
  });
  D.aktiv.rom = nytt;
  tegn();
});
vedKlikk('dupliserRom', async () => {
  const n = (
    (await sporOm('Navn på det nye rommet', D.aktiv.rom + ' (kopi)')) ||
    ''
  ).trim();
  if (!n) return;
  if (D.rom[n])
    return visBeskjed(
      'Det finnes allerede et rom som heter ' + n + '.',
      true,
    );
  if (Object.keys(D.rom).length >= MAKS_ROM) return grenseRom();
  const R = rommet();
  D.rom[n] = { rader: kopi(R.rader), sperret: R.sperret.slice() };
  D.aktiv.rom = n;
  romBilde = tattRomBilde();
  tegn();
});
vedKlikk('slettRom', async () => {
  if (D.aktiv.rom === STANDARDROM)
    return visBeskjed('Standardrommet kan ikke slettes.', true);
  if (Object.keys(D.rom).length < 2)
    return visBeskjed('Du må ha minst ett rom.', true);
  if (
    !(await bekreft(
      'Slette rommet ' +
        D.aktiv.rom +
        '?' +
        (iSky() ? ' Det forsvinner også for kollegaene dine.' : ''),
      'Slett',
      true,
    ))
  )
    return;
  delete D.rom[D.aktiv.rom];
  settRomModus(false);
  byttRom(Object.keys(D.rom).sort(sammenlign)[0]);
});

/* ============ hendelser: data ============ */
function lastNedFil(innhold, filnavn, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([innhold], { type }));
  a.download = filnavn;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function lastNedKopi() {
  const pw = await sporOm(
    'Velg et passord for sikkerhetskopien (minst 8 tegn). Du trenger det for å lese kopien inn igjen.',
    '',
    'password',
  );
  if (pw === null) return;
  if (pw.length < 8) {
    visBeskjed('Passordet må ha minst 8 tegn.', true);
    return;
  }
  try {
    visBeskjed('Krypterer …');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const bits = await passordBits(pw, salt);
    const data = await krypter(
      await aesNokkel(bits.slice(0, 32)),
      koder.encode(JSON.stringify(D)),
    );
    const fil = {
      klassekart: 'kryptert-kopi',
      versjon: 1,
      salt: b64(salt),
      data,
    };
    lastNedFil(
      JSON.stringify(fil),
      'klassekart-kopi-' +
        new Date().toISOString().slice(0, 10) +
        '.json',
      'application/json',
    );
    visBeskjed('Kryptert kopi lastet ned.');
  } catch (err) {
    visBeskjed('Nettleseren stoppet nedlastingen.', true);
  }
}
$('filvelger').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const les = new FileReader();
  les.onload = () => lesFil(les.result);
  les.readAsText(f);
});
async function lesFil(tekst) {
  let fil = null;
  try {
    fil = JSON.parse(tekst);
  } catch (err) {}
  if (!fil || fil.klassekart !== 'kryptert-kopi') return lesInn(tekst);
  const pw = await sporOm(
    'Passordet for sikkerhetskopien',
    '',
    'password',
  );
  if (pw === null) return;
  try {
    const bits = await passordBits(pw, ub64(fil.salt));
    const ren = await dekrypter(
      await aesNokkel(bits.slice(0, 32)),
      fil.data,
    );
    lesInn(avkoder.decode(ren));
  } catch (err) {
    visBeskjed('Feil passord for sikkerhetskopien.', true);
  }
}
async function lesInn(tekst) {
  let ny;
  try {
    ny = JSON.parse(tekst);
    if (!ny || !ny.klasser || !ny.rom) throw new Error('feil format');
  } catch (err) {
    visBeskjed('Filen er ikke en sikkerhetskopi fra Klassekart.', true);
    return;
  }
  if (iSky()) {
    // i skyen legges klassene til – vi sletter ikke delte klasser
    const nyeKlasser = Object.values(ny.klasser).filter(
      (k) => k.elever && k.elever.length,
    ).length;
    if (antallKlasser() + nyeKlasser > MAKS_KLASSER)
      return grenseKlasser();
    const sp = 'Legge klassene i kopien til i kontoen din?';
    if (!(await bekreft(sp, 'Legg til'))) return;
    const ant = slaaSammen(ny);
    visBeskjed(ant + (ant === 1 ? ' klasse' : ' klasser') + ' lagt til.');
    tegn();
    if (!$('oversikt').hidden) tegnOversikt();
    return;
  }
  const sp = 'Erstatte alt som ligger her nå med innholdet i kopien?';
  if (!(await bekreft(sp, 'Erstatt', true))) return;
  D = ny;
  normaliser();
  angrestabel = [];
  $('angre').disabled = true;
  visBeskjed('Kopien er lest inn.');
  tegn();
  if (!$('oversikt').hidden) tegnOversikt();
}

/* Legger klassene i en annen datamengde inn i D, uten å overskrive */
function slaaSammen(ny) {
  let antall = 0,
    romHoppet = false;
  Object.entries(ny.klasser || {}).forEach(([n, k]) => {
    if (!k.elever || !k.elever.length) return;
    let nn = n,
      i = 1;
    while (D.klasser[nn]) nn = n + ' (' + ++i + ')';
    D.klasser[nn] = {
      elever: k.elever,
      historikk: k.historikk || [],
      sist: k.sist || null,
      grupper: k.grupper || null,
    };
    Object.entries(ny.kart || {}).forEach(([kn, x]) => {
      if (x.klasse !== n) return;
      let kk = kn;
      while (D.kart[kk]) kk += ' (kopi)';
      D.kart[kk] = { ...x, klasse: nn };
    });
    antall++;
  });
  Object.entries(ny.rom || {}).forEach(([rn, r]) => {
    if (D.rom[rn]) return;
    if (Object.keys(D.rom).length >= MAKS_ROM) return (romHoppet = true);
    D.rom[rn] = r;
  });
  if (romHoppet) grenseRom();
  // en tom «Ny klasse» trengs ikke lenger
  if (antall)
    Object.keys(D.klasser).forEach((n) => {
      const k = D.klasser[n];
      if (n === 'Ny klasse' && !k.elever.length) delete D.klasser[n];
    });
  normaliser();
  gjenopprett(D.aktiv.klasse);
  return antall;
}

/* ============ brukere ============ */
function normaliser() {
  if (!D.kart) D.kart = {};
  if (!D.klasser || !Object.keys(D.klasser).length)
    D.klasser = standarddata().klasser;
  if (!D.rom || !Object.keys(D.rom).length) D.rom = standarddata().rom;
  if (!D.aktiv || !D.klasser[D.aktiv.klasse])
    D.aktiv = {
      klasse: Object.keys(D.klasser)[0],
      rom: Object.keys(D.rom)[0],
      plasser: {},
      laaste: [],
      spre: false,
      spreKlasse: false,
      nyeNaboer: true,
      speil: false,
      farger: {},
    };
  // et standardrom som er endret fra før (før det ble låst), settes tilbake
  const std = D.rom[STANDARDROM],
    fast = standardromOppsett();
  if (
    std &&
    (JSON.stringify(std.rader) !== JSON.stringify(fast.rader) ||
      (std.sperret || []).length)
  )
    Object.assign(std, fast);
  if (!D.rom[D.aktiv.rom]) D.aktiv.rom = Object.keys(D.rom)[0];
  if (!D.aktiv.farger) D.aktiv.farger = {};
  Object.values(D.klasser).forEach((k) => {
    if (!k.historikk) k.historikk = [];
    k.elever.forEach((e) => {
      if (!e.sammen) e.sammen = [];
      if (!e.unna) e.unna = [];
      if (!e.sone) e.sone = 'fri';
      if (e.gruppe === undefined) e.gruppe = null;
      delete e.fullt; // fullt navn lagres ikke lenger
      delete e.borte; // tilstedeværelse er tatt bort
    });
  });
}
/* Data fra eldre versjoner, der hver «bruker» hadde sin egen kopi */
function gamleData() {
  const ut = [];
  try {
    const navn = JSON.parse(localStorage.getItem(PROFILER) || '[]');
    const sist = JSON.parse(localStorage.getItem(SIST) || 'null');
    navn
      .sort((a, b) => (b === sist) - (a === sist))
      .forEach((n) => {
        const d = JSON.parse(
          localStorage.getItem(brukernokkel(n)) || 'null',
        );
        if (d && d.klasser) ut.push(d);
      });
    const v3 = JSON.parse(localStorage.getItem(GAMMEL) || 'null');
    if (!ut.length && v3 && v3.klasser) ut.push(v3);
  } catch (err) {}
  return ut;
}
