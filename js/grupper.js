/* Gruppefarger på pultene og tilfeldige grupper. */
'use strict';

/* ============ grupper ============
   Fargene hører til pultene i dette kartet. Bytter elever plass, blir
   fargene stående, så en ny trekning gir nye grupper. */
const FARGER = [
  { navn: 'Rød', hex: '#d64545' },
  { navn: 'Blå', hex: '#3a6fc4' },
  { navn: 'Gul', hex: '#dcae1d' },
  { navn: 'Grønn', hex: '#4c9a48' },
  { navn: 'Lilla', hex: '#8456b8' },
  { navn: 'Oransje', hex: '#e8833a' },
  { navn: 'Turkis', hex: '#2a9d99' },
  { navn: 'Rosa', hex: '#d35c9a' },
  { navn: 'Brun', hex: '#8c6239' },
  { navn: 'Grå', hex: '#6f7a80' },
];
function fargeknapper(boks, valgt, velg, utenIngen) {
  FARGER.forEach((f, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fargeknapp';
    b.style.setProperty('--gf', f.hex);
    b.title = f.navn;
    b.setAttribute('aria-label', f.navn);
    b.setAttribute('aria-pressed', valgt === i);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      velg(i);
    });
    boks.appendChild(b);
  });
  if (utenIngen) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'fargeknapp ingen';
  b.title = 'Ingen farge';
  b.setAttribute('aria-label', 'Ingen farge');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    velg(null);
  });
  boks.appendChild(b);
}

let malerModus = false,
  malerFarge = 0;
function settMalerModus(paa) {
  if (paa && romModus) settRomModus(false);
  malerModus = paa;
  lukkPanel();
  $('verktoy').hidden = paa;
  $('malerverktoy').hidden = !paa;
  if (paa) tegnMalerfarger();
  tegn();
}
function tegnMalerfarger() {
  const b = $('malerfarger');
  b.innerHTML = '';
  fargeknapper(
    b,
    malerFarge,
    (f) => {
      malerFarge = f;
      tegnMalerfarger();
    },
    true,
  );
}
function malPult(k) {
  if (erSperret(k)) return;
  lagreAngre();
  if (D.aktiv.farger[k] === malerFarge) delete D.aktiv.farger[k];
  else D.aktiv.farger[k] = malerFarge;
  tegn();
}
vedKlikk('malerFerdig', () => settMalerModus(false));
vedKlikk('grupperKnapp', () =>
  apneMeny($('grupperKnapp'), (boks) => {
    menyvalg(
      boks,
      gruppesett() ? 'Vis grupper' : 'Tilfeldige grupper …',
      apneGrupper,
    );
    menyvalg(boks, 'Del inn i makkergrupper', () => {
      lagreAngre();
      lagMakkergrupper(true);
      tegn();
    });
    menyvalg(boks, 'Fargelegg pulter selv', () => settMalerModus(true));
    if (Object.keys(D.aktiv.farger).length)
      menyvalg(
        boks,
        'Fjern alle farger',
        () => {
          lagreAngre();
          D.aktiv.farger = {};
          tegn();
        },
        true,
      );
    const h = document.createElement('p');
    h.className = 'hjelp';
    h.textContent =
      'Tilfeldige grupper følger reglene og endrer ikke kartet. Makkergrupper er 3–5 elever som sitter nær hverandre. Du kan også gi en enkelt pult farge ved å klikke på den.';
    boks.appendChild(h);
  }),
);

/* Deler elevene som har plass, inn i grupper på 4 (±1) nabopulter.
   Pultene får koordinater (rader litt lenger fra hverandre enn pulter
   side om side, midtgang som ekstra avstand), grupper vokser fra
   fremste venstre pult, og bytter mellom gruppene gjør dem tettere. */
