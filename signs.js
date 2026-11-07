// Draws a parking sign's dataset text (sign_description) the way the physical sign looks. No dependencies.
// SignRender.html(text) -> HTML string ('' for signs that are not parking rules); SignRender.install() adds the CSS once.
(function (root) {
  const RED = '#b3282d', DARKRED = '#98202e', GREEN = '#2b6b57';
  const CSS = `
  .sg { width: 200px; margin: 6px 0; border-radius: 5px; overflow: hidden; background: #fafafa; color: #222; box-sizing: border-box; border: 2.5px solid #888; box-shadow: 0 0 0 1px rgba(0,0,0,.25); font: 600 13px/1.2 "Helvetica Neue", Arial, sans-serif; }
  .sg .sgrow { display: flex; }
  .sg .tx { flex: 1; padding: 6px 9px 7px; display: flex; flex-direction: column; gap: 2px; justify-content: center; }
  .sg svg.ar { display: block; width: 72%; height: 16px; margin: 5px auto 0; }
  .sg .corner { width: 44px; height: 44px; flex: none; display: flex; align-items: center; justify-content: center; }   /* icon square, flush in the corner */
  .sg .icons { width: 44px; flex: none; display: flex; flex-direction: column; }                                    /* two icons: full-height column */
  .sg .icons > div { flex: 1; min-height: 44px; display: flex; align-items: center; justify-content: center; }
  .sg.red { background: ${RED}; border-color: ${RED}; color: #fff; outline: 1.5px solid #fff; outline-offset: -5px; }   /* thin white line inside the border, like the real panel */
  .sg.red .big { font-size: 17px; font-weight: 700; letter-spacing: .3px; }
  .sg.red .sub { font-size: 14px; }
  .sg.noparking { border-color: ${RED}; }
  .sg.noparking .big { color: ${RED}; font-size: 16px; font-weight: 700; }
  .sg .sub2 { font-size: 13px; }
  .sg.clean { border-color: ${DARKRED}; }
  .sg.clean .tx, .sg.clean .tx * { color: ${DARKRED}; }
  .sg .redbox { background: ${DARKRED}; color: ${DARKRED}; }     /* street cleaning is a darker maroon than the No Standing red; color = the gap line around the broom */
  .sg .night { background: #1d1d52; }
  .sg.meter { border-color: ${GREEN}; }
  .sg.meter .corner { background: ${GREEN}; color: #fff; font-size: 30px; font-weight: 700; }
  .sg.meter .words { padding: 5px 9px; line-height: 1.1; display: flex; align-items: center; }
  .sg.meter .tx, .sg.meter .words { color: #2d4a42; }
  .sg.meter .tx { font-size: 14px; padding-top: 2px; }
  .sg.bus { background: #1c5bb5; border-color: #1c5bb5; color: #fff; outline: 1.5px solid #fff; outline-offset: -5px; }
  .sg.bus .top { display: flex; align-items: center; gap: 8px; padding: 9px 12px 5px; }
  .sg.bus .top svg.ar { margin: 0; flex: 1; width: auto; }
  .sg.bus .strip { background: ${RED}; text-align: center; font-weight: 700; letter-spacing: .4px; padding: 3px 0 4px; font-size: 13px; margin: 0 5px 5px; }
  `;
  const arrowOf = t => /<-+>/.test(t) ? 'B' : /-+>/.test(t) ? 'R' : /<-+/.test(t) ? 'L' : null;
  // bold, wide arrow: thick shaft with solid heads
  const arrow = (dir, color) => !dir ? '' : `<svg class="ar" viewBox="0 0 120 16" preserveAspectRatio="none" fill="${color}" stroke="${color}">` +
    `<line x1="${dir === 'L' || dir === 'B' ? 12 : 2}" y1="8" x2="${dir === 'R' || dir === 'B' ? 108 : 118}" y2="8" stroke-width="6"/>` +
    (dir !== 'L' ? '<polygon points="104,0 120,8 104,16" stroke="none"/>' : '') + (dir !== 'R' ? '<polygon points="16,0 0,8 16,16" stroke="none"/>' : '') + '</svg>';
  const strip = t => t.replace(/\(SUPERSEDES[^)]*\)/g, '').replace(/<-+>|<-+|-+>/g, '').replace(/\s+/g, ' ').trim();
  const cap = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const DAYS = /\b(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\b/g;
  // "9:30AM-11AM" -> "9:30am – 11am"; "EXCEPT SUNDAY" -> "Except Sunday"
  const times = s => cap(s.replace(/MIDNIGHT/g, 'Midnight').replace(/NOON/g, 'Noon')).replace(/(\d)(Am|Pm)/g, (_, n, m) => n + m.toLowerCase()).replace(/\s*-\s*/g, ' – ');
  const ln = (s, cls) => s ? `<div${cls ? ` class="${cls}"` : ''}>${esc(s)}</div>` : '';

  // no-parking P in a ring with a push broom laid across it: thin handle toward the upper left, wide flat head at the lower right
  // (head is perpendicular to the handle). The broom has a thin outline in the box color so it reads over the P.
  const SYM_NOPARK = `<svg width="38" height="38" viewBox="0 0 34 34"><circle cx="17" cy="17" r="14.5" fill="none" stroke="#fff" stroke-width="2.4"/><text x="16" y="24" text-anchor="middle" font-size="21" font-weight="700" fill="#fff" font-family="Arial">P</text>` +
    `<g stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><line x1="6.5" y1="6.5" x2="21" y2="21" stroke-width="4.4"/><rect x="-9" y="-3.2" width="18" height="6.4" rx="1.2" fill="#fff" transform="translate(24 24) rotate(-45)"/></g>` +
    `<line x1="6.5" y1="6.5" x2="21" y2="21" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  const SYM_MOON = `<svg width="36" height="36" viewBox="0 0 34 34"><path d="M22 4a13 13 0 1 0 8 19 10 10 0 0 1-8-19z" fill="#fff"/><path d="M26 7l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" fill="#fff"/></svg>`;
  const BUS = `<svg width="44" height="40" viewBox="0 0 40 36"><rect x="6" y="2" width="28" height="27" rx="5" fill="#fff"/><rect x="10" y="6" width="20" height="10" rx="2" fill="#1c5bb5"/><circle cx="13" cy="23" r="2.2" fill="#1c5bb5"/><circle cx="27" cy="23" r="2.2" fill="#1c5bb5"/><rect x="9" y="29" width="5" height="5" rx="1" fill="#fff"/><rect x="26" y="29" width="5" height="5" rx="1" fill="#fff"/></svg>`;

  function html(raw) {
    const full = strip(raw || ''), dir = arrowOf(raw || '');
    if (!full || /PAY-BY-CELL|MTA BUS|LOCATION PANEL|PANEL \(/.test(full)) return '';
    // "EXCEPT SUNDAY" is an exception line, not a day the rule applies on
    const exceptions = [], body = full.replace(/EXCEPT\s+(?:(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)\b\s*)+/g, m => { exceptions.push(cap(m.trim())); return ''; });
    const days = body.match(DAYS) || [];
    const rest = body.replace('(SANITATION BROOM SYMBOL)', '').replace('MOON & STARS (SYMBOLS)', '').replace(DAYS, '').replace(/\s+/g, ' ').trim();

    if (/BROOM/.test(full)) {                                   // street cleaning
      const night = /MOON/.test(full), txt = days.map(d => ln(cap(d))).join('') + ln(times(rest.replace(/^NO PARKING\s*/, ''))) + exceptions.map(e => ln(e)).join('');
      if (night)                                                  // symbol + moon: a full-height column, arrow inside the text area
        return `<div class="sg clean"><div class="sgrow"><div class="icons"><div class="redbox">${SYM_NOPARK}</div><div class="night">${SYM_MOON}</div></div><div class="tx">${txt}${arrow(dir, DARKRED)}</div></div></div>`;
      return `<div class="sg clean"><div class="sgrow"><div class="corner redbox">${SYM_NOPARK}</div><div class="tx">${txt}</div></div><div class="tx" style="padding-top:0">${arrow(dir, DARKRED)}</div></div>`;
    }
    const hmp = full.match(/^(\d+(?:\/\d+)?)\s*HMP\s*(.*)$/);
    if (hmp) {                                                   // metered parking: same layout as the single-icon red/white signs, in green
      const tail = times(hmp[2]).replace(/ Except/, '\nExcept').split('\n');
      return `<div class="sg meter"><div class="sgrow"><div class="corner">${esc(hmp[1])}</div><div class="words">hour<br>metered<br>parking</div></div>` +
        `<div class="tx">${tail.map(t => ln(t)).join('')}${arrow(dir, GREEN)}</div></div>`;
    }
    if (/^BUS STOP/.test(full)) {                                // flat white bus on blue; "No Standing" strip when the sign says so
      return `<div class="sg bus"><div class="top">${BUS}${arrow(dir, '#fff')}</div><div class="strip">${/NO STANDING/.test(full) ? 'NO STANDING' : 'BUS STOP'}</div></div>`;
    }
    const m = full.match(/^NO (STOPPING|STANDING|PARKING)\s*(.*)$/);
    if (m) {
      const what = 'NO ' + m[1], tail = m[2].trim(), detail = /^ANYTIME$/.test(tail) ? 'Anytime' : times(tail);
      if (m[1] === 'PARKING') return `<div class="sg noparking"><div class="tx">${ln(what, 'big')}${ln(detail, 'sub2')}${arrow(dir, RED)}</div></div>`;
      return `<div class="sg red"><div class="tx">${ln(what, 'big')}${ln(detail, 'sub')}${arrow(dir, '#fff')}</div></div>`;
    }
    return `<div class="sg"><div class="tx">${ln(times(full.replace(/\([^)]*\)/g, '').trim()))}${arrow(dir, '#444')}</div></div>`;      // anything else: plain text sign
  }
  function install() { if (document.getElementById('sg-css')) return; const s = document.createElement('style'); s.id = 'sg-css'; s.textContent = CSS; document.head.appendChild(s); }
  root.SignRender = { html, install };
})(typeof window !== 'undefined' ? window : globalThis);
