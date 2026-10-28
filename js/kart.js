/* Tegning av kartet, pultpanelet, elevlisten, dialoger og verktøylinjen. */
'use strict';

/* ============ tegning ============ */
function tilpassBredde(fastBredde) {
  const kart = $('kart');
  const rader = rommet().rader;
  if (!rader.length) return;
  // innerbredden: kartets egen polstring trekkes fra (mindre på mobil)
  const cs = getComputedStyle(kart);
  const kant =
    visning || fastBredde || !kart.clientWidth
      ? 46
      : parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 2;
  const plass =
    (visning
      ? window.innerWidth - 56
      : fastBredde || kart.clientWidth || 900) - kant;
  const trangt = plass < 620,
    svaertTrangt = plass < 420;
  const midtgang = svaertTrangt ? 10 : trangt ? 16 : 30;
  const pultgap = svaertTrangt ? 3 : trangt ? 5 : 8;
  let bredde = visning ? 300 : 148;
  rader.forEach((rad) => {
    const pulter = rad.reduce((a, b) => a + b, 0);
    if (!pulter) return;
    const gap =
      rad.reduce((a, n) => a + (n - 1) * pultgap, 0) +
      (rad.length - 1) * midtgang;
    bredde = Math.min(bredde, (plass - gap - 6) / pulter);
  });
  if (visning) {
    // fyll skjermen i høyden også: tittel og tavle tar ca. 190 px
    const n = rader.length;
    const hoyde = (window.innerHeight - 190 - (n - 1) * 16) / n;
    bredde = Math.min(bredde, hoyde / 0.58);
  }
  bredde = Math.max(svaertTrangt ? 36 : 46, Math.floor(bredde));
  kart.style.setProperty('--pultbredde', bredde + 'px');
  kart.style.setProperty(
    '--pulthoyde',
    Math.max(38, Math.round(bredde * 0.58)) + 'px',
  );
  kart.style.setProperty(
    '--pultskrift',
    (visning
      ? Math.max(12, Math.min(36, bredde * 0.16))
      : Math.max(9.5, Math.min(15.5, bredde * 0.125))
    ).toFixed(1) + 'px',
  );
  kart.style.setProperty('--midtgang', midtgang + 'px');
  kart.style.setProperty('--pultgap', pultgap + 'px');
  tilpassNavn();
}
/* Et navn som er bredere enn pulten, får mindre skrift, ned til 8 px. Det
   deles aldri midt i ordet: får det likevel ikke plass, stikker det heller
   litt utenfor pulten. Navn med mellomrom kan brytes ved mellomrommet. */
function tilpassNavn() {
  document.querySelectorAll('#kart .plass .navn').forEach((n) => {
    n.style.fontSize = '';
    n.classList.add('passer');
    const p = getComputedStyle(n.parentElement);
    const ledig =
      n.parentElement.clientWidth -
      parseFloat(p.paddingLeft) -
      parseFloat(p.paddingRight);
    let s = parseFloat(getComputedStyle(n).fontSize);
    while (n.offsetWidth > ledig && s > 8) {
      s -= 0.5;
      n.style.fontSize = s + 'px';
    }
  });
}
/* Kartet kan få ny bredde uten at vinduet gjør det (f.eks. når det vises
   etter klasseoversikten), og da må navnene måles på nytt. Bare endret
   bredde teller, så ikke målingen selv setter i gang en ny. */
let kartbredde = 0;
new ResizeObserver(([e]) => {
  const b = Math.round(e.contentRect.width);
  if (b === kartbredde) return;
  kartbredde = b;
  tilpassNavn();
}).observe($('kart'));
let breddetimer = null;
window.addEventListener('resize', () => {
  clearTimeout(breddetimer);
  breddetimer = setTimeout(() => tilpassBredde(), 120);
});
// navnene ble kanskje målt med reserveskriften før Atkinson var lastet
document.fonts.addEventListener('loadingdone', () => tilpassNavn());
window.addEventListener('beforeprint', () => tilpassBredde(1010));
window.addEventListener('afterprint', () => tilpassBredde());

let romModus = false,
  visning = false;
function tegn(meldinger) {
  avvelgPult(); // pultene tegnes på nytt, så et påbegynt bytte gjelder ikke
  ryddPlasser();
  const dato = new Date().toLocaleDateString('no-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  $('tittel').textContent = 'Klassekart ' + D.aktiv.klasse;
  $('tittelRom').textContent = ' · ' + D.aktiv.rom + ' · ' + dato;

  const kart = $('kart');
  kart.innerHTML = '';
  kart.classList.toggle('redigerer', romModus);
  const speil = D.aktiv.speil && !romModus;
  kart.classList.toggle('speilet', speil);
  const tavle = document.createElement('div');
  tavle.className = 'tavle';
  tavle.textContent = 'Tavle';
  const pulter = document.createElement('div');
  pulter.className = 'pulter';
  const rader = rommet().rader;
  const ri = rader.map((_, i) => i);
  (speil ? ri.slice().reverse() : ri).forEach((r) => {
    const radEl = document.createElement('div');
    radEl.className = 'pultrad';
    const gi = rader[r].map((_, i) => i);
    (speil ? gi.slice().reverse() : gi).forEach((g) => {
      const gr = document.createElement('div');
      gr.className = 'gruppe';
      const pi = [];
      for (let i = 0; i < rader[r][g]; i++) pi.push(i);
      (speil ? pi.reverse() : pi).forEach((i) =>
        gr.appendChild(lagPlass(r, g, i)),
      );
      if (!romModus) return radEl.appendChild(gr);
      const boks = document.createElement('div');
      boks.className = 'gruppe-boks';
      boks.appendChild(gr);
      boks.appendChild(
        ktrl([
          [
            '−',
            'Fjern en pult',
            () => endreRom((S) => fjernPult(S, r, g)),
          ],
          [
            '+',
            'Legg til en pult',
            () => endreRom((S) => S[r][g].push(null)),
          ],
        ]),
      );
      radEl.appendChild(boks);
    });
    if (romModus) {
      const k = ktrl([
        [
          '+ gruppe',
          'Ny pultgruppe i raden',
          () => endreRom((S) => S[r].push([null, null])),
        ],
        [
          '× rad',
          'Fjern raden',
          () => endreRom((S) => S.length > 1 && S.splice(r, 1)),
        ],
      ]);
      k.classList.add('rad-ktrl');
      radEl.appendChild(k);
    }
    pulter.appendChild(radEl);
  });
  if (romModus) {
    const k = ktrl([
      [
        '+ Legg til rad',
        'Ny rad bakerst',
        () =>
          endreRom((S) =>
            S.push(S[S.length - 1].map((g) => g.map(() => null))),
          ),
      ],
    ]);
    k.classList.add('ny-rad');
    pulter.appendChild(k);
  }
  if (speil) {
    kart.appendChild(pulter);
    kart.appendChild(tavle);
  } else {
    kart.appendChild(tavle);
    kart.appendChild(pulter);
  }

  tilpassBredde(romModus ? (kart.clientWidth || 900) - 90 : 0);
  visMelding(meldinger);
  tegnPanel();
  lagre();
}
function ktrl(knapper) {
  const d = document.createElement('div');
  d.className = 'ktrl';
  knapper.forEach(([tekst, tittel, fn]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = tekst;
    b.title = tittel;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      fn();
    });
    d.appendChild(b);
  });
  return d;
}