function lagMakkergrupper(varsle) {
  const pos = {};
  rommet().rader.forEach((rad, r) => {
    let x = 0;
    rad.forEach((ant, g) => {
      for (let i = 0; i < ant; i++)
        pos[nokkel(r, g, i)] = { x: x + i, y: r * 1.25 };
      x += ant + 0.9;
    });
  });
  const seter = Object.keys(D.aktiv.plasser).filter(
    (k) => pos[k] && !erSperret(k),
  );
  const n = seter.length;
  if (n < 2) {
    if (varsle)
      visBeskjed(
        'Plasser elevene først – gruppene lages av dem som sitter nær hverandre.',
        true,
      );
    return;
  }
  const antall = Math.max(1, Math.round(n / 4));
  const storrelser = Array.from(
    { length: antall },
    (_, i) => Math.floor(n / antall) + (i < n % antall ? 1 : 0),
  );
  const avst = (a, b) =>
    Math.hypot(pos[a].x - pos[b].x, pos[a].y - pos[b].y);
  const lesefolge = (a, b) => pos[a].y - pos[b].y || pos[a].x - pos[b].x;

  const igjen = new Set(seter);
  const grupper = storrelser.map((st) => {
    const start = [...igjen].sort(lesefolge)[0];
    const g = [start];
    igjen.delete(start);
    while (g.length < st && igjen.size) {
      let beste = null,
        besteAvst = Infinity;
      igjen.forEach((c) => {
        const a =
          Math.min(...g.map((m) => avst(m, c))) + 0.01 * avst(start, c);
        if (a < besteAvst) {
          besteAvst = a;
          beste = c;
        }
      });
      g.push(beste);
      igjen.delete(beste);
    }
    return g;
  });
  const spredning = (g) => {
    let sum = 0;
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) sum += avst(g[i], g[j]) ** 2;
    return sum;
  };
  for (let runde = 0; runde < 30; runde++) {
    let bedre = false;
    for (let a = 0; a < grupper.length; a++)
      for (let b = a + 1; b < grupper.length; b++) {
        const A = grupper[a],
          B = grupper[b];
        for (let i = 0; i < A.length; i++)
          for (let j = 0; j < B.length; j++) {
            const foer = spredning(A) + spredning(B);
            [A[i], B[j]] = [B[j], A[i]];
            if (spredning(A) + spredning(B) < foer - 1e-9) bedre = true;
            else [A[i], B[j]] = [B[j], A[i]];
          }
      }
    if (!bedre) break;
  }
  const forste = (g) => g.slice().sort(lesefolge)[0];
  grupper.sort((a, b) => lesefolge(forste(a), forste(b)));
  D.aktiv.farger = {};
  grupper.forEach((g, i) =>
    g.forEach((k) => (D.aktiv.farger[k] = i % FARGER.length)),
  );
  if (varsle) visBeskjed(grupper.length + ' makkergrupper laget.');
}

/* ============ tilfeldige grupper ============
   Et eget verktøy som aldri endrer kartet. Klassen husker bare det
   siste settet (klasse().grupper), og det krypteres sammen med resten
   av klassen. Gruppenavnet er ett adjektiv og ett substantiv. */
