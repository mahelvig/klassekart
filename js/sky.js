/* Kryptering og lagring i Supabase. */
'use strict';

/* ============ kryptering ============
   Passordet blir til to nøkler i nettleseren: én til innloggingen hos
   Supabase og én som låser opp lærerens private nøkkel. Hver klasse har
   sin egen tilfeldige nøkkel, pakket inn for hvert medlem. Serveren ser
   bare kryptert innhold. */
const koder = new TextEncoder(),
  avkoder = new TextDecoder();
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' };
function b64(buf) {
  const b = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000)
    s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
const ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (b) =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const aesNokkel = (raw) =>
  crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
async function passordBits(passord, salt) {
  const base = await crypto.subtle.importKey(
    'raw',
    koder.encode(passord),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
      base,
      512,
    ),
  );
}
async function avledNokler(epost, passord) {
  const salt = await crypto.subtle.digest(
    'SHA-256',
    koder.encode('klassekart:' + epost.trim().toLowerCase()),
  );
  const bits = await passordBits(passord, new Uint8Array(salt));
  return {
    auth: hex(bits.slice(0, 32)),
    kek: await aesNokkel(bits.slice(32)),
  };
}
async function krypter(nokkel, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    nokkel,
    data,
  );
  return b64(iv) + '.' + b64(ct);
}
async function dekrypter(nokkel, s) {
  const [iv, ct] = s.split('.');
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ub64(iv) },
      nokkel,
      ub64(ct),
    ),
  );
}
const krypterJson = (k, o) =>
  krypter(k, koder.encode(typeof o === 'string' ? o : JSON.stringify(o)));
const dekrypterJson = async (k, s) =>
  JSON.parse(avkoder.decode(await dekrypter(k, s)));
const nyAesNokkel = () =>
  crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
const offentligNokkel = (s) =>
  crypto.subtle.importKey('spki', ub64(s), RSA, false, ['wrapKey']);
const pakkInn = async (aes, offentlig) =>
  b64(await crypto.subtle.wrapKey('raw', aes, offentlig, RSA));
const pakkUt = (s, privat) =>
  crypto.subtle.unwrapKey('raw', ub64(s), privat, RSA, 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ]);
function nyKode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let bits = 0,
    v = 0,
    ut = '';
  crypto.getRandomValues(new Uint8Array(15)).forEach((x) => {
    v = ((v << 8) | x) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      ut += A[(v >> (bits - 5)) & 31];
      bits -= 5;
    }
  });
  return ut.match(/.{4}/g).join('-');
}
async function kodeNokkel(kode) {
  const ren = kode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const h = await crypto.subtle.digest(
    'SHA-256',
    koder.encode('klassekart-kode:' + ren),
  );
  return aesNokkel(new Uint8Array(h));
}

/* ============ sky (Supabase) ============ */
const MODUS = 'klassekart:modus';
const sky = {
  klient: null,
  klar: false,
  id: null,
  epost: '',
  privat: null,
  offentlig: null,
  egenNokkel: null,
  nokler: {}, // klasse-id → AES-nøkkel
  versjon: {}, // klasse-id → versjonsnummer i databasen
  lagret: {}, // klasse-id → sist lagrede innhold (ukryptert JSON)
  egenLagret: '',
  skole: '',
  romLagret: {}, // rom-id → sist lagrede oppsett
  medlemmer: {}, // klasse-id → e-poster til andre medlemmer
};
function iSky() {
  return sky.klar;
}
const kortEpost = (e) => e.split('@')[0];
const hjemUrl = () => location.href.split('#')[0].split('?')[0];
function skyFeil(r) {
  if (r.error) throw r.error;
  return r.data;
}

function visSkystatus(t, varsel) {
  clearTimeout(lagretTimer); // denne statusen skal ikke tone ut
  const s = $('skystatus');
  s.textContent = t;
  s.className = 'skystatus' + (varsel ? ' varsel' : '');
}

