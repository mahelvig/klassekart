/* Innlogging, konto og oppstart. Lastes sist, siden den starter appen. */
'use strict';

/* ============ kontomeny ============ */
vedKlikk('tilKlasser', visOversikt);
vedKlikk('kontoKnapp', () =>
  apneMeny(
    $('kontoKnapp'),
    (boks) => {
      if (iSky()) {
        menyinfo(
          boks,
          'Innlogget som ' +
            sky.epost +
            '. Klassene lagres kryptert – bare du og kollegaene du deler med kan lese dem.',
        );
        if (lokaleData().length)
          menyvalg(
            boks,
            'Flytt klasser fra denne nettleseren hit',
            flyttLokale,
          );
        menyvalg(boks, 'Last ned kryptert kopi', lastNedKopi);
        menyvalg(boks, 'Hent inn kopi', () => $('filvelger').click());
        menyvalg(
          boks,
          'Bytt skole' + (sky.skole ? ' (' + sky.skole + ')' : ''),
          byttSkole,
        );
        menyvalg(boks, 'Bytt passord', () => visPassordsteg('bytt'));
        menyvalg(boks, 'Logg ut', loggUt);
        menyvalg(boks, 'Slett kontoen min …', slettKonto, true);
      } else {
        menyinfo(
          boks,
          'Uten konto lagres alt bare i denne nettleseren. Med konto får du klassene på alle maskiner og kan dele dem med kolleger.',
        );
        menyvalg(boks, 'Logg inn eller opprett konto', tilSky);
        menyvalg(boks, 'Last ned kryptert kopi', lastNedKopi);
        menyvalg(boks, 'Hent inn kopi', () => $('filvelger').click());
      }
    },
    'hoyre',
  ),
);

/* ============ innlogging ============ */
let nyKonto = false,
  passordModus = 'bytt';
function visInngang(steg) {
  lukkPanel();
  $('topp').hidden = true;
  document.querySelector('.app').hidden = true;
  $('oversikt').hidden = true;
  $('inngang').hidden = false;
  ['stegInn', 'stegKode', 'stegPassord', 'stegSkole'].forEach(
    (s) => ($(s).hidden = s !== steg),
  );
}
function lukkInngang() {
  $('inngang').hidden = true;
}
function innStatus(t, varsel) {
  $('innStatus').textContent = t;
  $('innStatus').className = 'status' + (varsel ? ' varsel' : '');
}
function settNyKonto(ja) {
  nyKonto = ja;
  $('innGjentaBoks').hidden = !ja;
  $('innKnapp').textContent = ja ? 'Opprett konto' : 'Logg inn';
  $('innBytt').textContent = ja
    ? 'Har du konto? Logg inn'
    : 'Ny bruker? Opprett konto';
  $('innPassord').autocomplete = ja ? 'new-password' : 'current-password';
}
$('innBytt').addEventListener('click', () => {
  settNyKonto(!nyKonto);
  innStatus('');
});
$('innLokal').addEventListener('click', () => {
  try {
    localStorage.setItem(MODUS, 'lokal');
  } catch (err) {}
  lukkInngang();
  startLokal();
});
$('innGlemt').addEventListener('click', async () => {
  const epost = $('innEpost').value.trim();
  if (!epost) return innStatus('Skriv inn e-postadressen først.', true);
  if (!sky.klient) return innStatus('Får ikke kontakt med skyen.', true);
  const r = await sky.klient.auth.resetPasswordForEmail(epost, {
    redirectTo: hjemUrl(),
  });
  innStatus(
    r.error
      ? r.error.message
      : 'Sjekk e-posten din. Lenken tar deg tilbake hit, der du velger nytt passord.',
    !!r.error,
  );
});
$('stegInn').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const epost = $('innEpost').value.trim(),
    pw = $('innPassord').value;
  if (!sky.klient)
    return innStatus(
      'Får ikke kontakt med skyen. Sjekk nettet, eller bruk uten konto.',
      true,
    );
  if (!/^\S+@\S+\.\S+$/.test(epost))
    return innStatus('Skriv inn en gyldig e-postadresse.', true);
  if (!pw) return innStatus('Skriv inn passordet.', true);
  $('innKnapp').disabled = true;
  try {
    if (nyKonto) {
      if (pw.length < 12)
        throw new Error('Passordet må ha minst 12 tegn.');
      if (pw !== $('innGjenta').value)
        throw new Error('Passordene er ikke like.');
      if (!epost.toLowerCase().endsWith('@' + TILLATT_DOMENE))
        throw new Error(
          'Bare adresser som slutter på @' +
            TILLATT_DOMENE +
            ' kan opprette konto.',
        );
      innStatus('Oppretter konto …');
      if (!(await registrer(epost, pw))) {
        settNyKonto(false);
        $('innPassord').value = '';
        $('innGjenta').value = '';
        innStatus(
          'Nesten ferdig! Klikk på lenken vi har sendt til ' +
            epost +
            ', og logg deretter inn her.',
        );
        return;
      }
    }
    innStatus('Logger inn og låser opp klassene …');
    const kode = await loggInn(epost, pw);
    $('innPassord').value = '';
    $('innGjenta').value = '';
    innStatus('');
    if (kode) visKode(kode);
    else await startSky();
  } catch (err) {
    console.error(err);
    innStatus(err.message || String(err), true);
  } finally {
    $('innKnapp').disabled = false;
  }
});