const ADJEKTIV = [
  'Atomic', 'Galactic', 'Quantum', 'Cosmic', 'Bionic', 'Martian',
  'Lunar', 'Solar', 'Stellar', 'Orbiting', 'Electric', 'Magnetic',
  'Clockwork', 'Invisible', 'Celestial', 'Enchanted', 'Victorian',
  'Arthurian', 'Olympian', 'Homeric', 'Arabian', 'Gothic', 'Mythic',
  'Dickensian', 'Mysterious', 'Secret', 'Hidden', 'Wandering',
  'Curious', 'Peculiar', 'Golden', 'Silver', 'Emerald', 'Crimson',
  'Midnight', 'Moonlit', 'Starlit', 'Phantom', 'Royal', 'Noble',
  'Ancient', 'Legendary', 'Mighty', 'Fearless', 'Gallant', 'Jolly',
  'Flying', 'Frozen', 'Whispering', 'Wondrous',
];
const SUBSTANTIV = [
  'Pirates', 'Astronauts', 'Trolls', 'Quasars', 'Dragons', 'Goblins',
  'Mermaids', 'Robots', 'Wizards', 'Knights', 'Explorers', 'Pilgrims',
  'Hobbits', 'Wayfarers', 'Comets', 'Rockets', 'Starships', 'Androids',
  'Cyborgs', 'Voyagers', 'Navigators', 'Musketeers', 'Inventors',
  'Giants', 'Elves', 'Unicorns', 'Griffins', 'Phoenixes', 'Centaurs',
  'Sphinxes', 'Krakens', 'Detectives', 'Castaways', 'Mariners',
  'Lilliputians', 'Samurai', 'Genies', 'Argonauts', 'Titans', 'Oracles',
  'Satellites', 'Nebulas', 'Meteors', 'Vikings', 'Valkyries', 'Gnomes',
  'Ghosts', 'Owls', 'Foxes', 'Rangers',
];
function gruppenavn(antall) {
  const a = stokk(ADJEKTIV),
    s = stokk(SUBSTANTIV);
  return Array.from(
    { length: antall },
    (_, i) => a[i % a.length] + ' ' + s[i % s.length],
  );
}
function antallGrupper(valg, n) {
  const t = Math.max(1, Math.floor(valg.tall) || 1);
  const a = valg.maate === 'antall' ? t : Math.round(n / t);
  return Math.max(1, Math.min(n, a));
}

/* «Ikke sammen» skal i hver sin gruppe, «sammen» i samme gruppe */
function regelpar(ids) {
  const inn = new Set(ids),
    unna = new Map(),
    sammen = new Map();
  elever().forEach((e) => {
    if (!inn.has(e.id)) return;
    e.unna.forEach((id) => {
      if (inn.has(id)) unna.set(parN(e.id, id), [e.id, id]);
    });
    e.sammen.forEach((id) => {
      if (inn.has(id)) sammen.set(parN(e.id, id), [e.id, id]);
    });
  });
  return { unna: [...unna.values()], sammen: [...sammen.values()] };
}
function delInnGrupper(ids, antall) {
  const n = ids.length;
  const storrelser = Array.from(
    { length: antall },
    (_, i) => Math.floor(n / antall) + (i < n % antall ? 1 : 0),
  );
  const r = regelpar(ids);
  const kost = (hvor) => {
    let k = 0;
    for (const [a, b] of r.unna) if (hvor[a] === hvor[b]) k += 80;
    for (const [a, b] of r.sammen) if (hvor[a] !== hvor[b]) k += 60;
    return k;
  };
  let beste = null,
    bestekost = Infinity;
  for (let start = 0; start < 20 && bestekost > 0; start++) {
    const p = stokk(ids),
      hvor = {};
    let i = 0;
    storrelser.forEach((st, g) => {
      for (let j = 0; j < st; j++) hvor[p[i++]] = g;
    });
    let k = kost(hvor);
    for (let it = 0; it < 3000 && k > 0; it++) {
      const a = ids[Math.floor(Math.random() * n)],
        b = ids[Math.floor(Math.random() * n)];
      if (hvor[a] === hvor[b]) continue;
      [hvor[a], hvor[b]] = [hvor[b], hvor[a]];
      const ny = kost(hvor);
      if (ny <= k) k = ny;
      else [hvor[a], hvor[b]] = [hvor[b], hvor[a]];
    }
    if (k < bestekost) {
      bestekost = k;
      beste = hvor;
    }
  }
  const grupper = storrelser.map(() => []);
  stokk(ids).forEach((id) => grupper[beste[id]].push(id));
  return grupper;
}
/* Regelbrudd per gruppe, til varselet nederst i hvert gruppekort */
function gruppebrudd(liste) {
  const hvor = new Map();
  liste.forEach((g, i) => g.elever.forEach((id) => hvor.set(id, i)));
  const ut = liste.map(() => []);
  const r = regelpar([...hvor.keys()]);
  r.unna.forEach(([a, b]) => {
    if (hvor.get(a) === hvor.get(b))
      ut[hvor.get(a)].push(
        navnAv(a) + ' og ' + navnAv(b) + ' skal ikke være sammen.',
      );
  });
  r.sammen.forEach(([a, b]) => {
    if (hvor.get(a) === hvor.get(b)) return;
    const t = navnAv(a) + ' og ' + navnAv(b) + ' skal være sammen.';
    ut[hvor.get(a)].push(t);
    ut[hvor.get(b)].push(t);
  });
  return ut;
}

