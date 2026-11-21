// Syntax highlighter ringan (tanpa CDN, tanpa dependensi) untuk bahasa yang umum dipakai developer.
// Keluaran: HTML dengan <span class="tk-{c|s|n|k|l|f|t|a}">. Semua teks di-escape.

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const words = (s) => new Set(s.split(' '));
const LIT = words('true false null undefined None True False nil NULL NaN Infinity');
const MAX = 150000; // di atas ini lewati highlight agar editor tetap responsif

const JS = 'async await break case catch class const continue debugger default delete do else export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield';
const CFG = {
  javascript: { kw: JS, c: 'slash', bt: 1 },
  typescript: { kw: JS + ' interface type enum implements public private protected readonly abstract as namespace declare keyof', c: 'slash', bt: 1 },
  python: { kw: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case', c: 'hash', tri: 1 },
  bash: { kw: 'if then else elif fi for while do done case esac in function return export local readonly source alias unset echo cd exit set sudo', c: 'hash', dash: 1 },
  sql: { kw: 'select from where insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as and or not null is in exists union all distinct primary key foreign references default unique constraint begin commit rollback case when then else end', c: 'dash2', ci: 1 },
  go: { kw: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var', c: 'slash', bt: 1 },
  rust: { kw: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while', c: 'slash' },
  java: { kw: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static super switch synchronized this throw throws try void volatile while', c: 'slash' },
  kotlin: { kw: 'as break class continue do else for fun if in interface is null object package return super this throw try typealias val var when while override private public protected internal data sealed suspend', c: 'slash' },
  swift: { kw: 'class struct enum protocol extension func let var if else guard switch case default for while in return import init self super try catch throw async await private public internal', c: 'slash' },
  c: { kw: 'auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define ifdef ifndef endif', c: 'slash' },
  cpp: { kw: 'auto break case char class const continue default delete do double else enum explicit extern float for friend goto if inline int long namespace new operator private protected public return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while include define ifdef ifndef endif String Serial', c: 'slash' },
  csharp: { kw: 'abstract as base bool break byte case catch char class const continue decimal default delegate do double else enum event explicit extern finally fixed float for foreach if implicit in int interface internal is lock long namespace new object operator out override params private protected public readonly ref return sealed short sizeof static string struct switch this throw try typeof uint ulong unsafe ushort using var virtual void volatile while async await', c: 'slash' },
  php: { kw: 'abstract and array as break case catch class clone const continue declare default do echo else elseif empty extends final finally fn for foreach function global if implements include instanceof interface isset namespace new or print private protected public require return static switch throw trait try use var while yield', c: 'slashhash' },
  ruby: { kw: 'alias and begin break case class def defined do else elsif end ensure for if in module next nil not or redo rescue retry return self super then undef unless until when while yield', c: 'hash' },
  lua: { kw: 'and break do else elseif end for function goto if in local not or repeat return then until while', c: 'dash2' },
  css: { kw: '', c: 'cssc', dash: 1 },
  yaml: { kw: '', c: 'hash', dash: 1, key: 1 },
  toml: { kw: '', c: 'hash', dash: 1, key: 1 },
  ini: { kw: '', c: 'hash', dash: 1, key: 1 },
  json: { kw: '', c: 'none', key: 1 },
  docker: { kw: 'from run cmd label expose env add copy entrypoint volume user workdir arg onbuild stopsignal healthcheck shell as', c: 'hash', ci: 1, dash: 1 },
  hcl: { kw: 'resource variable output module provider data locals terraform for in if', c: 'slashhash', dash: 1 },
  routeros: { kw: 'add set remove print export import enable disable find get comment ip interface bridge routing firewall filter nat address dhcp-server dns system user queue tool ping', c: 'hash', dash: 1 },
};
const ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash', yml: 'yaml', rs: 'rust', golang: 'go', 'c++': 'cpp', cs: 'csharp', rb: 'ruby', dockerfile: 'docker', mikrotik: 'routeros', tf: 'hcl', jsx: 'javascript', tsx: 'typescript' };
const CM = {
  slash: '\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/', hash: '#[^\\n]*', dash2: '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/',
  slashhash: '\\/\\/[^\\n]*|#[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/', cssc: '\\/\\*[\\s\\S]*?\\*\\/', none: '(?!)',
};
const cache = {};

function build(name) {
  const c = CFG[name];
  const com = CM[c.c === 'dash' ? 'dash2' : c.c];
  let str = '"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'';
  if (c.bt) str += '|`(?:\\\\.|[^`\\\\])*`';
  if (c.tri) str = '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|' + str;
  const word = c.dash ? '[A-Za-z_$][\\w$.-]*' : '[A-Za-z_$][\\w$]*';
  return {
    kw: words(c.ci ? c.kw.toLowerCase() : c.kw), ci: c.ci, key: c.key,
    re: new RegExp(`(${com})|(${str})|(\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?\\b)|(${word})`, 'g'),
  };
}

const MARKUP = /(<!--[\s\S]*?-->)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(<\/?[A-Za-z][\w:-]*|\/?>)|([A-Za-z_:][\w:.-]*(?==))/g;

function markup(code) {
  let out = '', last = 0, m;
  MARKUP.lastIndex = 0;
  while ((m = MARKUP.exec(code))) {
    if (!m[0]) { MARKUP.lastIndex++; continue; }
    out += esc(code.slice(last, m.index));
    last = MARKUP.lastIndex;
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 't' : 'a';
    out += `<span class="tk-${cls}">${esc(m[0])}</span>`;
  }
  return out + esc(code.slice(last));
}

export function highlight(code, lang = 'plaintext') {
  lang = ALIAS[lang] || lang;
  if (code.length > MAX) return esc(code);
  if (lang === 'html' || lang === 'xml') return markup(code);
  if (!CFG[lang]) return esc(code);
  const cfg = cache[lang] || (cache[lang] = build(lang));
  const re = cfg.re;
  re.lastIndex = 0;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    if (!m[0]) { re.lastIndex++; continue; }
    out += esc(code.slice(last, m.index));
    last = re.lastIndex;
    let cls = '';
    if (m[1] !== undefined) cls = 'c';
    else if (m[2] !== undefined) cls = cfg.key && /^\s*:/.test(code.slice(last, last + 6)) ? 'a' : 's';
    else if (m[3] !== undefined) cls = 'n';
    else {
      const w = m[4];
      if (cfg.kw.has(cfg.ci ? w.toLowerCase() : w)) cls = 'k';
      else if (LIT.has(w)) cls = 'l';
      else if (cfg.key && /^\s*[:=]/.test(code.slice(last, last + 4))) cls = 'a';
      else if (code[last] === '(') cls = 'f';
    }
    out += cls ? `<span class="tk-${cls}">${esc(m[0])}</span>` : esc(m[0]);
  }
  return out + esc(code.slice(last));
}
