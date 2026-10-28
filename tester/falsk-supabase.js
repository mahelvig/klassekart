/* Falsk Supabase-klient for testene. Den byttes inn i stedet for
   supabase-js fra CDN, og gir window.supabase.createClient() med de
   delene av API-et appen bruker. Alt lagres i localStorage, så både
   data og innlogging overlever at siden lastes på nytt, som med ekte
   Supabase. Tilgangsregler (RLS) etterlignes ikke. */
(function () {
  'use strict';
  const DB = 'falsk-supabase:db';
  const SESJON = 'falsk-supabase:sesjon';
  const les = (n, std) => JSON.parse(localStorage.getItem(n) || 'null') || std;
  const skriv = (n, v) => localStorage.setItem(n, JSON.stringify(v));
  const db = () =>
    les(DB, {
      brukere: {},
      tabeller: { profiler: [], klasser: [], klassemedlemmer: [], rom: [] },
      skoler: ['Testskolen'],
    });
  const sesjon = () => les(SESJON, null);
  const meg = () => (sesjon() ? sesjon().user : null);
  const svar = (data, error = null) => ({ data, error });
  const feil = (message, code) => ({ data: null, error: { message, code } });

  class Sporring {
    constructor(tabell) {
      this.tabell = tabell;
      this.filtre = [];
      this.handling = 'select';
      this.kolonner = '*';
      this.antall = 'mange';
    }
    select(k) {
      if (this.handling === 'select') this.kolonner = k || '*';
      else this.returner = k || '*';
      return this;
    }
    insert(rader) {
      this.handling = 'insert';
      this.rader = [].concat(rader);
      return this;
    }
    upsert(rader) {
      this.handling = 'upsert';
      this.rader = [].concat(rader);
      return this;
    }
    update(felt) {
      this.handling = 'update';
      this.felt = felt;
      return this;
    }
    delete() {
      this.handling = 'delete';
      return this;
    }
    eq(k, v) {
      this.filtre.push((r) => r[k] === v);
      return this;
    }
    in(k, liste) {
      this.filtre.push((r) => liste.includes(r[k]));
      return this;
    }
    single() {
      this.antall = 'en';
      return this;
    }
    maybeSingle() {
      this.antall = 'kanskje';
      return this;
    }
    then(ok, nei) {
      return Promise.resolve(this.utfor()).then(ok, nei);
    }
    utfor() {
      const d = db();
      const rader = d.tabeller[this.tabell];
      const treff = (r) => this.filtre.every((f) => f(r));
      const kutt = (r, k) =>
        !k || k === '*'
          ? { ...r }
          : Object.fromEntries(k.split(',').map((x) => [x.trim(), r[x.trim()]]));
      let ut = [];
      if (this.handling === 'select') ut = rader.filter(treff);
      else if (this.handling === 'insert' || this.handling === 'upsert') {
        for (const r of this.rader) {
          const ny = { id: crypto.randomUUID(), versjon: 1, ...r };
          if (this.tabell === 'rom' && !('skole' in r)) {
            const p = d.tabeller.profiler.find((x) => x.id === meg().id);
            ny.skole = p ? p.skole : null;
          }
          const nokkel = this.tabell === 'klassemedlemmer'
            ? (x) => x.klasse_id === ny.klasse_id && x.bruker_id === ny.bruker_id
            : (x) => x.id === ny.id;
          const i = rader.findIndex(nokkel);
          if (i >= 0 && this.handling === 'insert')
            return feil('duplicate key value', '23505');
          if (i >= 0) rader[i] = { ...rader[i], ...ny };
          else rader.push(ny);
          ut.push(ny);
        }
      } else if (this.handling === 'update') {
        rader.forEach((r, i) => {
          if (treff(r)) {
            rader[i] = { ...r, ...this.felt };
            ut.push(rader[i]);
          }
        });
      } else if (this.handling === 'delete') {
        ut = rader.filter(treff);
        d.tabeller[this.tabell] = rader.filter((r) => !treff(r));
      }
      skriv(DB, d);
      if (this.handling !== 'select' && !this.returner) return svar(null);
      ut = ut.map((r) => kutt(r, this.returner || this.kolonner));
      if (this.antall === 'en')
        return ut.length === 1 ? svar(ut[0]) : feil('fant ikke nøyaktig én rad');
      if (this.antall === 'kanskje') return svar(ut[0] || null);
      return svar(ut);
    }
  }

  const rpc = {
    skoler: (d) => d.skoler.map((skole) => ({ skole })),
    sett_skole: (d, { p_skole }) => {
      const navn = d.skoler.find((s) => s.toLowerCase() === p_skole.trim().toLowerCase());
      if (!navn) throw new Error('Skolen finnes ikke i listen');
      d.tabeller.profiler.find((p) => p.id === meg().id).skole = navn;
      d.tabeller.rom.forEach((r) => {
        if (r.opprettet_av === meg().id && !r.skole) r.skole = navn;
      });
      return navn;
    },
    medlemmer_i: (d, { p_klasser }) =>
      d.tabeller.klassemedlemmer
        .filter((m) => p_klasser.includes(m.klasse_id))
        .map((m) => ({
          klasse_id: m.klasse_id,
          bruker_id: m.bruker_id,
          epost: (d.tabeller.profiler.find((p) => p.id === m.bruker_id) || {}).epost,
        })),
    finn_kollega: (d, { p_epost }) =>
      d.tabeller.profiler
        .filter((p) => p.epost === p_epost)
        .map((p) => ({ id: p.id, offentlig_nokkel: p.offentlig_nokkel })),
    slett_min_konto: (d) => {
      const id = meg().id;
      d.tabeller.profiler = d.tabeller.profiler.filter((p) => p.id !== id);
      d.tabeller.klassemedlemmer = d.tabeller.klassemedlemmer.filter((m) => m.bruker_id !== id);
      Object.keys(d.brukere).forEach((e) => {
        if (d.brukere[e].id === id) delete d.brukere[e];
      });
      return null;
    },
  };

  const auth = {
    async signUp({ email, password }) {
      const d = db();
      if (!email.endsWith('@osloskolen.no'))
        return feil('Database error saving new user');
      if (d.brukere[email]) return feil('User already registered');
      const user = { id: crypto.randomUUID(), email };
      d.brukere[email] = { ...user, password };
      skriv(DB, d);
      skriv(SESJON, { user });
      return svar({ user, session: { user } });
    },
    async signInWithPassword({ email, password }) {
      const b = db().brukere[email];
      if (!b || b.password !== password) return feil('Invalid login credentials');
      const user = { id: b.id, email };
      skriv(SESJON, { user });
      return svar({ user, session: { user } });
    },
    async getSession() {
      return svar({ session: sesjon() });
    },
    async getUser() {
      return meg() ? svar({ user: meg() }) : feil('ingen bruker');
    },
    async updateUser({ password }) {
      const d = db();
      d.brukere[meg().email].password = password;
      skriv(DB, d);
      return svar({ user: meg() });
    },
    async signOut() {
      localStorage.removeItem(SESJON);
      return svar(null);
    },
    async resetPasswordForEmail() {
      return svar({});
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
  };

  window.supabase = {
    createClient: () => ({
      auth,
      from: (t) => new Sporring(t),
      async rpc(navn, arg) {
        const d = db();
        try {
          const r = rpc[navn](d, arg || {});
          skriv(DB, d);
          return svar(r);
        } catch (e) {
          return feil(e.message);
        }
      },
    }),
  };
})();