async function hentProfil() {
  return skyFeil(
    await sky.klient
      .from('profiler')
      .select('*')
      .eq('id', sky.id)
      .maybeSingle(),
  );
}
async function lagProfil(kek) {
  const par = await crypto.subtle.generateKey(
    {
      ...RSA,
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['wrapKey', 'unwrapKey'],
  );
  const egen = await nyAesNokkel();
  const kode = nyKode();
  const pk = new Uint8Array(
    await crypto.subtle.exportKey('pkcs8', par.privateKey),
  );
  const rad = {
    id: sky.id,
    epost: sky.epost.toLowerCase(),
    offentlig_nokkel: b64(
      await crypto.subtle.exportKey('spki', par.publicKey),
    ),
    privat_passord: await krypter(kek, pk),
    privat_gjenoppretting: await krypter(await kodeNokkel(kode), pk),
    egen_nokkel: await pakkInn(egen, par.publicKey),
    egendata: null,
  };
  return { rad, kode };
}
async function laasOpp(profil, nokkel, felt) {
  let pk;
  try {
    pk = await dekrypter(nokkel, profil[felt]);
  } catch (err) {
    throw new Error(
      felt === 'privat_passord'
        ? 'Klarte ikke å låse opp nøklene dine med dette passordet.'
        : 'Gjenopprettingskoden stemmer ikke.',
    );
  }
  // ikke-eksporterbar: kan brukes, men aldri leses ut igjen som tekst
  const privat = await crypto.subtle.importKey('pkcs8', pk, RSA, false, [
    'unwrapKey',
  ]);
  await brukNokler(profil, privat);
  return pk;
}
async function brukNokler(profil, privat) {
  sky.skole = profil.skole || '';
  sky.offentlig = await offentligNokkel(profil.offentlig_nokkel);
  sky.egenNokkel = await pakkUt(profil.egen_nokkel, privat);
  sky.privat = privat;
}

/* ---- «Forbli innlogget»: den private nøkkelen lagres i nettleserens
   IndexedDB som en ikke-eksporterbar CryptoKey ---- */
function nokkelbase(modus, fn) {
  return new Promise((ok, feil) => {
    const aapne = indexedDB.open('klassekart-nokler', 1);
    aapne.onupgradeneeded = () =>
      aapne.result.createObjectStore('nokler');
    aapne.onerror = () => feil(aapne.error);
    aapne.onsuccess = () => {
      const tx = aapne.result.transaction('nokler', modus);
      const req = fn(tx.objectStore('nokler'));
      tx.oncomplete = () => ok(req.result);
      tx.onerror = () => feil(tx.error);
    };
  }).catch(() => null);
}
const huskNokkel = (id, privat) =>
  nokkelbase('readwrite', (s) => s.put(privat, id));
const husketNokkel = (id) => nokkelbase('readonly', (s) => s.get(id));
const glemNokler = () => nokkelbase('readwrite', (s) => s.clear());

async function loggInn(epost, passord) {
  const { auth, kek } = await avledNokler(epost, passord);
  const r = await sky.klient.auth.signInWithPassword({
    email: epost,
    password: auth,
  });
  if (r.error)
    throw new Error(
      /confirm/i.test(r.error.message)
        ? 'Du må bekrefte e-postadressen først – sjekk innboksen.'
        : /invalid/i.test(r.error.message)
          ? 'Feil e-post eller passord.'
          : r.error.message,
    );
  sky.id = r.data.user.id;
  sky.epost = r.data.user.email;
  let profil = await hentProfil(),
    kode = null;
  if (!profil) {
    // første innlogging: lag nøkler
    const ny = await lagProfil(kek);
    skyFeil(await sky.klient.from('profiler').insert(ny.rad));
    profil = ny.rad;
    kode = ny.kode;
  }
  await laasOpp(profil, kek, 'privat_passord');
  return kode;
}
// må stemme med tillatt_domene() i klassekart-supabase.sql
const TILLATT_DOMENE = 'osloskolen.no';
async function registrer(epost, passord) {
  const { auth } = await avledNokler(epost, passord);
  const r = await sky.klient.auth.signUp({
    email: epost,
    password: auth,
    options: { emailRedirectTo: hjemUrl() },
  });
  if (r.error)
    throw new Error(
      /database error|domene/i.test(r.error.message)
        ? 'Bare adresser som slutter på @' +
          TILLATT_DOMENE +
          ' kan opprette konto.'
        : r.error.message,
    );
  return !!r.data.session;
}

/* ---- fra databasen til D og tilbake ---- */
function klassePakke(n, k) {
  const kart = {};
  Object.entries(D.kart).forEach(([kn, x]) => {
    if (x.klasse === n)
      kart[kn] = {
        rom: x.rom,
        plasser: x.plasser,
        laaste: x.laaste,
        farger: x.farger,
        endret: x.endret,
        navn: x.navn || null,
        auto: !!x.auto,
      };
  });
  return {
    navn: n,
    elever: k.elever,
    historikk: k.historikk,
    sist: k.sist || null,
    romkart: k.romkart || null,
    grupper: k.grupper || null,
    kart,
  };
}
function egenPakke() {
  const brukt = {};
  Object.values(D.klasser).forEach((k) => {
    if (k._id && k.brukt) brukt[k._id] = k.brukt;
  });
  const a = D.aktiv;
  return {
    aktiv: {
      klasse: (D.klasser[a.klasse] || {})._id || null,
      rom: a.rom,
      spre: a.spre,
      spreKlasse: a.spreKlasse,
      nyeNaboer: a.nyeNaboer,
      speil: a.speil,
    },
    brukt,
  };
}
/* Rom er ikke personopplysninger og deles ukryptert med kollegene */
const romPakke = (n, R) =>
  JSON.stringify({ navn: n, rader: R.rader, sperret: R.sperret });
function klasseFraPakke(ny, p, id, brukt) {
  let n = p.navn,
    i = 1;
  while (ny.klasser[n]) n = p.navn + ' (' + ++i + ')';
  ny.klasser[n] = {
    elever: p.elever || [],
    historikk: p.historikk || [],
    sist: p.sist || null,
    romkart: p.romkart || null,
    grupper: p.grupper || null,
    _id: id,
    brukt,
  };
  Object.entries(p.kart || {}).forEach(([kn, x]) => {
    let kk = kn;
    while (ny.kart[kk]) kk += ' (' + n + ')';
    ny.kart[kk] = { ...x, klasse: n };
  });
  return n;
}

/* Henter og dekrypterer alt, men endrer ikke D før bruk() kalles */
async function hentSky() {
  const k = sky.klient;
  const profil = skyFeil(
    await k.from('profiler').select('egendata').eq('id', sky.id).single(),
  );
  const medl = skyFeil(
    await k
      .from('klassemedlemmer')
      .select('klasse_id, nokkel')
      .eq('bruker_id', sky.id),
  );
  const rader = medl.length
    ? skyFeil(
        await k
          .from('klasser')
          .select('id, data, versjon')
          .in(
            'id',
            medl.map((m) => m.klasse_id),
          ),
      )
    : [];
  const romrader = skyFeil(
    await k.from('rom').select('id, navn, rader, sperret, opprettet_av'),
  );
  const egen = profil.egendata
    ? await dekrypterJson(sky.egenNokkel, profil.egendata)
    : {};
  const ny = standarddata(false);
  ny.klasser = {};
  ny.kart = {};
  ny.rom = {};
  romrader.forEach((x) => {
    ny.rom[x.navn] = {
      rader: x.rader,
      sperret: x.sperret || [],
      _id: x.id,
      _eier: x.opprettet_av,
    };
  });
  // rom fra før rommene ble delt, flyttes over til de delte
  Object.entries(egen.rom || {}).forEach(([n, R]) => {
    if (!ny.rom[n])
      ny.rom[n] = { rader: R.rader, sperret: R.sperret || [] };
  });
  const nokler = {},
    versjon = {};
  for (const m of medl) {
    const rad = rader.find((r) => r.id === m.klasse_id);
    if (!rad) continue;
    try {
      const nokkel = await pakkUt(m.nokkel, sky.privat);
      const p = await dekrypterJson(nokkel, rad.data);
      klasseFraPakke(ny, p, rad.id, (egen.brukt || {})[rad.id]);
      nokler[rad.id] = nokkel;
      versjon[rad.id] = rad.versjon;
    } catch (err) {
      console.warn('Klarte ikke å åpne klasse', rad.id, err);
    }
  }
  if (egen.aktiv) {
    const a = egen.aktiv;
    ny.aktiv = {
      ...ny.aktiv,
      ...a,
      klasse:
        Object.keys(ny.klasser).find(
          (n) => ny.klasser[n]._id === a.klasse,
        ) || '',
    };
  }
  return () => {
    D = ny;
    sky.nokler = nokler;
    sky.versjon = versjon;
    normaliser();
    gjenopprett(D.aktiv.klasse);
    sky.lagret = {};
    Object.entries(D.klasser).forEach(([n, kl]) => {
      if (kl._id) sky.lagret[kl._id] = JSON.stringify(klassePakke(n, kl));
    });
    sky.egenLagret = JSON.stringify(egenPakke());
    sky.romLagret = {};
    Object.entries(D.rom).forEach(([n, R]) => {
      if (R._id) sky.romLagret[R._id] = romPakke(n, R);
    });
    angrestabel = [];
    $('angre').disabled = true;
    apenElev = null;
  };
}
async function hentMedlemmer() {
  const ids = Object.values(D.klasser)
    .map((k) => k._id)
    .filter(Boolean);
  const m = {};
  if (ids.length)
    skyFeil(
      await sky.klient.rpc('medlemmer_i', { p_klasser: ids }),
    ).forEach((r) => {
      if (r.bruker_id !== sky.id)
        (m[r.klasse_id] ||= []).push({ id: r.bruker_id, epost: r.epost });
    });
  sky.medlemmer = m;
}
let henter = false;
async function oppdaterFraSky() {
  if (henter) return;
  henter = true;
  try {
    await tomSynk();
    if (ulagret) return;
    const foer = endringsteller;
    const bruk = await hentSky();
    if (endringsteller !== foer) return; // brukeren rakk å endre noe
    bruk();
    await hentMedlemmer();
    if (!$('oversikt').hidden) tegnOversikt();
    else tegn();
    visLagret();
  } catch (err) {
    console.error(err);
    visSkystatus('Fikk ikke kontakt med skyen', true);
  } finally {
    henter = false;
  }
}

/* ---- lagring ---- */
let synkTimer = null,
  synkKjede = Promise.resolve(),
  ulagret = false;
function planleggSynk() {
  ulagret = true;
  visSkystatus('Lagrer …');
  clearTimeout(synkTimer);
  synkTimer = setTimeout(kjorSynk, 800);
}
function kjorSynk() {
  clearTimeout(synkTimer);
  synkTimer = null;
  synkKjede = synkKjede
    .then(synk)
    .then(() => {
      if (synkTimer) return;
      ulagret = false;
      visLagret();
    })
    .catch((err) => {
      console.error(err);
      visSkystatus('Ikke lagret – prøver igjen', true);
      synkTimer = setTimeout(kjorSynk, 10000);
    });
  return synkKjede;
}
const tomSynk = () => (ulagret ? kjorSynk() : synkKjede);

async function synk() {
  if (!iSky()) return;
  const k = sky.klient;
  const meldinger = [];
  const finnes = new Set();
  for (const [n, kl] of Object.entries(D.klasser)) {
    const s = JSON.stringify(klassePakke(n, kl));
    if (!kl._id) await opprettSkyklasse(kl, s);
    const id = kl._id;
    finnes.add(id);
    if (s === sky.lagret[id]) continue;
    const v = sky.versjon[id];
    const r = skyFeil(
      await k
        .from('klasser')
        .update({
          data: await krypterJson(sky.nokler[id], s),
          versjon: v + 1,
          endret: new Date().toISOString(),
          endret_av: sky.id,
        })
        .eq('id', id)
        .eq('versjon', v)
        .select('id'),
    );
    if (r.length) {
      sky.versjon[id] = v + 1;
      sky.lagret[id] = s;
    } else meldinger.push(await hentKlasseIgjen(id));
  }
  for (const id of Object.keys(sky.lagret))
    if (!finnes.has(id)) await fjernSkyklasse(id);

  await synkRom();
  const e = JSON.stringify(egenPakke());
  if (e !== sky.egenLagret) {
    skyFeil(
      await k
        .from('profiler')
        .update({ egendata: await krypterJson(sky.egenNokkel, e) })
        .eq('id', sky.id),
    );
    sky.egenLagret = e;
  }
  if (meldinger.length) {
    if (!$('oversikt').hidden) tegnOversikt();
    else tegn(meldinger);
  }
}
async function synkRom() {
  const k = sky.klient;
  const finnes = new Set();
  for (const [n, R] of Object.entries(D.rom)) {
    const s = romPakke(n, R);
    if (R._id && s === sky.romLagret[R._id]) {
      finnes.add(R._id);
      continue;
    }
    const felt = {
      skole: sky.skole,
      navn: n,
      rader: R.rader,
      sperret: R.sperret,
      endret: new Date().toISOString(),
      endret_av: sky.id,
    };
    if (R._id) {
      skyFeil(await k.from('rom').update(felt).eq('id', R._id));
    } else {
      const id = crypto.randomUUID();
      const r = await k
        .from('rom')
        .insert({ ...felt, id, opprettet_av: sky.id });
      if (r.error && r.error.code === '23505') {
        // en kollega har et rom med samme navn: bruk deres
        const deres = skyFeil(
          await k
            .from('rom')
            .select('id, rader, sperret, opprettet_av')
            .eq('navn', n)
            .single(),
        );
        Object.assign(R, {
          rader: deres.rader,
          sperret: deres.sperret || [],
          _id: deres.id,
          _eier: deres.opprettet_av,
        });
        sky.romLagret[R._id] = romPakke(n, R);
        finnes.add(R._id);
        continue;
      }
      skyFeil(r);
      R._id = id;
      R._eier = sky.id;
    }
    sky.romLagret[R._id] = s;
    finnes.add(R._id);
  }
  for (const id of Object.keys(sky.romLagret))
    if (!finnes.has(id)) {
      skyFeil(await k.from('rom').delete().eq('id', id));
      delete sky.romLagret[id];
    }
}
async function opprettSkyklasse(kl, s) {
  const k = sky.klient;
  const id = crypto.randomUUID();
  const nokkel = await nyAesNokkel();
  skyFeil(
    await k.from('klasser').insert({
      id,
      data: await krypterJson(nokkel, s),
      versjon: 1,
      opprettet_av: sky.id,
      endret_av: sky.id,
    }),
  );
  skyFeil(
    await k.from('klassemedlemmer').insert({
      klasse_id: id,
      bruker_id: sky.id,
      nokkel: await pakkInn(nokkel, sky.offentlig),
      lagt_til_av: sky.id,
    }),
  );
  kl._id = id;
  sky.nokler[id] = nokkel;
  sky.versjon[id] = 1;
  sky.lagret[id] = s;
}
/* Er det andre medlemmer igjen, forlater vi klassen – ellers slettes den */
async function fjernSkyklasse(id) {
  const k = sky.klient;
  const medl = skyFeil(
    await k
      .from('klassemedlemmer')
      .select('bruker_id')
      .eq('klasse_id', id),
  );
  if (medl.some((m) => m.bruker_id !== sky.id))
    skyFeil(
      await k
        .from('klassemedlemmer')
        .delete()
        .eq('klasse_id', id)
        .eq('bruker_id', sky.id),
    );
  else skyFeil(await k.from('klasser').delete().eq('id', id));
  delete sky.lagret[id];
  delete sky.nokler[id];
  delete sky.versjon[id];
}
/* En kollega lagret samme klasse samtidig: hent deres versjon */
async function hentKlasseIgjen(id) {
  const r = skyFeil(
    await sky.klient
      .from('klasser')
      .select('data, versjon')
      .eq('id', id)
      .maybeSingle(),
  );
  const n = Object.keys(D.klasser).find((x) => D.klasser[x]._id === id);
  const gammel = D.klasser[n];
  delete D.klasser[n];
  Object.keys(D.kart).forEach((kn) => {
    if (D.kart[kn].klasse === n) delete D.kart[kn];
  });
  delete sky.lagret[id];
  if (!r) {
    if (!D.klasser[D.aktiv.klasse]) {
      normaliser();
      gjenopprett(D.aktiv.klasse);
    }
    return n + ' er slettet, eller du har ikke lenger tilgang.';
  }
  const p = await dekrypterJson(sky.nokler[id], r.data);
  const nn = klasseFraPakke(D, p, id, gammel.brukt);
  sky.versjon[id] = r.versjon;
  sky.lagret[id] = JSON.stringify(klassePakke(nn, D.klasser[nn]));
  if (D.aktiv.klasse === n) gjenopprett(nn);
  return (
    'En kollega endret ' +
    nn +
    ' samtidig. Du ser nå deres versjon – de siste endringene dine i klassen ble ikke lagret.'
  );
}
window.addEventListener('beforeunload', (e) => {
  if (iSky() && ulagret) {
    kjorSynk();
    e.preventDefault();
    e.returnValue = '';
  }
});

/* ---- deling ---- */
function delMeny(knapp, n) {
  apneMeny(knapp, (boks) => {
    const delt = sky.medlemmer[D.klasser[n]._id] || [];
    menyinfo(
      boks,
      delt.length
        ? n + ' er delt med:'
        : 'Bare du har tilgang til ' + n + '.',
    );
    delt.forEach((m) => {
      const rad = document.createElement('div');
      rad.className = 'kartrad';
      const navn = document.createElement('span');
      navn.className = 'menyvalg';
      navn.style.cursor = 'default';
      navn.textContent = m.epost;
      const fjern = document.createElement('button');
      fjern.type = 'button';
      fjern.className = 'knapp liten';
      fjern.textContent = 'Fjern';
      fjern.addEventListener('click', () => {
        lukkPanel();
        fjernKollega(n, m);
      });
      rad.appendChild(navn);
      rad.appendChild(fjern);
      boks.appendChild(rad);
    });
    menyvalg(boks, 'Del med en kollega …', () => delKlasse(n));
  });
}
async function fjernKollega(n, m) {
  if (
    !(await bekreft(
      'Fjerne ' +
        m.epost +
        ' fra ' +
        n +
        '? Kollegaen mister tilgangen til klassen.',
      'Fjern',
      true,
    ))
  )
    return;
  try {
    skyFeil(
      await sky.klient
        .from('klassemedlemmer')
        .delete()
        .eq('klasse_id', D.klasser[n]._id)
        .eq('bruker_id', m.id),
    );
    await hentMedlemmer();
    tegnOversikt();
    visBeskjed(m.epost + ' har ikke lenger tilgang til ' + n + '.');
  } catch (err) {
    console.error(err);
    visBeskjed('Klarte ikke å fjerne kollegaen: ' + err.message, true);
  }
}
async function delKlasse(n) {
  const epost = (
    (await sporOm(
      'E-postadressen til kollegaen du vil dele ' + n + ' med',
      '',
      'email',
    )) || ''
  )
    .trim()
    .toLowerCase();
  if (!epost) return;
  try {
    await tomSynk();
    const kl = D.klasser[n];
    if (!kl || !kl._id || ulagret)
      return melding('Klassen er ikke lagret ennå. Prøv igjen om litt.');
    const funnet = skyFeil(
      await sky.klient.rpc('finn_kollega', { p_epost: epost }),
    );
    if (!funnet.length)
      return melding(
        'Fant ingen konto for ' +
          epost +
          '. Kollegaen må opprette konto og logge inn én gang før du kan dele med dem.',
      );
    const kollega = funnet[0];
    if (kollega.id === sky.id) return;
    skyFeil(
      await sky.klient.from('klassemedlemmer').upsert({
        klasse_id: kl._id,
        bruker_id: kollega.id,
        nokkel: await pakkInn(
          sky.nokler[kl._id],
          await offentligNokkel(kollega.offentlig_nokkel),
        ),
        lagt_til_av: sky.id,
      }),
    );
    await hentMedlemmer();
    tegnOversikt();
    melding(
      n +
        ' er delt med ' +
        epost +
        '. Klassen dukker opp neste gang kollegaen åpner oversikten.',
    );
  } catch (err) {
    console.error(err);
    melding('Klarte ikke å dele klassen: ' + err.message);
  }
}

/* ---- klasser lagret lokalt i denne nettleseren ---- */
function lokaleData() {
  let ut = [];
  try {
    const d = JSON.parse(localStorage.getItem(LOKAL) || 'null');
    ut = d && d.klasser ? [d] : gamleData();
  } catch (err) {}
  return ut.filter((d) =>
    Object.values(d.klasser).some((k) => k.elever && k.elever.length),
  );
}
function slettLokaleData() {
  try {
    JSON.parse(localStorage.getItem(PROFILER) || '[]').forEach((n) =>
      localStorage.removeItem(brukernokkel(n)),
    );
    [LOKAL, PROFILER, SIST, GAMMEL].forEach((x) =>
      localStorage.removeItem(x),
    );
  } catch (err) {}
}
async function flyttLokale() {
  let ant = 0;
  lokaleData().forEach((d) => (ant += slaaSammen(d)));
  tegn();
  visOversikt();
  if (
    ant &&
    (await bekreft(
      ant +
        (ant === 1 ? ' klasse er' : ' klasser er') +
        ' flyttet til kontoen. Slette den lokale kopien fra denne nettleseren?',
      'Slett lokal kopi',
    ))
  )
    slettLokaleData();
}

function oppdaterKontoUi() {
  const k = $('kontoKnapp');
  if (iSky()) {
    const n = kortEpost(sky.epost).split(/[._-]/)[0];
    k.textContent = n.charAt(0).toUpperCase() + n.slice(1) + ' ▾';
  } else {
    k.textContent = 'Uten konto ▾';
    visLagret(false);
  }
}
function tilSky() {
  try {
    localStorage.setItem(MODUS, 'sky');
  } catch (err) {}
  location.reload();
}
async function loggUt() {
  await tomSynk();
  const sp = 'Noe er ikke lagret ennå. Logge ut likevel?';
  if (ulagret && !(await bekreft(sp, 'Logg ut'))) return;
  await glemNokler();
  await sky.klient.auth.signOut();
  location.reload(); // tømmer nøklene fra minnet
}
async function slettKonto() {
  if (
    !(await bekreft(
      'Slette kontoen din?\n\n' +
        '• Alt som er lagret på kontoen din, fjernes for godt. Det kan ikke angres.\n' +
        '• Klasser du har delt med kolleger, blir værende hos dem.\n' +
        '• Klasser bare du har tilgang til, slettes.\n' +
        '• Klasser lagret lokalt i denne nettleseren (uten konto) berøres ikke.\n\n' +
        'Tips: Last ned en kryptert kopi først, via kontomenyen.',
      'Gå videre',
      true,
    ))
  )
    return;
  const svar = await sporOm('Skriv SLETT for å bekrefte.');
  if (!svar || svar.trim().toUpperCase() !== 'SLETT')
    return visBeskjed('Kontoen ble ikke slettet.');
  try {
    const r = await sky.klient.rpc('slett_min_konto');
    if (r.error) throw r.error;
  } catch (err) {
    console.error(err);
    melding('Klarte ikke å slette kontoen: ' + (err.message || err));
    return;
  }
  await glemNokler();
  try {
    await sky.klient.auth.signOut({ scope: 'local' });
    localStorage.removeItem(MODUS);
  } catch (err) {}
  await melding('Kontoen din er slettet.');
  location.reload();
}