/* Endrer pultoppsettet og flytter elever og sperrede pulter med.
   S er rader → grupper → gamle pultnøkler (null for nye pulter). */
function endreRom(endring) {
  const R = rommet();
  const S = R.rader.map((rad, r) =>
    rad.map((n, g) =>
      Array.from({ length: n }, (_, i) => nokkel(r, g, i)),
    ),
  );
  endring(S);
  const rent = S.map((rad) => rad.filter((g) => g.length)).filter(
    (rad) => rad.length,
  );
  const antPulter = rent.flat().reduce((sum, g) => sum + g.length, 0);
  if (antPulter > MAKS_PULTER && antPulter > seter().length)
    return grensePulter();
  if (!rent.length) rent.push([[null, null]]);
  const ny = {};
  rent.forEach((rad, r) =>
    rad.forEach((g, gi) =>
      g.forEach((gammel, i) => {
        if (gammel) ny[gammel] = nokkel(r, gi, i);
      }),
    ),
  );
  const flytt = (k) => ny[k];
  R.rader = rent.map((rad) => rad.map((g) => g.length));
  R.sperret = R.sperret.map(flytt).filter(Boolean);
  const plasser = {};
  Object.entries(D.aktiv.plasser).forEach(([k, id]) => {
    if (ny[k]) plasser[ny[k]] = id;
  });
  D.aktiv.plasser = plasser;
  D.aktiv.laaste = D.aktiv.laaste.map(flytt).filter(Boolean);
  const farger = {};
  Object.entries(D.aktiv.farger).forEach(([k, f]) => {
    if (ny[k]) farger[ny[k]] = f;
  });
  D.aktiv.farger = farger;
  tegn();
}
function fjernPult(S, r, g) {
  S[r][g].pop();
}
/* Bilde av rommene når redigeringen starter, så den kan avbrytes */
let romBilde = null;
function tattRomBilde() {
  const a = D.aktiv;
  return {
    rom: kopi(D.rom),
    aktiv: {
      rom: a.rom,
      plasser: kopi(a.plasser),
      laaste: kopi(a.laaste),
      farger: kopi(a.farger),
    },
    kart: Object.fromEntries(
      Object.entries(D.kart).map(([n, k]) => [n, k.rom]),
    ),
    sist: Object.fromEntries(
      Object.entries(D.klasser)
        .filter(([, k]) => k.sist)
        .map(([n, k]) => [n, k.sist.rom]),
    ),
    romkart: Object.fromEntries(
      Object.entries(D.klasser).map(([n, k]) => [n, kopi(k.romkart || {})]),
    ),
  };
}
function gjenopprettRomBilde(b) {
  D.rom = b.rom;
  Object.assign(D.aktiv, b.aktiv);
  Object.entries(b.kart).forEach(([n, r]) => {
    if (D.kart[n]) D.kart[n].rom = r;
  });
  Object.entries(b.sist).forEach(([n, r]) => {
    if (D.klasser[n] && D.klasser[n].sist) D.klasser[n].sist.rom = r;
  });
  Object.entries(b.romkart).forEach(([n, rk]) => {
    if (D.klasser[n]) D.klasser[n].romkart = rk;
  });
}
function settRomModus(paa) {
  if (paa && D.aktiv.rom === STANDARDROM) return;
  if (paa && malerModus) settMalerModus(false);
  if (paa && !romBilde) romBilde = tattRomBilde();
  if (!paa) romBilde = null;
  romModus = paa;
  lukkPanel();
  $('verktoy').hidden = paa;
  $('romverktoy').hidden = !paa;
  if (paa) $('romnavn').value = D.aktiv.rom;
  tegn();
}

/* På berøringsskjerm flyttes elever med to trykk: det første velger
   eleven, det neste bytter med en annen pult (eller flytter til en tom).
   Et nytt trykk på samme elev åpner pultpanelet. Med mus brukes dra og
   slipp, og et klikk åpner panelet som før. */
