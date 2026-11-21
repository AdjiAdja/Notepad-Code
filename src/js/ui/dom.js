// Komponen DOM bersama: toast, modal, dialog tanya, menu konteks, pemilih folder.
import { h, $ } from '../util.js';

export function toast(msg, kind = 'info', ms = 3200) {
  const root = $('#toast');
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  root.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
}

let stack = [];
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const root = $('#mroot');
  const opener = document.activeElement;
  const close = (v) => {
    stack = stack.filter((m) => m !== api);
    wrap.remove();
    onClose?.(v);
    if (opener && opener.focus) opener.focus();
  };
  const bar = h('div', { class: 'm-actions' }, actions.map((a) => h('button', {
    type: 'button', class: 'btn ' + (a.primary ? 'primary ' : '') + (a.danger ? 'danger' : ''),
    onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try { const r = await a.onClick?.(api); if (r !== false) close(a.value); } catch (x) { toast(x.message || String(x), 'err'); } finally { btn.disabled = false; }
    },
  }, a.label)));
  const box = h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    h('div', { class: 'm-head' }, h('h2', {}, title), h('button', { type: 'button', class: 'x', 'aria-label': 'Tutup', onclick: () => close(null) }, '×')),
    h('div', { class: 'm-body' }, body),
    actions.length ? bar : null,
  ]);
  const wrap = h('div', { class: 'm-back', onmousedown: (e) => { if (e.target === wrap) close(null); } }, box);
  const api = { close, el: box, wrap };
  stack.push(api);
  root.append(wrap);
  setTimeout(() => (box.querySelector('[autofocus],input,textarea,select,button.primary') || box).focus(), 0);
  return api;
}
export const topModal = () => stack[stack.length - 1];
export const closeAllModals = () => [...stack].forEach((m) => m.close(null));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) { e.stopPropagation(); topModal().close(null); } }, true);

export function askText({ title, label, value = '', placeholder = '', ok = 'OK', password = false, hint = '' }) {
  return new Promise((res) => {
    const inp = h('input', { type: password ? 'password' : 'text', value, placeholder, autocomplete: 'off', spellcheck: 'false', autofocus: true });
    let done = false;
    const submit = (m) => { done = true; m.close(inp.value); };
    const m = modal({
      title, body: [h('label', { class: 'fld' }, h('span', {}, label || ''), inp), hint ? h('p', { class: 'hint' }, hint) : null],
      actions: [{ label: 'Batal', value: null }, { label: ok, primary: true, onClick: () => { done = true; return true; }, value: undefined }],
      onClose: (v) => res(done ? inp.value : null),
    });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(m); });
  });
}

export function confirmBox({ title, text, ok = 'Ya', danger = false }) {
  return new Promise((res) => {
    let yes = false;
    modal({
      title, body: h('p', {}, text),
      actions: [{ label: 'Batal' }, { label: ok, primary: !danger, danger, onClick: () => { yes = true; } }],
      onClose: () => res(yes),
    });
  });
}

let ctxOff = null;
export function ctxMenu(x, y, items) {
  const root = $('#ctx');
  ctxOff?.();
  root.replaceChildren(...items.filter(Boolean).map((it) => it === '-' ? h('hr') : h('button', {
    type: 'button', class: it.danger ? 'danger' : '', role: 'menuitem',
    onclick: () => { ctxOff?.(); it.run(); },
  }, it.label)));
  root.classList.add('on');
  root.style.left = Math.min(x, innerWidth - 200) + 'px';
  root.style.top = Math.min(y, innerHeight - root.children.length * 34 - 16) + 'px';
  const away = (e) => { if (!root.contains(e.target) || e.type === 'keydown') ctxOff?.(); };
  ctxOff = () => { root.classList.remove('on'); document.removeEventListener('mousedown', away, true); document.removeEventListener('keydown', away, true); ctxOff = null; };
  document.addEventListener('mousedown', away, true);
  document.addEventListener('keydown', away, true);
  root.querySelector('button')?.focus();
}

export function pickFolder(store, { title = 'Pilih folder', exclude = null } = {}) {
  return new Promise((res) => {
    let chosen, ok = false;
    const list = h('div', { class: 'pick' });
    const bad = new Set();
    if (exclude) { bad.add(exclude); const walk = (id) => store.children(id).forEach((c) => { bad.add(c.id); walk(c.id); }); walk(exclude); }
    const row = (label, id, depth) => h('button', { type: 'button', class: 'pk', style: { paddingLeft: 10 + depth * 16 + 'px' }, disabled: bad.has(id), onclick: (e) => { chosen = id; list.querySelectorAll('.pk').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); } }, label);
    const walk = (parent, depth) => store.children(parent).filter((n) => n.type === 'folder').forEach((f) => { list.append(row('▸ ' + f.name, f.id, depth)); walk(f.id, depth + 1); });
    list.append(row('/ (akar)', 'root', 0));
    walk('root', 1);
    modal({ title, body: list, actions: [{ label: 'Batal' }, { label: 'Pilih', primary: true, onClick: () => { if (chosen === undefined) return false; ok = true; } }], onClose: () => res(ok ? chosen : null) });
  });
}