let gruppeValgt = null,
  gruppeOppsett = false,
  gruppevalg = null;
const gruppesett = () => {
  const g = klasse().grupper;
  return g && g.liste && g.liste.length ? g : null;
};
// indeksen til gruppen eleven er i, -1 er «ikke med»
const gruppeAv = (id) =>
  gruppesett().liste.findIndex((g) => g.elever.includes(id));

function apneGrupper() {
  lukkPanel();
  gruppeValgt = null;
  gruppevalg = null;
  gruppeOppsett = !gruppesett();
  $('gruppedialog').hidden = false;
  tegnGrupper();
  const b = $('gruppeboks').querySelector('.knapp.hoved');
  if (b) b.focus();
}
function lukkGrupper() {
  $('gruppedialog').hidden = true;
  $('grupperKnapp').focus();
}
$('gruppedialog').addEventListener('click', (e) => {
  e.stopPropagation();
  if (e.target === e.currentTarget) lukkGrupper();
  else if (gruppeValgt && !e.target.closest('.gruppekort, .knapp')) {
    gruppeValgt = null;
    tegnGrupper();
  }
});

function tegnGrupper() {
  const boks = $('gruppeboks');
  boks.innerHTML = '';
  boks.classList.toggle('smal', gruppeOppsett);
  const topp = document.createElement('div');
  topp.className = 'dialogtopp';
  const h = document.createElement('h2');
  h.id = 'gruppetittel';
  h.textContent = 'Tilfeldige grupper · ' + D.aktiv.klasse;
  const knapper = document.createElement('div');
  knapper.className = 'grp';
  topp.append(h, knapper);
  boks.appendChild(topp);
  const knapp = (tekst, fn, hoved) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'knapp' + (hoved ? ' hoved' : '');
    b.textContent = tekst;
    b.addEventListener('click', fn);
    knapper.appendChild(b);
  };
  if (!gruppeOppsett) {
    knapp('Kopier tabell', kopierGrupper, true);
    knapp('Nye navn', nyeGruppenavn);
    knapp('Trekk nye grupper', () => {
      gruppeOppsett = true;
      gruppeValgt = null;
      tegnGrupper();
    });
  }
  knapp('Lukk', lukkGrupper);
  if (gruppeOppsett) tegnGruppeoppsett(boks);
  else tegnGruppeliste(boks);
}