let valgtPult = null;
const beroring = () => matchMedia('(pointer: coarse)').matches;
function byttPlasser(fra, til) {
  lagreAngre();
  const a = D.aktiv.plasser[fra] || null,
    b = D.aktiv.plasser[til] || null;
  if (b) D.aktiv.plasser[fra] = b;
  else delete D.aktiv.plasser[fra];
  if (a) D.aktiv.plasser[til] = a;
  else delete D.aktiv.plasser[til];
  tegn();
}
function avvelgPult() {
  if (!valgtPult) return;
  valgtPult = null;
  document.querySelectorAll('#kart .plass.valgt').forEach((p) => {
    p.classList.remove('valgt');
    p.removeAttribute('aria-pressed');
  });
  $('beskjed').hidden = true;
}
// svarer true når trykket er tatt hånd om, false når panelet skal åpnes
function trykkPult(k, el) {
  const fra = valgtPult;
  if (fra === k) {
    avvelgPult();
    return false;
  }
  if (fra) {
    avvelgPult();
    if (!erSperret(k)) byttPlasser(fra, k);
    return true;
  }
  const e = elevMed(D.aktiv.plasser[k]);
  if (!e) return false; // tom eller sperret pult: panelet som før
  lukkPanel();
  valgtPult = k;
  el.classList.add('valgt');
  el.setAttribute('aria-pressed', 'true');
  visBeskjed(
    e.navn +
      ' er valgt. Trykk på pulten ' +
      e.navn +
      ' skal flytte til, eller på ' +
      e.navn +
      ' igjen for flere valg.',
  );
  return true;
}

function lagPlass(r, g, i) {
  const k = nokkel(r, g, i);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'plass';
  el.dataset.k = k;
  if (erSperret(k)) {
    el.classList.add('sperret');
    el.setAttribute('aria-label', 'Sperret pult');
    el.title = 'Sperret pult';
  } else {
    const e = elevMed(D.aktiv.plasser[k]);
    if (e) {
      const n = document.createElement('span');
      n.className =
        'navn' +
        (e.navn.length > 14
          ? ' svaert-lang'
          : e.navn.length > 10
            ? ' lang'
            : '');
      n.textContent = e.navn;
      el.appendChild(n);
      el.draggable = !romModus && !malerModus && !visning;
    } else {
      el.classList.add('tom');
      el.textContent = '';
    }
    if (erLaast(k)) {
      el.classList.add('laast');
      const naal = document.createElement('span');
      naal.className = 'naal';
      naal.textContent = 'låst';
      el.appendChild(naal);
    }
  }
  const f = D.aktiv.farger[k];
  if (f !== undefined && !erSperret(k)) {
    el.classList.add('farget');
    el.style.setProperty('--gf', FARGER[f].hex);
    el.title = 'Gruppe ' + FARGER[f].navn.toLowerCase();
  }
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (visning) return;
    if (romModus) sperrPult(k);
    else if (malerModus) malPult(k);
    else if (!beroring() || !trykkPult(k, el)) apnePanel(k, el);
  });
  el.addEventListener('dragstart', (ev) => {
    avvelgPult();
    ev.dataTransfer.setData('text/plain', k);
    ev.dataTransfer.effectAllowed = 'move';
    el.classList.add('dratt');
  });
  el.addEventListener('dragend', () => el.classList.remove('dratt'));
  el.addEventListener('dragover', (ev) => {
    ev.preventDefault();
    el.classList.add('maal');
  });
  el.addEventListener('dragleave', () => el.classList.remove('maal'));
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    el.classList.remove('maal');
    const fra = ev.dataTransfer.getData('text/plain');
    if (!fra || fra === k || erSperret(k)) return;
    byttPlasser(fra, k);
  });
  return el;
}

function visMelding(ekstra) {
  const boks = $('melding');
  const linjer = (ekstra || []).slice();
  const plassert = new Set(Object.values(D.aktiv.plasser));
  const ute = elever().filter((e) => !plassert.has(e.id));
  if (ute.length && plassert.size)
    linjer.unshift('Uten plass: ' + ute.map((e) => e.navn).join(', '));
  const ledige = seter().length - rommet().sperret.length;
  if (ledige < elever().length)
    linjer.unshift(
      'Rommet har ' +
        ledige +
        ' pulter, men klassen har ' +
        elever().length +
        ' elever. Velg et annet rom eller trykk «Endre rommet».',
    );
  if (!linjer.length) {
    boks.hidden = true;
    return;
  }
  boks.hidden = false;
  boks.innerHTML =
    '<strong>Merk</strong><ul>' +
    linjer.map((l) => '<li>' + esc(l) + '</li>').join('') +
    '</ul>';
}
const esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

