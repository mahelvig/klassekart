/* Klassekartet som bilde (PNG), til å sende i Teams, på melding o.l.
   Bildet tegnes rett fra klassens lagrede kart, så klassen trenger ikke
   åpnes først. På mobil åpnes delingsmenyen til telefonen; der den ikke
   finnes, lastes bildet ned i stedet. */
'use strict';

const BILDE = {
  skala: 2, // skarpt på skjermer med høy oppløsning
  marg: 36,
  pultB: 150,
  pultH: 86,
  pultgap: 8,
  midtgang: 30,
  radgap: 18,
  skrift: '"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif',
};

// klassens kart i rommet den sist var i, slik oversikten viser det
function kartdataFor(n) {
  const k = D.klasser[n];
  const sist = k.sist || {};
  const romnavn = D.rom[sist.rom] ? sist.rom : D.aktiv.rom;
  const s =
    (k.romkart || {})[romnavn] || (sist.rom === romnavn ? sist : {});
  const navn = {};
  k.elever.forEach((e) => (navn[e.id] = e.navn));
  return {
    romnavn,
    rader: (D.rom[romnavn] || { rader: [] }).rader,
    plasser: s.plasser || {},
    farger: s.farger || {},
    sperret: sperretI(k, romnavn),
    navn,
  };
}

function blandFarge(hex, andel, med) {
  const a = parseInt(hex.slice(1), 16),
    b = parseInt((med || '#ffffff').slice(1), 16);
  const c = [16, 8, 0].map((s) =>
    Math.round(((a >> s) & 255) * andel + ((b >> s) & 255) * (1 - andel)),
  );
  return 'rgb(' + c.join(',') + ')';
}
function avrundet(c, x, y, b, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + b, y, x + b, y + h, r);
  c.arcTo(x + b, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + b, y, r);
  c.closePath();
}
/* Navnet skrives så stort det får plass, på én linje eller delt ved et
   mellomrom over to linjer, aldri midt i et ord. */
function skrivNavn(c, tekst, mx, my, ledigB, ledigH) {
  const linjer = (str, s) => {
    c.font = '700 ' + s + 'px ' + BILDE.skrift;
    if (c.measureText(str).width <= ledigB) return [str];
    const ord = str.split(' ');
    let best = null;
    for (let i = 1; i < ord.length; i++) {
      const l = [ord.slice(0, i).join(' '), ord.slice(i).join(' ')];
      const w = Math.max(...l.map((x) => c.measureText(x).width));
      if (w <= ledigB && (!best || w < best.w)) best = { l, w };
    }
    return best && s * 2.3 <= ledigH ? best.l : null;
  };
  let s = 17,
    l = linjer(tekst, s);
  while (!l && s > 9) l = linjer(tekst, (s -= 0.5));
  if (!l) l = [tekst]; // får det likevel ikke plass, stikker det litt ut
  c.font = '700 ' + s + 'px ' + BILDE.skrift;
  const lh = s * 1.15;
  l.forEach((x, i) =>
    c.fillText(x, mx, my + (i - (l.length - 1) / 2) * lh),
  );
}