function tegnGruppeoppsett(boks) {
  const n = elever().length;
  if (!gruppevalg)
    gruppevalg = kopi(
      (klasse().grupper || {}).valg || { maate: 'storrelse', tall: 4 },
    );
  const v = gruppevalg;
  const felt = (tekst, id) => {
    const l = document.createElement('label');
    l.className = 'felt';
    l.textContent = tekst;
    if (id) l.htmlFor = id;
    boks.appendChild(l);
  };
  felt('Del inn etter');
  boks.appendChild(
    segment(
      [
        ['Elever per gruppe', 'storrelse'],
        ['Antall grupper', 'antall'],
      ],
      v.maate,
      (m) => {
        if (m === v.maate) return;
        const a = antallGrupper(v, Math.max(n, 1));
        v.tall = m === 'antall' ? a : Math.max(1, Math.round(n / a));
        v.maate = m;
        tegnGrupper();
      },
    ),
  );
  felt(
    v.maate === 'antall' ? 'Antall grupper' : 'Elever per gruppe',
    'gruppetall',
  );
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.id = 'gruppetall';
  inp.min = 1;
  inp.max = Math.max(1, n);
  inp.value = v.tall;
  boks.appendChild(inp);
  const status = document.createElement('p');
  status.className = 'status';
  boks.appendChild(status);
  boks.appendChild(
    hint(
      'Reglene for hvem som skal og ikke skal sitte sammen, gjelder også i gruppene. Kartet endres ikke.',
    ),
  );
  const rad = document.createElement('div');
  rad.className = 'knapprad';
  const trekk = document.createElement('button');
  trekk.type = 'button';
  trekk.className = 'knapp hoved';
  trekk.textContent = 'Trekk grupper';
  trekk.addEventListener('click', trekkGrupper);
  rad.appendChild(trekk);
  if (gruppesett()) {
    const avbryt = document.createElement('button');
    avbryt.type = 'button';
    avbryt.className = 'knapp';
    avbryt.textContent = 'Avbryt';
    avbryt.addEventListener('click', () => {
      gruppeOppsett = false;
      tegnGrupper();
    });
    rad.appendChild(avbryt);
  }
  boks.appendChild(rad);

  const oppdater = () => {
    v.tall = parseInt(inp.value, 10) || 1;
    trekk.disabled = n < 2;
    if (n < 2) {
      status.textContent =
        'Det må være minst to elever i klassen for å lage grupper.';
      return;
    }
    const a = antallGrupper(v, n),
      min = Math.floor(n / a),
      maks = Math.ceil(n / a);
    status.textContent =
      n +
      ' elever gir ' +
      a +
      (a === 1 ? ' gruppe' : ' grupper') +
      ' med ' +
      (min === maks ? min : min + '–' + maks) +
      ' elever.';
  };
  inp.addEventListener('input', oppdater);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !trekk.disabled) trekkGrupper();
  });
  oppdater();
}

function trekkGrupper() {
  const ids = elever().map((e) => e.id);
  if (ids.length < 2) return;
  const a = antallGrupper(gruppevalg, ids.length);
  const navn = gruppenavn(a);
  klasse().grupper = {
    valg: kopi(gruppevalg),
    liste: delInnGrupper(ids, a).map((g, i) => ({
      navn: navn[i],
      elever: g,
    })),
  };
  gruppeOppsett = false;
  gruppeValgt = null;
  lagre();
  tegnGrupper();
}
function nyeGruppenavn() {
  const liste = gruppesett().liste;
  const navn = gruppenavn(liste.length);
  liste.forEach((g, i) => (g.navn = navn[i]));
  lagre();
  tegnGrupper();
}

function tegnGruppeliste(boks) {
  const sett = gruppesett();
  // elever som er slettet fra klassen, forsvinner også fra gruppene
  const finnes = new Set(elever().map((e) => e.id));
  sett.liste.forEach(
    (g) => (g.elever = g.elever.filter((id) => finnes.has(id))),
  );
  const med = new Set(sett.liste.flatMap((g) => g.elever));
  const uten = elever()
    .filter((e) => !med.has(e.id))
    .map((e) => e.id);
  if (gruppeValgt && !finnes.has(gruppeValgt)) gruppeValgt = null;
  boks.appendChild(
    hint(
      gruppeValgt
        ? 'Klikk på en elev i en annen gruppe for å bytte med ' +
            navnAv(gruppeValgt) +
            ', eller på en gruppe for å flytte ' +
            navnAv(gruppeValgt) +
            ' dit.'
        : 'Dra en elev til en annen gruppe, eller klikk på to elever for å bytte dem.',
    ),
  );
  const brudd = gruppebrudd(sett.liste);
  const grid = document.createElement('div');
  grid.className = 'gruppegrid';
  sett.liste.forEach((g, i) =>
    grid.appendChild(
      gruppekort(
        i,
        'Gruppe ' + (i + 1),
        g.navn,
        g.elever,
        FARGER[i % FARGER.length].hex,
        brudd[i],
      ),
    ),
  );
  if (uten.length)
    grid.appendChild(
      gruppekort(-1, 'Ikke med', 'Dra inn i en gruppe', uten, null, []),
    );
  boks.appendChild(grid);
  boks.appendChild(
    hint(
      'Kopier tabell legger tabellen på utklippstavla, klar til å limes inn.',
    ),
  );
}