/* ============ pultpanel ============ */
let apent = null;
const lukkPanel = () => {
  avvelgPult(); // et trykk utenfor avbryter også et påbegynt bytte
  if (apent) {
    apent.remove();
    apent = null;
  }
};
document.addEventListener('click', lukkPanel);
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return; // dialogene håndterer Esc selv
  if (e.key === 'Escape' && !$('gruppedialog').hidden)
    return lukkGrupper();
  if (e.key === 'Escape') {
    lukkPanel();
    if (visning) settVisning(false);
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    e.key === 'z' &&
    !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
  ) {
    e.preventDefault();
    angre();
  }
});
function apnePanel(k, el) {
  lukkPanel();
  const boks = document.createElement('div');
  boks.className = 'popup';
  boks.addEventListener('click', (e) => e.stopPropagation());
  const h = document.createElement('h3');
  h.textContent = Number(k.split('-')[0]) + 1 + '. rad';
  boks.appendChild(h);

  const sperret = erSperret(k),
    laast = erLaast(k);
  const brukt = new Set(
    Object.entries(D.aktiv.plasser)
      .filter(([nk]) => nk !== k)
      .map(([, v]) => v),
  );
  const velg = document.createElement('select');
  velg.innerHTML =
    '<option value="">— ledig —</option>' +
    elever()
      .map(
        (e) =>
          '<option value="' +
          e.id +
          '"' +
          (e.id === D.aktiv.plasser[k] ? ' selected' : '') +
          '>' +
          esc(e.navn) +
          (brukt.has(e.id) ? ' (sitter alt)' : '') +
          '</option>',
      )
      .join('');
  velg.disabled = sperret;
  const fargerad = document.createElement('div');
  fargerad.className = 'farger';
  if (!sperret)
    fargeknapper(fargerad, D.aktiv.farger[k], (f) => {
      lagreAngre();
      if (f === null) delete D.aktiv.farger[k];
      else D.aktiv.farger[k] = f;
      tegn();
      lukkPanel();
    });
  velg.addEventListener('change', () => {
    lagreAngre();
    const id = velg.value || null;
    if (id)
      Object.keys(D.aktiv.plasser).forEach((nk) => {
        if (D.aktiv.plasser[nk] === id) delete D.aktiv.plasser[nk];
      });
    if (id) D.aktiv.plasser[k] = id;
    else delete D.aktiv.plasser[k];
    tegn();
    lukkPanel();
  });
  boks.appendChild(velg);

  const rad = document.createElement('div');
  rad.className = 'knapprad';
  const bLaas = document.createElement('button');
  bLaas.className = 'knapp' + (laast ? ' aktiv' : '');
  bLaas.textContent = laast ? 'Lås opp' : 'Lås plassen';
  bLaas.disabled = sperret;
  bLaas.addEventListener('click', () => {
    D.aktiv.laaste = laast
      ? D.aktiv.laaste.filter((x) => x !== k)
      : D.aktiv.laaste.concat(k);
    tegn();
    lukkPanel();
  });
  const bSperr = document.createElement('button');
  bSperr.className = 'knapp' + (sperret ? ' aktiv' : '');
  bSperr.textContent = sperret ? 'Åpne pulten' : 'Sperr pulten';
  bSperr.addEventListener('click', () => {
    sperrPult(k);
    lukkPanel();
  });
  rad.appendChild(bLaas);
  rad.appendChild(bSperr);
  if (!sperret) boks.appendChild(fargerad);
  boks.appendChild(rad);

  visPopup(boks, el, 'midt');
  velg.focus();
}
function sperrPult(k) {
  const R = rommet();
  if (erSperret(k)) R.sperret = R.sperret.filter((x) => x !== k);
  else {
    R.sperret = R.sperret.concat(k);
    delete D.aktiv.plasser[k];
    D.aktiv.laaste = D.aktiv.laaste.filter((x) => x !== k);
  }
  tegn();
}
function visPopup(boks, el, justering) {
  document.body.appendChild(boks);
  const r = el.getBoundingClientRect(),
    b = boks.getBoundingClientRect();
  let v =
    justering === 'hoyre'
      ? r.right - b.width
      : justering === 'venstre'
        ? r.left
        : r.left + r.width / 2 - b.width / 2;
  v = Math.max(8, Math.min(v, window.innerWidth - b.width - 8));
  let t = r.bottom + window.scrollY + 6;
  if (r.bottom + b.height + 20 > window.innerHeight && r.top > b.height)
    t = r.top + window.scrollY - b.height - 6;
  boks.style.left = v + window.scrollX + 'px';
  boks.style.top = t + 'px';
  apent = boks;
}
/* Nedtrekksmeny under en knapp. bygg(boks) fyller den. */
function apneMeny(knapp, bygg, justering) {
  const varApen = apent && apent.dataset.knapp === knapp.id;
  lukkPanel();
  if (varApen) return; // et nytt klikk lukker menyen
  const boks = document.createElement('div');
  boks.className = 'popup meny';
  boks.dataset.knapp = knapp.id;
  boks.addEventListener('click', (e) => e.stopPropagation());
  bygg(boks);
  visPopup(boks, knapp, justering || 'venstre');
}
function menyvalg(boks, tekst, fn, fare) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'menyvalg' + (fare ? ' fare' : '');
  b.textContent = tekst;
  b.addEventListener('click', () => {
    lukkPanel();
    fn();
  });
  boks.appendChild(b);
  return b;
}
function menyinfo(boks, tekst) {
  const p = document.createElement('p');
  p.className = 'menyinfo';
  p.textContent = tekst;
  boks.appendChild(p);
}
let beskjedTimer = null;
/* knapper: [[tekst, fn], …] vises i beskjeden, som da står lenger */
function visBeskjed(tekst, varsel, knapper) {
  const b = $('beskjed');
  b.textContent = tekst;
  b.className = 'beskjed' + (varsel ? ' varsel' : '');
  if (knapper) {
    const rad = document.createElement('span');
    rad.className = 'beskjed-knapper';
    knapper.forEach(([t, fn]) => {
      const k = document.createElement('button');
      k.type = 'button';
      k.textContent = t;
      k.addEventListener('click', (e) => {
        e.stopPropagation();
        b.hidden = true;
        fn();
      });
      rad.appendChild(k);
    });
    b.appendChild(rad);
  }
  b.hidden = false;
  clearTimeout(beskjedTimer);
  beskjedTimer = setTimeout(
    () => (b.hidden = true),
    knapper ? 10000 : varsel ? 7000 : 3500,
  );
}

/* Egne dialoger i stedet for alert, confirm og prompt. De står i kø,
   så det aldri er to åpne samtidig. svar === null betyr uten tekstfelt. */
let dialogKo = Promise.resolve();
function dialog({
  tekst,
  svar = null,
  type = 'text',
  ok = 'OK',
  avbryt = 'Avbryt',
  fare = false,
  forslag = [],
}) {
  const neste = dialogKo.then(
    () =>
      new Promise((ferdig) => {
        const d = $('sporsmal'),
          inp = $('sporsmalSvar'),
          bOk = $('sporsmalOk'),
          bAvbryt = $('sporsmalAvbryt');
        $('sporsmalTekst').textContent = tekst;
        inp.hidden = svar === null;
        inp.type = type;
        inp.value = svar || '';
        bOk.textContent = ok;
        bOk.classList.toggle('fare', fare);
        bAvbryt.hidden = !avbryt;
        bAvbryt.textContent = avbryt || '';
        // forslag fyller tekstfeltet med ett trykk
        const fb = $('sporsmalForslag');
        fb.replaceChildren();
        fb.hidden = !forslag.length;
        forslag.forEach((f) => {
          const k = document.createElement('button');
          k.type = 'button';
          k.textContent = f;
          k.addEventListener('click', () => {
            inp.value = f;
            inp.focus();
          });
          fb.appendChild(k);
        });
        d.returnValue = '';
        d.addEventListener(
          'close',
          () => {
            const ja = d.returnValue === 'ok';
            if (svar === null) ferdig(ja);
            else ferdig(ja ? inp.value : null);
          },
          { once: true },
        );
        d.showModal();
        if (svar !== null) inp.select();
        else (fare ? bAvbryt : bOk).focus();
      }),
  );
  dialogKo = neste;
  return neste;
}
const melding = (tekst) => dialog({ tekst, avbryt: null });
const bekreft = (tekst, ok, fare) => dialog({ tekst, ok, fare });
const sporOm = (tekst, svar = '', type) => dialog({ tekst, svar, type });
$('sporsmalAvbryt').addEventListener('click', () => $('sporsmal').close());
$('sporsmal').addEventListener('click', (e) => {
  // ikke la klikket lukke sidepanelet bak dialogen
  e.stopPropagation();
  if (e.target === e.currentTarget) e.currentTarget.close();
});

