// Pemindai rahasia sederhana: mendeteksi pola kunci/token umum agar tidak ikut tersinkron tanpa enkripsi.

const PATTERNS = [
  ['Kunci privat', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Token GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['Token Slack', /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/],
  ['Kunci API Google', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Kunci live Stripe', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/],
  ['JWT', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ['Kata sandi atau token di konfigurasi', /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"]?[^\s'"<>{}$]{8,}/i],
];

/** -> [{type, line}] (maks. 5000 baris pertama, satu temuan per baris). */
export function scan(text) {
  if (!text) return [];
  const out = [];
  const lines = text.split('\n', 5000);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 2000) continue;
    for (const [type, re] of PATTERNS) {
      if (re.test(l)) { out.push({ type, line: i + 1 }); break; }
    }
  }
  return out;
}