function gruppekort(gi, tittel, undertittel, ids, farge, varsler) {
  const kort = document.createElement('section');
  kort.className =
    'gruppekort' +
    (gi < 0 ? ' uten' : '') +
    (gruppeValgt ? ' kan-motta' : '');
  kort.style.setProperty('--gf', farge || 'var(--sperret)');
  const hode = document.createElement('div');
  hode.className = 'gruppehode';
  const s = document.createElement('strong');
  s.textContent = tittel;
  const em = document.createElement('em');
  em.textContent = undertittel;
  hode.append(s, em);
  if (gi >= 0 && !ids.length) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'gruppefjern';
    x.textContent = '×';
    x.title = 'Fjern ' + tittel.toLowerCase();
    x.setAttribute('aria-label', x.title);
    x.addEventListener('click', (ev) => {
      ev.stopPropagation();
      fjernGruppe(gi);
    });
    hode.appendChild(x);
    hode.style.paddingRight = '32px';
  }
  kort.appendChild(hode);

  const liste = document.createElement('div');
  liste.className = 'gruppeelever';
  ids.forEach((id) => {
    const e = elevMed(id);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gruppeelev' + (id === gruppeValgt ? ' valgt' : '');
    b.textContent = e.navn;
    b.draggable = true;
    b.addEventListener('click', (ev) => {
      ev.stopPropagation();
      velgGruppeelev(id);
    });
    b.addEventListener('dragstart', (ev) => {
      ev.dataTransfer.setData('text/plain', id);
      ev.dataTransfer.effectAllowed = 'move';
      b.classList.add('dratt');
    });
    b.addEventListener('dragend', () => b.classList.remove('dratt'));
    b.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      b.classList.add('maal');
    });
    b.addEventListener('dragleave', () => b.classList.remove('maal'));
    b.addEventListener('drop', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const fra = ev.dataTransfer.getData('text/plain');
      if (fra && fra !== id) flyttGruppeelev(fra, gi, id);
    });
    liste.appendChild(b);
  });
  if (!ids.length) {
    const p = document.createElement('p');
    p.className = 'gruppetom';
    p.textContent = 'Tom gruppe – dra elever hit.';
    liste.appendChild(p);
  }
  kort.appendChild(liste);
  varsler.forEach((t) => {
    const p = document.createElement('p');
    p.className = 'gruppevarsel';
    p.textContent = '⚠ ' + t;
    kort.appendChild(p);
  });

  kort.addEventListener('click', () => {
    if (gruppeValgt) flyttGruppeelev(gruppeValgt, gi);
  });
  kort.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    kort.classList.add('maal');
  });
  kort.addEventListener('dragleave', (ev) => {
    if (!kort.contains(ev.relatedTarget)) kort.classList.remove('maal');
  });
  kort.addEventListener('drop', (ev) => {
    ev.preventDefault();
    kort.classList.remove('maal');
    const fra = ev.dataTransfer.getData('text/plain');
    if (fra) flyttGruppeelev(fra, gi);
  });
  return kort;
}

// en tom gruppe kan fjernes; gruppene etter får nytt nummer
function fjernGruppe(gi) {
  gruppesett().liste.splice(gi, 1);
  gruppeValgt = null;
  if (!gruppesett()) gruppeOppsett = true;
  lagre();
  tegnGrupper();
}
/* Klikk på én elev og så en i en annen gruppe bytter dem */
function velgGruppeelev(id) {
  if (gruppeValgt && gruppeValgt !== id) {
    const fra = gruppeValgt;
    if (gruppeAv(fra) !== gruppeAv(id))
      return flyttGruppeelev(fra, gruppeAv(id), id);
    gruppeValgt = id;
  } else gruppeValgt = gruppeValgt === id ? null : id;
  tegnGrupper();
}
/* Flytter eleven til gruppe til (-1 er «ikke med»). Med bytt bytter
   de to elevene plass i stedet. */