/* ============ sidepanel ============ */
let apenElev = null;

function tegnPanel() {
  const sel = $('velgRom');
  fyll(sel, Object.keys(D.rom).sort(sammenlign), D.aktiv.rom);
  const nytt = document.createElement('option');
  nytt.value = '';
  nytt.textContent = '+ Nytt rom …';
  sel.appendChild(nytt);

  $('endreRom').title =
    D.aktiv.rom === STANDARDROM
      ? 'Standardrommet kan ikke endres. Du kan lage en kopi og endre den.'
      : '';
  $('speil').setAttribute('aria-pressed', !!D.aktiv.speil);
  const antKart = kartForKlasse().length;
  $('tidligere').textContent =
    'Lagrede kart' + (antKart ? ' (' + antKart + ')' : '');

  if (romModus) {
    const antall = seter().length,
      sperret = rommet().sperret.length;
    $('plasstatus').textContent =
      rommet().rader.length +
      ' rader · ' +
      (antall - sperret) +
      ' pulter' +
      (sperret ? ' (+' + sperret + ' sperret)' : '');
    if (document.activeElement !== $('romnavn'))
      $('romnavn').value = D.aktiv.rom;
    const eier = rommet()._eier;
    $('slettRom').hidden = iSky() && eier && eier !== sky.id;
    $('romhjelp').textContent =
      'Bruk − og + for pulter, og klikk på en pult for å sperre den.' +
      (iSky()
        ? ' Rommet deles med kollegene dine, så endringer gjelder for alle.'
        : '');
  }

  $('elevtelling').textContent = 'Elever (' + elever().length + ')';
  $('stripetekst').textContent = 'Elever (' + elever().length + ')';
  tegnElevliste();
}
const sammenlign = (a, b) =>
  a.localeCompare(b, 'no', { numeric: true, sensitivity: 'base' });
function fyll(sel, navn, valgt) {
  sel.innerHTML = navn
    .map(
      (n) =>
        '<option' +
        (n === valgt ? ' selected' : '') +
        '>' +
        esc(n) +
        '</option>',
    )
    .join('');
}

function klasseforslag() {
  return [...new Set(elever().map((e) => e.gruppe).filter(Boolean))].sort(
    sammenlign,
  );
}
function tegnElevliste() {
  $('klasseforslag').innerHTML = klasseforslag()
    .map((g) => '<option value="' + esc(g) + '"></option>')
    .join('');
  const boks = $('elevliste');
  boks.innerHTML = '';
  const tomt = $('tomliste');
  if (tomt) tomt.hidden = elever().length > 0;
  elever().forEach((e) => {
    const rad = document.createElement('div');
    rad.className = 'elevrad';

    const navn = document.createElement('span');
    navn.className = 'elevnavn';
    navn.textContent = e.navn;
    navn.title = 'Klikk for å endre navn';
    navn.addEventListener('click', async () => {
      const nytt = await sporOm('Nytt navn', e.navn);
      if (nytt && nytt.trim()) {
        e.navn = nytt.trim();
        tegn();
      }
    });

    rad.appendChild(navn);
    if (e.gruppe) {
      const m = document.createElement('span');
      m.className = 'merkelapp';
      m.textContent = e.gruppe;
      rad.appendChild(m);
    }
    const kj = document.createElement('button');
    kj.type = 'button';
    kj.className = 'kjonn' + (e.kjonn ? ' satt' : '');
    kj.textContent = e.kjonn ? e.kjonn.toUpperCase() : 'G/J';
    kj.title = 'Kjønn: klikk for å bytte mellom gutt, jente og ikke satt';
    kj.addEventListener('click', () => {
      e.kjonn = e.kjonn === 'g' ? 'j' : e.kjonn === 'j' ? null : 'g';
      tegn();
    });
    const antRegler =
      (e.sone !== 'fri' ? 1 : 0) + e.sammen.length + e.unna.length;
    if (antRegler) {
      const m = document.createElement('span');
      m.className = 'merkelapp regel';
      m.textContent = antRegler + ' regel' + (antRegler > 1 ? 'er' : '');
      rad.appendChild(m);
    }

    rad.appendChild(kj);
    const knapp = document.createElement('button');
    knapp.className = 'knapp liten';
    knapp.textContent = '⚙';
    knapp.title = 'Regler for eleven';
    knapp.addEventListener('click', () => {
      apenElev = apenElev === e.id ? null : e.id;
      tegnElevliste();
    });
    rad.appendChild(knapp);

    boks.appendChild(rad);

    if (apenElev === e.id) boks.appendChild(regelboks(e));
  });
}