function visKode(kode) {
  visInngang('stegKode');
  $('kodeTekst').textContent = kode;
  $('kodeOk').checked = false;
  $('kodeFortsett').disabled = true;
}
$('kodeOk').addEventListener(
  'change',
  (e) => ($('kodeFortsett').disabled = !e.target.checked),
);
$('kodeLastNed').addEventListener('click', () =>
  lastNedFil(
    'Gjenopprettingskode for Klassekart\n' +
      'Konto: ' +
      sky.epost +
      '\n\n' +
      $('kodeTekst').textContent +
      '\n\nBruk koden hvis du glemmer passordet. Hold den hemmelig.\n',
    'klassekart-gjenopprettingskode.txt',
    'text/plain',
  ),
);
$('kodeFortsett').addEventListener('click', async () => {
  $('kodeTekst').textContent = '';
  if (iSky()) {
    lukkInngang();
    visOversikt();
  } else await startSky();
});

/* ---- nytt passord: bytte, eller etter «glemt passord» ---- */
function visPassordsteg(modus) {
  passordModus = modus;
  visInngang('stegPassord');
  $('pwTittel').textContent =
    modus === 'bytt' ? 'Bytt passord' : 'Velg nytt passord';
  $('pwGammelBoks').hidden = modus !== 'bytt';
  $('pwKodeBoks').hidden = modus === 'bytt';
  $('pwAvbryt').hidden = modus !== 'bytt';
  ['pwGammel', 'pwKode', 'pwNy', 'pwNy2'].forEach(
    (x) => ($(x).value = ''),
  );
  $('pwUtenKode').checked = false;
  $('pwStatus').textContent = '';
}
$('pwAvbryt').addEventListener('click', () => {
  lukkInngang();
  visOversikt();
});
$('stegPassord').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const st = (t, v) => {
    $('pwStatus').textContent = t;
    $('pwStatus').className = 'status' + (v ? ' varsel' : '');
  };
  const ny = $('pwNy').value;
  if (ny.length < 12) return st('Passordet må ha minst 12 tegn.', true);
  if (ny !== $('pwNy2').value)
    return st('Passordene er ikke like.', true);
  $('pwKnapp').disabled = true;
  try {
    st('Lagrer …');
    if (passordModus === 'bytt') {
      await byttPassord($('pwGammel').value, ny);
      lukkInngang();
      visOversikt();
      visBeskjed('Passordet er byttet.');
    } else {
      const kode = await passordEtterGlemt(
        $('pwKode').value,
        $('pwUtenKode').checked,
        ny,
      );
      history.replaceState(null, '', hjemUrl());
      if (kode) visKode(kode);
      else await startSky();
    }
  } catch (err) {
    console.error(err);
    st(err.message || String(err), true);
  } finally {
    $('pwKnapp').disabled = false;
  }
});
async function byttPassord(gammelt, nytt) {
  const g = await avledNokler(sky.epost, gammelt);
  const profil = await hentProfil();
  let pk;
  try {
    pk = await dekrypter(g.kek, profil.privat_passord);
  } catch (err) {
    throw new Error('Nåværende passord stemmer ikke.');
  }
  const n = await avledNokler(sky.epost, nytt);
  const u = await sky.klient.auth.updateUser({ password: n.auth });
  if (u.error) throw u.error;
  const r = await sky.klient
    .from('profiler')
    .update({ privat_passord: await krypter(n.kek, pk) })
    .eq('id', sky.id);
  if (r.error)
    throw new Error(
      'Passordet er byttet, men nøkkelen ble ikke oppdatert. Bruk gjenopprettingskoden neste gang du logger inn.',
    );
}
async function passordEtterGlemt(kode, utenKode, nytt) {
  const u = await sky.klient.auth.getUser();
  if (u.error || !u.data.user)
    throw new Error(
      'Lenken er utløpt. Be om en ny fra innloggingssiden.',
    );
  sky.id = u.data.user.id;
  sky.epost = u.data.user.email;
  const n = await avledNokler(sky.epost, nytt);
  const profil = await hentProfil();
  if (profil && !utenKode) {
    if (!kode.trim())
      throw new Error(
        'Skriv inn gjenopprettingskoden, eller kryss av for at du ikke har den.',
      );
    const pk = await laasOpp(
      profil,
      await kodeNokkel(kode),
      'privat_gjenoppretting',
    );
    const e = await sky.klient.auth.updateUser({ password: n.auth });
    if (e.error) throw e.error;
    skyFeil(
      await sky.klient
        .from('profiler')
        .update({ privat_passord: await krypter(n.kek, pk) })
        .eq('id', sky.id),
    );
    return null;
  }
  // ny start: nye nøkler, og medlemskap vi ikke lenger kan åpne fjernes
  const ny = await lagProfil(n.kek);
  const e = await sky.klient.auth.updateUser({ password: n.auth });
  if (e.error) throw e.error;
  skyFeil(await sky.klient.from('profiler').upsert(ny.rad));
  skyFeil(
    await sky.klient
      .from('klassemedlemmer')
      .delete()
      .eq('bruker_id', sky.id),
  );
  await laasOpp(ny.rad, n.kek, 'privat_passord');
  return ny.kode;
}

