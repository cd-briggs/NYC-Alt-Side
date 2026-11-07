// Parking rules logic. No DOM or map code, so it can run in a browser or in node (for tests).
(function (root) {
  const DAYKEY = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
  const DAYRE = '(?:SUN|MON|TUE|WED|THU|FRI|SAT)[A-Z]*';
  const CAP = 7 * 1440;   // look ahead 7 days, in minutes
  const STEP = 10;        // scan resolution, in minutes
  const PROHIBIT = new Set(['nopark', 'nostop', 'nostand', 'restricted']);

  const dayOf = tok => DAYKEY[tok.slice(0, 3)];

  function clean(desc) {
    return desc.replace(/\(SUPERSEDES[^)]*\)/gi, '').replace(/\(SYMBOL\)/gi, '')
      .replace(/(<->|-->|<--)/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  }
  function toMin(h, m, ap) {
    h = +h; m = +(m || 0);
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }
  const TIMERE = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:-|TO)\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/g;
  const CLUSTERRE = new RegExp(DAYRE + '(?:\\s*(?:&|AND|,|THRU|THROUGH|TO|-)?\\s*' + DAYRE + ')*', 'g');

  function clusterDays(str) {
    const set = new Set();
    const r = str.match(new RegExp('(' + DAYRE + ')\\s*(?:THRU|THROUGH|TO|-)\\s*(' + DAYRE + ')'));
    if (r && dayOf(r[1]) !== undefined && dayOf(r[2]) !== undefined) {
      for (let d = dayOf(r[1]); ; d = (d + 1) % 7) { set.add(d); if (d === dayOf(r[2])) break; }
    } else {
      for (const m of str.matchAll(new RegExp(DAYRE, 'g'))) { const d = dayOf(m[0]); if (d !== undefined) set.add(d); }
    }
    return set;
  }
  // A sign can hold several schedules: "MON-FRI 3PM-7PM SATURDAY 9AM-7PM" is two.
  function parseSchedules(s) {
    s = s.replace(/MIDNIGH\s*T/g, 'MIDNIGHT').replace(/\bMIDNIGHT\b/g, '12AM').replace(/\bNOON\b/g, '12PM');   // "NOON-1:30PM", "MIDNIGHT-3AM"
    const exM = s.match(new RegExp('EXCEPT\\s+(' + DAYRE + '(?:\\s*(?:&|AND|,)\\s*' + DAYRE + ')*)'));
    const body = exM ? s.replace(exM[0], '') : s;
    const except = exM ? clusterDays(exM[1]) : new Set();
    const items = [];
    for (const m of body.matchAll(CLUSTERRE)) items.push({ t: 'd', i: m.index, days: clusterDays(m[0]) });
    for (const m of body.matchAll(TIMERE)) items.push({ t: 't', i: m.index, win: [toMin(m[1], m[2], m[3] || m[6]), toMin(m[4], m[5], m[6])] });
    items.sort((a, b) => a.i - b.i);
    const all = () => new Set([0, 1, 2, 3, 4, 5, 6]);
    const nDay = items.filter(x => x.t === 'd').length;
    let sched = [];
    if (nDay >= 2 && items[0].t === 'd') {
      for (const it of items) {
        if (it.t === 'd') sched.push({ days: it.days, windows: [] });
        else sched[sched.length - 1].windows.push(it.win);
      }
    } else {
      const days = new Set();
      items.filter(x => x.t === 'd').forEach(x => x.days.forEach(d => days.add(d)));
      if (/SCHOOL DAYS/.test(body)) [1, 2, 3, 4, 5].forEach(d => days.add(d));
      sched = [{ days: days.size ? days : all(), windows: items.filter(x => x.t === 't').map(x => x.win) }];
    }
    sched.forEach(sc => except.forEach(d => sc.days.delete(d)));
    return sched;
  }
  function parseSign(desc) {
    const s = clean(desc || '');
    const p = { text: s, raw: desc || '', kind: 'other', asp: /BROOM/.test(s) };
    const hmp = s.match(/(\d+(?:\/\d+)?)\s*HMP/);
    if (/NO STOPPING/.test(s)) p.kind = 'nostop';
    else if (/NO STANDING/.test(s)) p.kind = 'nostand';
    else if (/NO PARKING/.test(s)) p.kind = 'nopark';
    else if (hmp || (/\d+\s*(HR|HOUR|MIN)/.test(s) && /PARKING/.test(s))) p.kind = 'limit';
    else if (/TRUCKS? LOADING|COMMERCIAL VEHICLES|AUTHORIZED VEHICLES|HANDICAP|DIPLOMAT|BUS STOP|TAXI|HYDRANT|BIKE CORRAL/.test(s)) p.kind = 'restricted';
    p.metered = !!hmp || /METER/.test(s);
    const lim = hmp ? [null, hmp[1], 'HR'] : s.match(/(\d+)\s*(HR|HOUR|MIN)/);
    if (lim) { const n = lim[1].includes('/') ? 0.5 : +lim[1]; p.limitMin = n * (lim[2] === 'MIN' ? 1 : 60); }
    p.anytime = /ANYTIME/.test(s);
    p.sched = parseSchedules(s);
    p.days = p.sched[0].days; p.windows = p.sched[0].windows;
    // Rules that cover only part of a block face (bus stops, no-standing zones, loading zones, anytime no-parking)
    p.stretch = p.kind === 'nostand' || p.kind === 'nostop' || p.kind === 'restricted' || (p.kind === 'nopark' && p.anytime && !p.asp);
    return p;
  }

  const dateKey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

  function activeAt(p, dt, opts) {
    if (p.asp && opts && opts.suspended && opts.suspended.has(dateKey(dt))) return false;
    const day = dt.getDay(), m = dt.getHours() * 60 + dt.getMinutes();
    return p.sched.some(sc => !sc.windows.length ? sc.days.has(day) : sc.windows.some(([a, b]) => a <= b
      ? sc.days.has(day) && m >= a && m < b
      : (sc.days.has(day) && m >= a) || (sc.days.has((day + 6) % 7) && m < b)));
  }

  // Time grid for one arrival time: day-of-week, minute-of-day and date key every STEP minutes, plus a cache of when
  // each distinct sign text is active. Built once per arrival time, so evaluating hundreds of blocks stays fast.
  const N_STEPS = CAP / STEP + 1;
  let tlCache = null;
  function timeline(start, opts) {
    const sus = opts && opts.suspended ? [...opts.suspended].sort().join(',') : '';
    const key = start.getTime() + '|' + sus;
    if (tlCache && tlCache.key === key) return tlCache;
    const day = new Uint8Array(N_STEPS), min = new Uint16Array(N_STEPS), dk = new Array(N_STEPS);
    for (let i = 0; i < N_STEPS; i++) {
      const d = new Date(start.getTime() + i * STEP * 60000);
      day[i] = d.getDay(); min[i] = d.getHours() * 60 + d.getMinutes(); dk[i] = dateKey(d);
    }
    return (tlCache = { key, day, min, dk, act: new Map(), suspended: opts && opts.suspended });
  }
  function activeArr(p, tl) {
    let a = tl.act.get(p.text);
    if (!a) {
      a = new Uint8Array(N_STEPS);
      for (let i = 0; i < N_STEPS; i++) {
        if (p.asp && tl.suspended && tl.suspended.has(tl.dk[i])) continue;
        const day = tl.day[i], m = tl.min[i];
        a[i] = p.sched.some(sc => !sc.windows.length ? sc.days.has(day) : sc.windows.some(([x, y]) => x <= y
          ? sc.days.has(day) && m >= x && m < y
          : (sc.days.has(day) && m >= x) || (sc.days.has((day + 6) % 7) && m < y))) ? 1 : 0;
      }
      tl.act.set(p.text, a);
    }
    return a;
  }

  // How long can a car arriving at `start` stay? Returns minutes and details.
  function stay(parsed, start, opts) {
    const tl = timeline(start, opts);
    const pro = parsed.filter(p => PROHIBIT.has(p.kind)).map(p => activeArr(p, tl));
    const blocked = i => { for (const a of pro) if (a[i]) return true; return false; };
    if (blocked(0)) {
      let firstFree = -1;
      for (let i = 1; i < N_STEPS; i++) if (!blocked(i)) { firstFree = i; break; }
      return { min: 0, never: firstFree < 0, metered: false, opens: firstFree < 0 ? Infinity : firstFree * STEP };   // opens = minutes until legal
    }
    let end = CAP;
    for (let i = 1; i < N_STEPS; i++) if (blocked(i)) {
      end = i * STEP;
      const prohib = parsed.filter(p => PROHIBIT.has(p.kind));   // refine to the exact minute the rule starts
      for (let m = (i - 1) * STEP + 1; m < i * STEP; m++) {
        const t = new Date(start.getTime() + m * 60000);
        if (prohib.some(p => activeAt(p, t, opts))) { end = m; break; }
      }
      break;
    }
    // time-limited / metered signs active right now
    let meterEnd = 0;
    const lims = parsed.filter(p => p.kind === 'limit' && p.limitMin && activeArr(p, tl)[0]);
    for (const p of lims) {
      const a = activeArr(p, tl);
      let wEnd = CAP;
      for (let i = 1; i < N_STEPS; i++) if (!a[i]) { wEnd = i * STEP; break; }
      if (wEnd > p.limitMin) end = Math.min(end, p.limitMin);
      if (p.metered) meterEnd = Math.max(meterEnd, wEnd);     // minutes until no meter is running
    }
    return { min: end, never: false, metered: lims.some(p => p.metered), limited: lims.length > 0, meterEnd,
             capped: end >= CAP, until: new Date(start.getTime() + end * 60000) };
  }

  // Color buckets: red = never legal, violet = blocked now but opens up later, orange = must move by midnight tonight,
  // yellow = must move tomorrow (#FFF200, deepening the later you can leave),
  // green = stay past tomorrow (light = day after tomorrow, deepening to dark green at the 7-day limit).
  const dayNum = d => Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000 + 0.5);
  function colorFor(min, never, start) {
    if (never) return '#b3001b';
    if (min <= 0) return '#7e3fc0';
    const s0 = start || new Date(), end = new Date(s0.getTime() + min * 60000);
    const ahead = min >= CAP ? 7 : dayNum(new Date(end.getTime() - 60000)) - dayNum(s0);   // leaving at exactly midnight counts as today
    if (ahead <= 0) return '#f57c00';
    if (ahead === 1) {
      const f = Math.sqrt((end.getHours() * 60 + end.getMinutes()) / 1440);
      return 'hsl(57,100%,' + Math.round(50 - f * 10) + '%)';   // same yellow as #FFF200, deepening later in tomorrow like the greens deepen with longer stays
    }
    const f = Math.min(1, (ahead - 2) / 5);
    return 'hsl(' + Math.round(105 + f * 30) + ',' + Math.round(65 + f * 5) + '%,' + Math.round(55 - f * 29) + '%)';
  }
  // "Right now" view: what matters is the next hour. Red never; violet blocked for more than an hour; yellow opens up or
  // the meter switches off within an hour; orange you would have to leave within an hour; green open now.
  const SOON = 60;
  function colorNow(res) {
    if (res.never) return '#b3001b';
    if (res.min <= 0) return res.opens <= SOON ? '#FFF200' : '#7e3fc0';
    if (res.metered && res.meterEnd <= SOON) return '#FFF200';
    if (res.min <= SOON) return '#f57c00';
    return '#2e9e3f';
  }
  function fmt(min) {
    if (min >= CAP) return '7 days (the city\'s limit)';
    if (min < 60) return min + ' min';
    if (min < 1440) return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
    return Math.floor(min / 1440) + 'd ' + Math.floor((min % 1440) / 60) + 'h';
  }

  function normStreet(n) {
    return (n || '').toUpperCase().replace(/\./g, '')
      .replace(/\b(\d+)(ST|ND|RD|TH)\b/g, '$1')
      .replace(/\bFIRST\b/g, '1').replace(/\bSECOND\b/g, '2').replace(/\bTHIRD\b/g, '3').replace(/\bFOURTH\b/g, '4').replace(/\bFIFTH\b/g, '5').replace(/\bSIXTH\b/g, '6').replace(/\bSEVENTH\b/g, '7').replace(/\bEIGHTH\b/g, '8').replace(/\bNINTH\b/g, '9').replace(/\bTENTH\b/g, '10').replace(/\bELEVENTH\b/g, '11').replace(/\bTWELFTH\b/g, '12')
      .replace(/\bSAINT\b/g, 'ST').replace(/\bSTREET\b/g, 'ST').replace(/\bAVENUE\b/g, 'AVE')
      .replace(/\bPLACE\b/g, 'PL').replace(/\bROAD\b/g, 'RD').replace(/\bBOULEVARD\b/g, 'BLVD')
      .replace(/\bDRIVE\b/g, 'DR').replace(/\bPARKWAY\b/g, 'PKWY').replace(/\bCOURT\b/g, 'CT')
      .replace(/\bLANE\b/g, 'LN').replace(/\bTERRACE\b/g, 'TER')
      .replace(/\bCIRCLE\b/g, 'CIR').replace(/\bHIGHWAY\b/g, 'HWY').replace(/\bEXPRESSWAY\b/g, 'EXPY').replace(/\bPLAZA\b/g, 'PLZ')
      .replace(/\bSOUTHWEST\b/g, 'SW').replace(/\bSOUTHEAST\b/g, 'SE').replace(/\bNORTHWEST\b/g, 'NW').replace(/\bNORTHEAST\b/g, 'NE')
      .replace(/\bEAST\b/g, 'E').replace(/\bWEST\b/g, 'W').replace(/\bNORTH\b/g, 'N').replace(/\bSOUTH\b/g, 'S')
      .replace(/\s+/g, ' ').trim();
  }
  // compass letter (N/S/E/W) of a normal vector in x-east / y-north coordinates
  const cardinal = (nx, ny) => Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? 'E' : 'W') : (ny > 0 ? 'N' : 'S');

  // Diagonal streets (e.g. Parkside Ave) sit between two compass letters, so return both candidates.
  function cardinals(nx, ny) {
    const ax = Math.abs(nx), ay = Math.abs(ny), major = cardinal(nx, ny);
    const minor = ax > ay ? (ny > 0 ? 'N' : 'S') : (nx > 0 ? 'E' : 'W');
    return Math.min(ax, ay) >= 0.4 * Math.max(ax, ay) ? [major, minor] : [major];
  }

  const api = { parseSign, activeAt, stay, colorFor, colorNow, fmt, normStreet, cardinal, cardinals, dateKey, CAP, PROHIBIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ParkCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