function regelboks(e) {
  const b = document.createElement('div');
  b.className = 'regelboks';

  b.appendChild(overskrift('Klasse'));
  const kl = document.createElement('input');
  kl.type = 'text';
  kl.setAttribute('list', 'klasseforslag');
  kl.placeholder = 'F.eks. 2STA';
  kl.value = e.gruppe || '';
  kl.addEventListener('change', () => {
    e.gruppe = kl.value.trim() || null;
    tegn();
  });
  b.appendChild(kl);
  b.appendChild(
    hint('Brukes når du velger å spre elever fra samme klasse.'),
  );

  b.appendChild(overskrift('Hvor i rommet'));
  b.appendChild(
    segment(
      [
        ['Fritt', 'fri'],
        ['Foran', 'foran'],
        ['Bakerst', 'bak'],
      ],
      e.sone,
      (v) => {
        e.sone = v;
        tegn();
      },
    ),
  );
  const gs = sonegrenser();
  b.appendChild(
    hint(
      'Foran = rad 1–' +
        (gs.foranMaks + 1) +
        ', bakerst = rad ' +
        (gs.bakMin + 1) +
        '–' +
        rommet().rader.length +
        ' i dette rommet.',
    ),
  );

  b.appendChild(overskrift('Skal sitte ved siden av'));
  b.appendChild(relasjon(e, 'sammen'));
  b.appendChild(overskrift('Skal ikke sitte ved siden av'));
  b.appendChild(relasjon(e, 'unna'));
  b.appendChild(
    hint(
      'Naboer er pulter i samme gruppe. Over en midtgang teller ikke som ved siden av.',
    ),
  );
  const fjern = document.createElement('button');
  fjern.className = 'knapp fjern';
  fjern.textContent = 'Fjern ' + e.navn + ' fra klassen';
  fjern.addEventListener('click', async () => {
    const sp = 'Fjerne ' + e.navn + ' fra klassen?';
    if (!(await bekreft(sp, 'Fjern', true))) return;
    const k = klasse();
    k.elever = k.elever.filter((x) => x.id !== e.id);
    k.elever.forEach((x) => {
      x.sammen = x.sammen.filter((i) => i !== e.id);
      x.unna = x.unna.filter((i) => i !== e.id);
    });
    Object.keys(D.aktiv.plasser).forEach((nk) => {
      if (D.aktiv.plasser[nk] === e.id) delete D.aktiv.plasser[nk];
    });
    apenElev = null;
    tegn();
  });
  b.appendChild(fjern);
  return b;
}
function overskrift(t) {
  const h = document.createElement('h4');
  h.textContent = t;
  return h;
}
function hint(t) {
  const p = document.createElement('p');
  p.className = 'hjelp';
  p.textContent = t;
  return p;
}
function segment(valg, aktiv, cb) {
  const d = document.createElement('div');
  d.className = 'segment';
  valg.forEach(([tekst, verdi]) => {
    const k = document.createElement('button');
    k.className =
      'knapp' +
      (aktiv === verdi || (verdi === null && !aktiv) ? ' paa' : '');
    k.textContent = tekst;
    k.addEventListener('click', () => cb(verdi));
    d.appendChild(k);
  });
  return d;
}
function relasjon(e, felt) {
  const d = document.createElement('div');
  const brikker = document.createElement('div');
  brikker.className = 'brikker';
  e[felt].forEach((id) => {
    const a = elevMed(id);
    if (!a) return;
    const br = document.createElement('span');
    br.className = 'brikke';
    br.appendChild(document.createTextNode(a.navn));
    const x = document.createElement('button');
    x.textContent = '×';
    x.title = 'Fjern';
    x.addEventListener('click', () => {
      e[felt] = e[felt].filter((i) => i !== id);
      a[felt] = a[felt].filter((i) => i !== e.id);
      tegn();
    });
    br.appendChild(x);
    brikker.appendChild(br);
  });
  if (e[felt].length) d.appendChild(brikker);

  const sel = document.createElement('select');
  const andre = elever().filter(
    (x) => x.id !== e.id && !e[felt].includes(x.id),
  );
  sel.innerHTML =
    '<option value="">+ legg til …</option>' +
    andre
      .map(
        (x) =>
          '<option value="' + x.id + '">' + esc(x.navn) + '</option>',
      )
      .join('');
  sel.style.marginTop = '5px';
  sel.addEventListener('change', () => {
    const a = elevMed(sel.value);
    if (!a) return;
    e[felt] = e[felt].concat(a.id);
    a[felt] = a[felt].concat(e.id);
    const motsatt = felt === 'sammen' ? 'unna' : 'sammen';
    e[motsatt] = e[motsatt].filter((i) => i !== a.id);
    a[motsatt] = a[motsatt].filter((i) => i !== e.id);
    tegn();
  });
  d.appendChild(sel);
  return d;
}

/* ============ verktøylinje ============ */
const vedKlikk = (id, fn) =>
  $(id).addEventListener('click', (e) => {
    e.stopPropagation();
    fn(e);
  });
vedKlikk('trekk', trekkPlassering);
vedKlikk('angre', angre);
vedKlikk('tomKart', () => {
  const sikret = sikreKart('tømming');
  if (sikret)
    visBeskjed('Kartet er tømt. Det forrige er lagret som «' + sikret + '».', false, [
      ['Angre', angre],
    ]);
  lagreAngre();
  D.aktiv.plasser = {};
  D.aktiv.laaste = [];
  tegn();
});
vedKlikk('trekkValg', () =>
  apneMeny($('trekkValg'), (boks) => {
    const valg = (tekst, felt) => {
      const l = document.createElement('label');
      l.className = 'bryter';
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = !!D.aktiv[felt];
      c.addEventListener('change', () => {
        D.aktiv[felt] = c.checked;
        lagre();
      });
      l.appendChild(c);
      l.appendChild(document.createTextNode(' ' + tekst));
      boks.appendChild(l);
    };
    valg('Fordel gutter og jenter jevnt', 'spre');
    if (klasseforslag().length > 1)
      valg('Spre elever fra samme klasse', 'spreKlasse');
    valg('Unngå naboer fra tidligere kart', 'nyeNaboer');
    valg('Del inn i makkergrupper etter trekningen', 'makker');
    const h = document.createElement('p');
    h.className = 'hjelp';
    h.textContent =
      'Tidligere naboer hentes fra de tre siste kartene du har brukt. «Spre elever fra samme klasse» bruker klassen som står bak hvert elevnavn, slik at elever fra ulike klasser blir kjent. Makkergrupper er 3–5 elever som sitter nær hverandre. Låste pulter blir stående.';
    boks.appendChild(h);
  }),
);
vedKlikk('speil', () => {
  D.aktiv.speil = !D.aktiv.speil;
  tegn();
});
function settVisning(paa) {
  visning = paa;
  lukkPanel();
  document.body.classList.toggle('visning', paa);
  $('lukkVisning').hidden = !paa;
  const fs = document.fullscreenElement;
  if (paa && !fs && document.documentElement.requestFullscreen)
    document.documentElement.requestFullscreen().catch(() => {});
  if (!paa && fs) document.exitFullscreen().catch(() => {});
  tegn();
}
/* Elevlisten kan skjules så kartet får mer plass. Valget huskes bare
   i denne nettleseren. */
