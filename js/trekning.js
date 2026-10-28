/* Trekning av plasser etter reglene, angre og nabominne. */
'use strict';

/* ============ trekning ============ */
function sonegrenser() {
  const n = rommet().rader.length;
  return { foranMaks: n >= 4 ? 1 : 0, bakMin: n >= 4 ? n - 2 : n - 1 };
}
function byggCtx() {
  const s = seter();
  const gs = sonegrenser();
  const elevKart = new Map(elever().map((e) => [e.id, e]));
  const gamle = new Set();
  if (D.aktiv.nyeNaboer)
    klasse().historikk.forEach((sett) =>
      sett.forEach((p) => gamle.add(p)),
    );
  const sammenPar = [];
  elever().forEach((e) =>
    e.sammen.forEach((id) => {
      if (e.id < id && elevKart.has(id)) sammenPar.push([e.id, id]);
    }),
  );
  // tomme pulter helst bakerst: forsiden veier litt tyngre enn baksiden,
  // men aldri så mye at det slår regler eller spredning
  const aapne = s.filter((x) => !erSperret(x.k) && !erLaast(x.k));
  const tomVekt = new Map(
    aapne.map((x, i) => [x.k, 0.002 * (aapne.length - i)]),
  );
  return {
    seter: s,
    tomVekt,
    setekart: new Map(s.map((x) => [x.k, x])),
    par: naboPar(),
    elevKart,
    gamle,
    sammenPar,
    spre: D.aktiv.spre,
    spreKlasse: D.aktiv.spreKlasse,
    foranMaks: gs.foranMaks,
    bakMin: gs.bakMin,
  };
}
function evaluer(t, c) {
  let kost = 0;
  const naboAv = new Map();
  for (const [a, b] of c.par) {
    const ia = t[a],
      ib = t[b];
    if (!ia || !ib) continue;
    if (!naboAv.has(ia)) naboAv.set(ia, new Set());
    if (!naboAv.has(ib)) naboAv.set(ib, new Set());
    naboAv.get(ia).add(ib);
    naboAv.get(ib).add(ia);
    const ea = c.elevKart.get(ia),
      eb = c.elevKart.get(ib);
    if (!ea || !eb) continue;
    if (ea.unna.includes(ib) || eb.unna.includes(ia)) kost += 80;
    if (c.spre && ea.kjonn && eb.kjonn && ea.kjonn === eb.kjonn)
      kost += 3;
    if (c.spreKlasse && ea.gruppe && ea.gruppe === eb.gruppe) kost += 4;
    if (c.gamle.size && c.gamle.has(parN(ia, ib))) kost += 10;
  }
  for (const [a, b] of c.sammenPar) {
    const na = naboAv.get(a);
    if (!na || !na.has(b)) kost += 60;
  }
  for (const s of c.seter) {
    const id = t[s.k];
    if (!id) {
      kost += c.tomVekt.get(s.k) || 0;
      continue;
    }
    // ingen skal sitte uten nabo, så sant det lar seg gjøre
    if (!naboAv.has(id)) kost += 30;
    const e = c.elevKart.get(id);
    if (!e) continue;
    if (e.sone === 'foran' && s.r > c.foranMaks)
      kost += 100 + (s.r - c.foranMaks) * 10;
    if (e.sone === 'bak' && s.r < c.bakMin)
      kost += 100 + (c.bakMin - s.r) * 10;
  }
  return kost - (c.tomBase || 0);
}
function trekkPlassering() {
  const c = byggCtx();
  const laasteElever = new Set();
  D.aktiv.laaste.forEach((k) => {
    if (D.aktiv.plasser[k]) laasteElever.add(D.aktiv.plasser[k]);
  });

  const frie = c.seter
    .filter((s) => !erSperret(s.k) && !erLaast(s.k))
    .map((s) => s.k);
  const pool = elever()
    .filter((e) => !laasteElever.has(e.id))
    .map((e) => e.id);

  // billigste mulige tomplassering (de bakerste) regnes som null kost
  const antTom = Math.max(0, frie.length - pool.length);
  c.tomBase = frie
    .slice(frie.length - antTom)
    .reduce((sum, k) => sum + c.tomVekt.get(k), 0);

  const fast = {};
  D.aktiv.laaste.forEach((k) => {
    if (D.aktiv.plasser[k]) fast[k] = D.aktiv.plasser[k];
  });

  let beste = null,
    bestekost = Infinity;
  const runder = frie.length > 40 ? 14 : 26;
  for (let start = 0; start < runder; start++) {
    const t = Object.assign({}, fast);
    const p = stokk(pool);
    frie.forEach((k, i) => {
      t[k] = p[i] || null;
    });
    let kost = evaluer(t, c);
    let uten = 0;
    for (let it = 0; it < 4000 && kost > 1e-6; it++) {
      const a = frie[Math.floor(Math.random() * frie.length)];
      const b = frie[Math.floor(Math.random() * frie.length)];
      if (a === b) continue;
      const va = t[a],
        vb = t[b];
      if (!va && !vb) continue;
      t[a] = vb;
      t[b] = va;
      const ny = evaluer(t, c);
      if (ny < kost) {
        kost = ny;
        uten = 0;
      } else if (ny === kost) {
        uten++;
      } else {
        t[a] = va;
        t[b] = vb;
        uten++;
      }
      if (uten > 700) break;
    }
    if (kost < bestekost) {
      bestekost = kost;
      beste = Object.assign({}, t);
    }
    if (bestekost < 1e-6) break;
  }

  lagreAngre();
  D.aktiv.plasser = {};
  Object.entries(beste || {}).forEach(([k, v]) => {
    if (v) D.aktiv.plasser[k] = v;
  });
  if (D.aktiv.makker) lagMakkergrupper();
  tegn(brudd(c));
}
function brudd(c) {
  const t = D.aktiv.plasser,
    ut = [];
  const naboAv = new Map();
  for (const [a, b] of c.par) {
    const ia = t[a],
      ib = t[b];
    if (!ia || !ib) continue;
    if (!naboAv.has(ia)) naboAv.set(ia, new Set());
    if (!naboAv.has(ib)) naboAv.set(ib, new Set());
    naboAv.get(ia).add(ib);
    naboAv.get(ib).add(ia);
  }
  for (const [a, b] of c.sammenPar) {
    const na = naboAv.get(a);
    if (!na || !na.has(b))
      ut.push(
        navnAv(a) + ' og ' + navnAv(b) + ' fikk ikke sitte sammen.',
      );
  }
  for (const [a, b] of c.par) {
    const ia = t[a],
      ib = t[b];
    if (!ia || !ib) continue;
    const ea = c.elevKart.get(ia),
      eb = c.elevKart.get(ib);
    if (ea && eb && (ea.unna.includes(ib) || eb.unna.includes(ia)))
      ut.push(
        ea.navn +
          ' og ' +
          eb.navn +
          ' havnet ved siden av hverandre likevel.',
      );
  }
  if (c.spreKlasse) {
    let likeKlasser = 0;
    for (const [a, b] of c.par) {
      const ea = c.elevKart.get(t[a]),
        eb = c.elevKart.get(t[b]);
      if (ea && eb && ea.gruppe && ea.gruppe === eb.gruppe) likeKlasser++;
    }
    if (likeKlasser)
      ut.push(
        likeKlasser +
          ' nabopar fra samme klasse lot seg ikke skille.',
      );
  }
  for (const s of c.seter) {
    const id = t[s.k];
    if (!id) continue;
    if (!naboAv.has(id) && c.elevKart.has(id))
      ut.push(navnAv(id) + ' fikk ingen å sitte ved siden av.');
    const e = c.elevKart.get(id);
    if (!e) continue;
    if (e.sone === 'foran' && s.r > c.foranMaks)
      ut.push(e.navn + ' fikk ikke plass foran.');
    if (e.sone === 'bak' && s.r < c.bakMin)
      ut.push(e.navn + ' fikk ikke plass bak.');
  }
  return ut;
}
const navnAv = (id) => {
  const e = elevMed(id);
  return e ? e.navn : '?';
};

/* ============ angre ============ */
function lagreAngre() {
  angrestabel.push({
    plasser: kopi(D.aktiv.plasser),
    laaste: D.aktiv.laaste.slice(),
    farger: kopi(D.aktiv.farger),
  });
  if (angrestabel.length > 25) angrestabel.shift();
  $('angre').disabled = false;
}
function angre() {
  const f = angrestabel.pop();
  if (!f) return;
  D.aktiv.plasser = f.plasser;
  D.aktiv.laaste = f.laaste;
  D.aktiv.farger = f.farger;
  $('angre').disabled = angrestabel.length === 0;
  tegn();
}

/* ============ nabominne ============ */
function naaVaerendeNaboer() {
  const sett = [];
  naboPar().forEach(([a, b]) => {
    const ia = D.aktiv.plasser[a],
      ib = D.aktiv.plasser[b];
    if (ia && ib) sett.push(parN(ia, ib));
  });
  return sett;
}
function huskNaboer() {
  const sett = naaVaerendeNaboer();
  if (!sett.length) return;
  const k = klasse();
  k.historikk.unshift(sett);
  k.historikk = k.historikk.slice(0, 3);
  lagre();
  tegn();
}