async function tegnKartbilde(n, fraTavla) {
  const B = BILDE;
  const d = kartdataFor(n);
  try {
    await Promise.all([
      document.fonts.load('700 16px "Atkinson Hyperlegible"'),
      document.fonts.load('400 16px "Atkinson Hyperlegible"'),
    ]);
  } catch (err) {}

  const radBredde = (rad) =>
    rad.reduce((a, ant) => a + ant * B.pultB + (ant - 1) * B.pultgap, 0) +
    Math.max(0, rad.length - 1) * B.midtgang;
  const innhold = Math.max(560, ...d.rader.map(radBredde));
  const W = innhold + 2 * B.marg;
  const tittelH = 74,
    tavleH = 46,
    luft = 28;
  const pulterH =
    d.rader.length * B.pultH + Math.max(0, d.rader.length - 1) * B.radgap;
  const H = B.marg + tittelH + tavleH + luft + pulterH + B.marg;

  const lerret = document.createElement('canvas');
  lerret.width = W * B.skala;
  lerret.height = H * B.skala;
  const c = lerret.getContext('2d');
  c.scale(B.skala, B.skala);

  // papir med rutenett
  c.fillStyle = '#f8fafb';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(45, 95, 130, 0.075)';
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 0.5; x < W; x += 22) c.moveTo(x, 0), c.lineTo(x, H);
  for (let y = 0.5; y < H; y += 22) c.moveTo(0, y), c.lineTo(W, y);
  c.stroke();

  // tittel
  const dato = new Date().toLocaleDateString('no-NO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  c.fillStyle = '#1d2b36';
  c.font = '700 26px ' + B.skrift;
  c.fillText('Klassekart ' + n, B.marg, B.marg + 26);
  c.fillStyle = '#5b6b76';
  c.font = '400 16px ' + B.skrift;
  c.fillText(
    d.romnavn + ' · ' + dato + ' · Sett fra ' + (fraTavla ? 'tavla' : 'klassen'),
    B.marg,
    B.marg + 52,
  );

  const topp = B.marg + tittelH;
  const tavleY = fraTavla ? topp + pulterH + luft : topp;
  const pulterY = fraTavla ? topp : topp + tavleH + luft;

  // tavla, med krittkanten mot elevene
  const tb = Math.min(760, innhold),
    tx = (W - tb) / 2;
  c.fillStyle = '#a07f55';
  c.fillRect(tx, tavleY, tb, tavleH);
  c.fillStyle = '#23463b';
  c.fillRect(tx, tavleY + (fraTavla ? 7 : 0), tb, tavleH - 7);
  c.fillStyle = '#e8efe9';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '700 17px ' + B.skrift;
  if ('letterSpacing' in c) c.letterSpacing = '1.4px';
  c.fillText('Tavle', W / 2, tavleY + (fraTavla ? 7 : 0) + (tavleH - 7) / 2);
  if ('letterSpacing' in c) c.letterSpacing = '0px';

  // pultene; sett fra tavla er kartet speilet begge veier
  const snu = (a) => (fraTavla ? a.slice().reverse() : a);
  snu(d.rader.map((_, r) => r)).forEach((r, ri) => {
    const rad = d.rader[r];
    let x = (W - radBredde(rad)) / 2;
    const y = pulterY + ri * (B.pultH + B.radgap);
    snu(rad.map((_, g) => g)).forEach((g) => {
      const pi = [];
      for (let i = 0; i < rad[g]; i++) pi.push(i);
      snu(pi).forEach((i) => {
        tegnPult(c, d, nokkel(r, g, i), x, y);
        x += B.pultB + B.pultgap;
      });
      x += B.midtgang - B.pultgap;
    });
  });

  return new Promise((ok, feil) =>
    lerret.toBlob(
      (b) => (b ? ok(b) : feil(new Error('Klarte ikke å lage bildet'))),
      'image/png',
    ),
  );
}
function tegnPult(c, d, k, x, y) {
  const B = BILDE,
    b = B.pultB,
    h = B.pultH;
  const sperret = d.sperret.includes(k);
  const id = d.plasser[k];
  const navn = !sperret && id ? d.navn[id] : null;
  const f = d.farger[k];
  const farge =
    !sperret && Number.isInteger(f) && FARGER[f] ? FARGER[f].hex : null;

  let flate, kant, bunn;
  if (sperret) (flate = '#e4e9ec'), (kant = bunn = '#b5c0c6');
  else if (farge) {
    flate = blandFarge(farge, navn ? 0.17 : 0.08);
    kant = blandFarge(farge, 0.45);
    bunn = blandFarge(farge, 0.7, '#555555');
  } else if (navn) (flate = '#f3e5cb'), (kant = bunn = '#d6bd94');
  else (flate = '#fbf6ec'), (kant = bunn = '#e5d6ba');

  // kanten nederst (og fargestripen øverst) er tykkere, som i appen
  avrundet(c, x, y, b, h, 4);
  c.fillStyle = bunn;
  c.fill();
  avrundet(c, x + 1, y + 1, b - 2, h - 5, 3);
  c.fillStyle = kant;
  c.fill();
  const toppKant = farge ? 7 : 1;
  c.fillStyle = flate;
  c.fillRect(x + 1, y + toppKant, b - 2, h - 4 - toppKant);
  if (farge) {
    avrundet(c, x, y, b, 7, 3);
    c.fillStyle = farge;
    c.fill();
  }
  if (sperret) {
    c.save();
    c.beginPath();
    c.rect(x + 1, y + 1, b - 2, h - 5);
    c.clip();
    c.strokeStyle = '#d9e0e4';
    c.lineWidth = 6;
    for (let s = -h; s < b + h; s += 17) {
      c.beginPath();
      c.moveTo(x + s, y + h);
      c.lineTo(x + s + h, y);
      c.stroke();
    }
    c.restore();
  }
  if (navn) {
    c.fillStyle = '#1d2b36';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const t = farge ? 7 : 1;
    skrivNavn(c, navn, x + b / 2, y + t + (h - 4 - t) / 2, b - 14, h - 4 - t - 6);
  }
}

const filnavnFor = (n, fraTavla) =>
  ('Klassekart ' + n + (fraTavla ? ' sett fra tavla' : ''))
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim() + '.png';

async function delKartSomBilde(n, fraTavla) {
  let fil;
  try {
    const blob = await tegnKartbilde(n, fraTavla);
    fil = new File([blob], filnavnFor(n, fraTavla), { type: 'image/png' });
  } catch (err) {
    console.error(err);
    return visBeskjed('Klarte ikke å lage bildet: ' + err.message, true);
  }
  const kanDele =
    navigator.share && navigator.canShare && navigator.canShare({ files: [fil] });
  if (!kanDele) {
    lastNedFil(fil, fil.name, 'image/png');
    return visBeskjed(
      'Bildet av kartet er lastet ned. Legg det ved i Teams, en e-post eller en melding.',
    );
  }
  const del = async () => {
    try {
      await navigator.share({ files: [fil], title: 'Klassekart ' + n });
    } catch (err) {
      if (err.name === 'AbortError') return; // brukeren lukket delingsmenyen
      if (err.name === 'NotAllowedError')
        // noen nettlesere krever et nytt trykk når bildet tok tid å lage
        return visBeskjed('Bildet er klart.', false, [['Del bildet', del]]);
      lastNedFil(fil, fil.name, 'image/png');
      visBeskjed('Kunne ikke åpne delingen, så bildet er lastet ned i stedet.');
    }
  };
  await del();
}