const SKJUL_ELEVER = 'klassekart:skjulElever';
function settElevliste(vis) {
  document.querySelector('.app').classList.toggle('uten-elever', !vis);
  $('visElever').hidden = vis;
  try {
    if (vis) localStorage.removeItem(SKJUL_ELEVER);
    else localStorage.setItem(SKJUL_ELEVER, '1');
  } catch (err) {}
  tilpassBredde();
}
vedKlikk('skjulElever', () => settElevliste(false));
vedKlikk('visElever', () => settElevliste(true));
try {
  if (localStorage.getItem(SKJUL_ELEVER)) settElevliste(false);
} catch (err) {}
vedKlikk('visKlassen', () => settVisning(true));
// mobil: knappene som ikke får plass i verktøylinjen
vedKlikk('merKnapp', () =>
  apneMeny(
    $('merKnapp'),
    (boks) => {
      menyvalg(boks, 'Lagre kartet …', lagreKartSom);
      menyvalg(
        boks,
        (D.aktiv.speil ? '✓ ' : '') + 'Sett fra tavla',
        () => $('speil').click(),
      );
      menyvalg(boks, 'Vis for klassen', () => settVisning(true));
      menyvalg(boks, 'Skriv ut', () => $('skrivut').click());
    },
    'hoyre',
  ),
);
vedKlikk('lukkVisning', () => settVisning(false));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && visning) settVisning(false);
});
vedKlikk('skrivut', () => {
  lagreKart(ukenavn(), true); // et utskrevet kart er tatt i bruk
  window.print();
});


/* ---- lagrede kart ----
   Kartet man jobber med, lagres alltid av seg selv (romkart). I tillegg
   kan man lagre kart med navn, og appen lagrer selv en kopi (auto) før
   en trekning, tømming eller et annet kart erstatter et kart man har
   ordnet for hånd. Bare kart man lagrer selv, huskes til «nye naboer». */
const MAKS_LAGREDE = 30,
  MAKS_AUTO = 5;
// auto: true/false gir bare de automatiske/de man har lagret selv
const kartForKlasse = (auto) =>
  Object.entries(D.kart)
    .filter(
      ([, x]) =>
        x.klasse === D.aktiv.klasse &&
        (auto === undefined || !!x.auto === auto),
    )
    .sort((a, b) => (b[1].endret || '').localeCompare(a[1].endret || ''));
const avtrykk = (p) => JSON.stringify(Object.entries(p || {}).sort());
const sammePlasser = (a, b) => avtrykk(a) === avtrykk(b);
const erDetteKartet = (x) =>
  x.rom === D.aktiv.rom &&
  sammePlasser(x.plasser, D.aktiv.plasser) &&
  sammePlasser(x.farger || {}, D.aktiv.farger);
const klokka = (d) =>
  d.toLocaleTimeString('no-NO', { hour: '2-digit', minute: '2-digit' });
function ukenavn(d = new Date()) {
  // ISO-uke: uken med årets første torsdag er uke 1
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const nyttaar = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return 'Uke ' + Math.ceil(((t - nyttaar) / 864e5 + 1) / 7);
}
function kartTittel(x) {
  const d = new Date(x.endret || 0);
  const iAar = d.getFullYear() === new Date().getFullYear();
  return (
    d.toLocaleDateString('no-NO', {
      day: 'numeric',
      month: 'short',
      year: iAar ? undefined : 'numeric',
    }) +
    ' kl. ' +
    klokka(d)
  );
}
function leggTilKart(navn, auto) {
  const naa = new Date();
  let n = D.aktiv.klasse + ' · ' + naa.toISOString();
  while (D.kart[n]) n += '+';
  D.kart[n] = {
    klasse: D.aktiv.klasse,
    rom: D.aktiv.rom,
    plasser: kopi(D.aktiv.plasser),
    laaste: D.aktiv.laaste.slice(),
    farger: kopi(D.aktiv.farger),
    endret: naa.toISOString(),
    navn,
  };
  if (auto) D.kart[n].auto = true;
  kartForKlasse(!!auto)
    .slice(auto ? MAKS_AUTO : MAKS_LAGREDE)
    .forEach(([k]) => delete D.kart[k]);
  return n;
}
/* Før noe erstatter hele kartet: er det ordnet for hånd og ikke lagret,
   tas en automatisk kopi. Svarer med kopiens navn, eller null. */