/* Skolen avgjør hvilke rom du ser. Løses når skolen er lagret. */
let skoleFerdig = null,
  skolevalg = [];
async function velgSkole(kanAvbryte) {
  visInngang('stegSkole');
  $('skoleAvbryt').hidden = !kanAvbryte;
  $('skoleStatus').textContent = '';
  try {
    skolevalg = skyFeil(await sky.klient.rpc('skoler')).map(
      (x) => x.skole,
    );
    $('skoleliste').innerHTML = skolevalg
      .map((n) => '<option value="' + esc(n) + '"></option>')
      .join('');
  } catch (err) {}
  $('skoleNavn').value = sky.skole || '';
  $('skoleNavn').focus();
  return new Promise((ferdig) => (skoleFerdig = ferdig));
}
$('stegSkole').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const st = (t, v) => {
    $('skoleStatus').textContent = t;
    $('skoleStatus').className = 'status' + (v ? ' varsel' : '');
  };
  const skrevet = $('skoleNavn').value.trim();
  if (!skrevet) return st('Velg skolen din.', true);
  const navn = skolevalg.find(
    (n) => n.toLowerCase() === skrevet.toLowerCase(),
  );
  if (!navn)
    return st(
      'Velg en skole fra listen. Står den ikke der, send e-post til hvemsitterhvor@gmail.com.',
      true,
    );
  $('skoleKnapp').disabled = true;
  try {
    sky.skole = skyFeil(
      await sky.klient.rpc('sett_skole', { p_skole: navn }),
    );
    const f = skoleFerdig;
    skoleFerdig = null;
    if (f) f(true);
  } catch (err) {
    st(err.message || String(err), true);
  } finally {
    $('skoleKnapp').disabled = false;
  }
});
$('skoleAvbryt').addEventListener('click', () => {
  const f = skoleFerdig;
  skoleFerdig = null;
  if (f) f(false);
});
async function byttSkole() {
  await tomSynk();
  const endret = await velgSkole(true);
  if (endret) {
    (await hentSky())();
    await hentMedlemmer();
    visBeskjed('Du ser nå rommene til ' + sky.skole + '.');
  }
  lukkInngang();
  visOversikt();
}