function flyttGruppeelev(id, til, bytt) {
  const liste = gruppesett().liste;
  const fra = gruppeAv(id);
  gruppeValgt = null;
  if (fra === til || !elevMed(id)) return tegnGrupper();
  const ut = (g, x) => {
    if (g >= 0) liste[g].elever = liste[g].elever.filter((y) => y !== x);
  };
  const inn = (g, x, i) => {
    if (g >= 0) liste[g].elever.splice(i ?? liste[g].elever.length, 0, x);
  };
  if (bytt) {
    const ia = fra >= 0 ? liste[fra].elever.indexOf(id) : undefined,
      ib = til >= 0 ? liste[til].elever.indexOf(bytt) : undefined;
    ut(fra, id);
    ut(til, bytt);
    inn(til, id, ib);
    inn(fra, bytt, ia);
  } else {
    ut(fra, id);
    inn(til, id);
  }
  lagre();
  tegnGrupper();
}

/* Kopien har både en tabell (Word, Docs, Teams) og tekst med
   tabulator (Excel), med høyst seks grupper i bredden */
function lysere(hex, andel) {
  const v = parseInt(hex.slice(1), 16);
  return (
    '#' +
    [16, 8, 0]
      .map((s) =>
        Math.round(((v >> s) & 255) * (1 - andel) + 255 * andel)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
async function kopierGrupper() {
  const liste = gruppesett().liste;
  const celle =
    'border:1px solid #c9d1d6;padding:4pt 8pt;text-align:left;vertical-align:top;';
  const html = [],
    tekst = [];
  for (let s = 0; s < liste.length; s += 6) {
    const del = liste.slice(s, s + 6);
    let t =
      '<table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11pt"><tr>';
    del.forEach((g, j) => {
      const f = FARGER[(s + j) % FARGER.length].hex;
      t +=
        '<th style="' +
        celle +
        'border-top:4px solid ' +
        f +
        ';background:' +
        lysere(f, 0.85) +
        '">Gruppe ' +
        (s + j + 1) +
        '<br><i style="font-weight:normal">' +
        esc(g.navn) +
        '</i></th>';
    });
    t += '</tr>';
    tekst.push(
      del.map((g, j) => 'Gruppe ' + (s + j + 1) + ' – ' + g.navn).join('\t'),
    );
    const rader = Math.max(...del.map((g) => g.elever.length));
    for (let r = 0; r < rader; r++) {
      const navn = del.map((g) =>
        g.elever[r] ? navnAv(g.elever[r]) : '',
      );
      t +=
        '<tr>' +
        navn
          .map((x) => '<td style="' + celle + '">' + esc(x) + '</td>')
          .join('') +
        '</tr>';
      tekst.push(navn.join('\t'));
    }
    html.push(t + '</table>');
    tekst.push('');
  }
  const h = html.join('<p></p>'),
    p = tekst.join('\n').trim() + '\n';
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([h], { type: 'text/html' }),
        'text/plain': new Blob([p], { type: 'text/plain' }),
      }),
    ]);
  } catch (err) {
    if (!kopierMarkert(h))
      return visBeskjed(
        'Nettleseren stoppet kopieringen. Prøv igjen, eller bruk en annen nettleser.',
        true,
      );
  }
  visBeskjed('Tabellen er kopiert.');
}
// reserve for nettlesere uten ClipboardItem
function kopierMarkert(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(d);
  const r = document.createRange();
  r.selectNodeContents(d);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (err) {}
  s.removeAllRanges();
  d.remove();
  return ok;
}