function sikreKart(hva) {
  const a = D.aktiv;
  if (!Object.keys(a.plasser).length) return null;
  if (avtrykk(a.plasser) === a.trukket) return null; // urørt trekning
  if (
    kartForKlasse().some(
      ([, x]) => x.rom === a.rom && sammePlasser(x.plasser, a.plasser),
    )
  )
    return null;
  const navn = 'Før ' + hva + ' ' + klokka(new Date());
  leggTilKart(navn, true);
  return navn;
}
/* Lagrer kartet med navn, og husker naboene til neste trekning */
function lagreKart(navn, stille) {
  if (!Object.keys(D.aktiv.plasser).length) {
    if (!stille)
      visBeskjed(
        'Kartet er tomt – trekk eller plasser elever først.',
        true,
      );
    return false;
  }
  const siste = kartForKlasse(false)[0];
  if (siste && erDetteKartet(siste[1])) {
    if (stille) return false;
    siste[1].navn = navn;
    lagre();
    visBeskjed('Kartet var allerede lagret. Nå heter det «' + navn + '».');
    return true;
  }
  leggTilKart(navn, false);
  huskNaboer(); // lagrer og tegner
  if (!stille)
    visBeskjed(
      'Kartet er lagret som «' + navn + '». Neste trekning gir nye naboer.',
    );
  return true;
}
async function lagreKartSom() {
  if (!Object.keys(D.aktiv.plasser).length)
    return visBeskjed(
      'Kartet er tomt – trekk eller plasser elever først.',
      true,
    );
  const uke = ukenavn();
  const svar = await dialog({
    tekst:
      'Gi kartet et navn. Det havner under «Lagrede kart», og neste trekning gir nye naboer.',
    svar: uke,
    ok: 'Lagre',
    forslag: [uke, 'Prøvedag', 'Gruppearbeid'],
  });
  if (svar === null) return false;
  return lagreKart(svar.trim() || uke);
}
vedKlikk('brukKart', lagreKartSom);

function apneKart(n) {
  const x = D.kart[n];
  if (!x) return;
  $('lagrede').close();
  if (erDetteKartet(x)) return;
  const sikret = sikreKart('åpning');
  lagreAngre();
  if (D.rom[x.rom] && x.rom !== D.aktiv.rom) {
    huskOppsett();
    D.aktiv.rom = x.rom;
  }
  D.aktiv.plasser = kopi(x.plasser);
  D.aktiv.laaste = (x.laaste || []).slice();
  D.aktiv.farger = kopi(x.farger || {});
  D.aktiv.trukket = null;
  tegn();
  visBeskjed(
    'Hentet «' +
      (x.navn || kartTittel(x)) +
      '».' +
      (sikret ? ' Det forrige kartet er lagret som «' + sikret + '».' : ''),
    false,
    [['Angre', angre]],
  );
}
function apneLagrede() {
  lukkPanel();
  tegnLagrede();
  $('lagrede').showModal();
  $('lagredeLukk').focus();
}
function tegnLagrede() {
  const liste = $('lagredeListe');
  liste.replaceChildren();
  const alle = kartForKlasse();
  $('lagredeInfo').textContent =
    'Klasse ' +
    D.aktiv.klasse +
    (alle.length ? ' · ' + alle.length + ' kart, nyeste først' : '');
  if (!alle.length) {
    const p = document.createElement('p');
    p.className = 'hjelp';
    p.textContent =
      'Ingen lagrede kart ennå. Trykk «Lagre kartet slik det er nå» når du er fornøyd med et kart.';
    liste.appendChild(p);
    return;
  }
  const ids = new Set(elever().map((e) => e.id));
  const knapp = (tekst, klasse, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = klasse;
    b.textContent = tekst;
    b.addEventListener('click', fn);
    return b;
  };
  alle.forEach(([n, x]) => {
    const navn = x.navn || 'Lagret kart';
    const rad = document.createElement('div');
    rad.className = 'lagret';
    const mini = miniKart(x.rom, x.plasser, ids, x.farger);
    mini.setAttribute('aria-hidden', 'true');
    rad.appendChild(mini);

    const tekst = document.createElement('div');
    tekst.className = 'lagret-tekst';
    const topp = document.createElement('div');
    const s = document.createElement('strong');
    s.textContent = navn;
    topp.appendChild(s);
    const merke = (t, k) => {
      const m = document.createElement('span');
      m.className = 'merke ' + k;
      m.textContent = t;
      topp.appendChild(m);
    };
    if (erDetteKartet(x)) merke('I bruk nå', 'gronn');
    if (x.auto) merke('Automatisk', 'graa');
    const info = document.createElement('small');
    info.textContent =
      kartTittel(x) + ' · ' + (D.rom[x.rom] ? x.rom : x.rom + ' (slettet)');
    tekst.append(topp, info);
    rad.appendChild(tekst);

    const handlinger = document.createElement('div');
    handlinger.className = 'lagret-handlinger';
    handlinger.hidden = true;
    handlinger.append(
      knapp('Gi nytt navn', 'knapp liten', async () => {
        const ny = await sporOm('Nytt navn på kartet', navn);
        if (ny === null || !ny.trim()) return;
        x.navn = ny.trim();
        delete x.auto; // et kart man gir navn, vil man beholde
        lagre();
        tegnLagrede();
        tegnPanel();
      }),
      knapp('Slett', 'knapp liten fare', async () => {
        const sp = 'Slette «' + navn + '»?';
        if (!(await bekreft(sp, 'Slett', true))) return;
        delete D.kart[n];
        lagre();
        tegnLagrede();
        tegnPanel();
      }),
    );
    const mer = knapp('⋯', 'knapp liten mer', () => {
      handlinger.hidden = !handlinger.hidden;
      mer.setAttribute('aria-expanded', !handlinger.hidden);
    });
    mer.setAttribute('aria-label', 'Flere valg for ' + navn);
    mer.setAttribute('aria-expanded', 'false');
    rad.append(knapp('Åpne', 'knapp liten', () => apneKart(n)), mer, handlinger);
    liste.appendChild(rad);
  });
}
vedKlikk('tidligere', apneLagrede);
vedKlikk('lagredeLukk', () => $('lagrede').close());
vedKlikk('lagredeNy', async () => {
  if (await lagreKartSom()) tegnLagrede();
});
$('lagrede').addEventListener('click', (e) => {
  e.stopPropagation(); // ikke lukk sidepanelet bak
  if (e.target === e.currentTarget) e.currentTarget.close();
});