async function startSky() {
  try {
    localStorage.setItem(MODUS, 'sky');
  } catch (err) {}
  if ($('innHusk').checked) await huskNokkel(sky.id, sky.privat);
  else await glemNokler();
  if (!sky.skole) await velgSkole(false);
  innStatus('Henter klassene …');
  (await hentSky())();
  sky.klar = true;
  await hentMedlemmer();
  lukkInngang();
  oppdaterKontoUi();
  tegn();
  visOversikt();
  const harKlasser = Object.values(D.klasser).some(
    (k) => k.elever.length,
  );
  if (
    !harKlasser &&
    lokaleData().length &&
    (await bekreft(
      'Vi fant klasser lagret i denne nettleseren. Vil du flytte dem til kontoen din?',
      'Flytt',
    ))
  )
    flyttLokale();
}

/* ============ oppstart ============ */
async function startLokal() {
  const lagret = await lager.hent(LOKAL);
  if (lagret && lagret.klasser && lagret.rom) D = lagret;
  else {
    // første gang med denne versjonen: hent fra eldre lagring
    const gamle = gamleData();
    D = gamle.length ? gamle[0] : standarddata();
    normaliser();
    gamle.slice(1).forEach((d) => slaaSammen(d));
  }
  normaliser();
  angrestabel = [];
  $('angre').disabled = true;
  apenElev = null;
  oppdaterKontoUi();
  tegn();
  visOversikt();
}
/* Innlogget fra før, og nøkkelen er husket: rett inn uten passord */
async function laasOppAutomatisk(sesjon) {
  const privat = await husketNokkel(sesjon.user.id);
  if (!privat) return false;
  sky.id = sesjon.user.id;
  sky.epost = sesjon.user.email;
  try {
    const profil = await hentProfil();
    if (!profil) return false;
    try {
      await brukNokler(profil, privat);
    } catch (err) {
      // nøkkelen passer ikke lenger (f.eks. nye nøkler etter «glemt
      // passord»): glem den og be om passord
      await glemNokler();
      return false;
    }
    await startSky();
    return true;
  } catch (err) {
    console.warn('Automatisk opplåsing feilet', err);
    sky.privat = null;
    sky.klar = false;
    return false;
  }
}
(async function () {
  let modus = null;
  try {
    modus = localStorage.getItem(MODUS);
  } catch (err) {}
  const fraGlemt = /type=recovery/.test(location.hash);
  if (modus === 'lokal' && !fraGlemt) return startLokal();
  if (!window.supabase) {
    visInngang('stegInn');
    innStatus(
      'Får ikke kontakt med skyen. Sjekk nettet, eller bruk uten konto.',
      true,
    );
    return;
  }
  sky.klient = window.supabase.createClient(SKY.url, SKY.nokkel);
  sky.klient.auth.onAuthStateChange((hendelse) => {
    if (hendelse === 'PASSWORD_RECOVERY') visPassordsteg('glemt');
  });
  const { data } = await sky.klient.auth.getSession();
  if (
    data.session &&
    !fraGlemt &&
    (await laasOppAutomatisk(data.session))
  )
    return;
  visInngang('stegInn');
  if (fraGlemt) visPassordsteg('glemt');
  else if (data.session) {
    $('innEpost').value = data.session.user.email;
    innStatus('Skriv passordet for å låse opp klassene.');
    $('innPassord').focus();
  } else $('innEpost').focus();
})();
