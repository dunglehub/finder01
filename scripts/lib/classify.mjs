// Shared helpers used by both the fetch script and the page.

const MONTHS = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).join('|');
const MONTH_RE = new RegExp(`\\b(${MONTH_NAMES})\\.?,?\\s+(20\\d\\d)\\b`, 'i');
const SEASON_RE = /\b(spring|summer|fall|autumn|winter)\s+(20\d\d)\b/i;
const START_HINT_RE = /(start(?:ing|s)?|begin(?:ning|s)?|commenc\w*|available)/i;

// Only keep intern / co-op / student style roles (Benny wants these ONLY).
export function isEarlyCareer(title = '') {
  return /\b(co-?op|intern(ship)?s?|student|summer student|work term)\b/i.test(title);
}

export function isBC(location = '') {
  return /\b(BC|B\.C\.|British Columbia|Vancouver|Burnaby|Surrey|Richmond|Victoria|Pitt Meadows|Maple Ridge|Langley|Delta|Kelowna|Coquitlam|Abbotsford)\b/i.test(location);
}

export function mentionsSolidWorks(text = '') {
  return /solid\s?works/i.test(text);
}

function firstDate(chunk) {
  const m = chunk.match(MONTH_RE);
  const s = chunk.match(SEASON_RE);
  const mi = m ? m.index : Infinity;
  const si = s ? s.index : Infinity;
  if (mi === Infinity && si === Infinity) return null;
  if (mi <= si) {
    const month = MONTHS[m[1].toLowerCase()];
    return { label: `${cap(m[1])} ${m[2]}`, month, year: +m[2], season: null };
  }
  return { label: `${cap(s[1])} ${s[2]}`, month: null, year: +s[2], season: s[1].toLowerCase() };
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

// Look for a start date, preferring text close to words like "starting in".
export function detectStart(text = '') {
  const plain = text.replace(/\s+/g, ' ');
  const hint = plain.match(START_HINT_RE);
  if (hint) {
    const near = firstDate(plain.slice(hint.index, hint.index + 120));
    if (near) return near;
  }
  return firstDate(plain);
}

// true = fits May 2027, false = clearly a different term, null = not stated.
export function fitsMay2027(start) {
  if (!start) return null;
  if (start.year !== 2027) return false;
  if (start.season) return start.season === 'summer';
  return start.month >= 4 && start.month <= 6;
}

const KEYWORDS = [
  [/battery|batteries|pack|cell\b|bms/i, 4],
  [/\bev\b|electric vehicle|e-?mobility|powertrain/i, 3],
  [/energy storage|renewable|clean ?energy|solar|grid|power electronics/i, 3],
  [/solid\s?works/i, 4],
  [/\bcad\b|mechanical design|enclosure|thermal|prototyp/i, 2],
  [/mechanical/i, 2],
];

export function relevanceScore(text = '') {
  return KEYWORDS.reduce((sum, [re, w]) => sum + (re.test(text) ? w : 0), 0);
}

export function stripHtml(html = '') {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Adds the computed fields every card needs.
export function enrich(job) {
  const text = `${job.title} ${job.description || ''}`;
  // Titles often carry the term, e.g. "Hardware R&D Intern (May 2027)".
  const start = detectStart(`${job.title}. ${job.description || ''}`);
  return {
    ...job,
    bc: isBC(job.location),
    solidworks: mentionsSolidWorks(text),
    startLabel: start ? start.label : null,
    fitsMay: fitsMay2027(start),
    score: relevanceScore(text),
  };
}
