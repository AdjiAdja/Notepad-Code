// Boot aplikasi: akun, store, sinkron, UI, pintasan, kunci otomatis.
import { Store } from './store.js';
import { Sync } from './sync.js';
import { api, onAuthLost } from './api.js';
import * as auth from './auth.js';
import { applyBg } from './bg.js';
import { actions } from './actions.js';
import { toast, closeAllModals } from './ui/dom.js';
import { mountExplorer } from './ui/explorer.js';
import { mountCenter } from './ui/center.js';
import { mountSide } from './ui/side.js';
import { mountTop } from './ui/top.js';
import { mountDialogs } from './ui/dialogs.js';

const PREF = 'mni.prefs';
const loadPrefs = () => { try { return { bg: 'hitam', autolock: 15, blockSecrets: true, ...JSON.parse(localStorage.getItem(PREF) || '{}') }; } catch { return { bg: 'hitam', autolock: 15, blockSecrets: true }; } };

const store = new Store();
const sync = new Sync(store);
const app = { store, sync, toast, user: null, offline: false, prefs: loadPrefs(), status: () => {} };
app.act = actions(app);
app.setPref = (k, v) => { app.prefs[k] = v; try { localStorage.setItem(PREF, JSON.stringify(app.prefs)); } catch { /* abaikan */ } };
store.settings.blockSecrets = app.prefs.blockSecrets;
window.__app = app; // untuk debugging & uji E2E

app.panic = async () => { await store.lockAll(); closeAllModals(); store.emit('wss'); toast('Semua vault dikunci', 'ok'); };

async function useScope() {
  sync.enabled = !!app.user && !app.offline;
  await store.init(auth.scopeOf(app.user));
  store.settings.blockSecrets = app.prefs.blockSecrets;
  store.emit('wss');
  if (sync.enabled) { try { await sync.pullWorkspaces(); } catch (e) { toast('Sinkron: ' + e.message, 'err'); } sync.run(); }
}
app.signedIn = async (user) => { app.user = user; app.offline = false; await useScope(); toast('Masuk sebagai ' + user.email, 'ok'); await maybeJoin(); };
app.logout = async () => { await store.lockAll(); await auth.logout(); app.user = null; app.offline = false; await useScope(); toast('Keluar. Data akun tetap ada di perangkat ini dan muncul lagi saat Anda masuk.', 'info', 4500); };

onAuthLost(async () => { if (app.user) { app.user = null; sync.enabled = false; toast('Sesi berakhir. Masuk lagi untuk sinkron.', 'err'); await useScope(); } });

async function maybeJoin() {
  const code = new URLSearchParams(location.search).get('join') || sessionStorage.getItem('mni.join');
  if (!code) return;
  if (!app.user) { try { sessionStorage.setItem('mni.join', code); } catch { /* abaikan */ } toast('Masuk dengan Google untuk menerima undangan', 'info', 5000); return; }
  try { sessionStorage.removeItem('mni.join'); history.replaceState(null, '', location.pathname); const r = await api('/join', { method: 'POST', body: { code } }); await sync.pullWorkspaces(); await store.openWs(r.id); sync.run(); toast('Bergabung sebagai ' + r.role, 'ok'); } catch (e) { toast(e.message, 'err'); }
}

function shortcuts() {
  addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey && (k === 'k' || k === 'p')) { e.preventDefault(); app.dlg.palette(); }
    else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); app.dlg.search(); }
    else if (mod && e.shiftKey && k === 'l') { e.preventDefault(); app.panic(); }
    else if (mod && !e.shiftKey && k === 'l') { e.preventDefault(); store.lock(); }
    else if (mod && e.altKey && k === 'n') { e.preventDefault(); app.act.newFile(); }
    else if (mod && k === 's') {
      e.preventDefault();
      const n = store.nodes.get(store.active);
      if (n && n.type === 'file') store.flush().then(() => store.snapshot(n, 'Versi manual')).then((ok) => toast(ok ? 'Versi disimpan' : 'Tersimpan', 'ok', 1200));
    }
  });
}

function autolock() {
  let last = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => addEventListener(ev, () => { last = Date.now(); }, { passive: true }));
  setInterval(async () => {
    const m = app.prefs.autolock;
    if (m && Date.now() - last > m * 60000 && store.keys.size) { await store.lockAll(); store.emit('wss'); toast('Vault dikunci otomatis karena tidak aktif', 'info', 5000); }
  }, 15000);
}

async function boot() {
  applyBg(app.prefs.bg);
  const r = await auth.restore();
  app.user = r.user; app.offline = r.offline;
  sync.enabled = !!app.user && !app.offline;
  await store.init(auth.scopeOf(app.user));
  mountTop(app); mountExplorer(app); mountCenter(app); mountSide(app); mountDialogs(app);
  store.on('saved', (n) => { if (store.wsOf(n.ws)?.remote) { sync.schedule(2500); } });
  shortcuts(); autolock();
  addEventListener('online', () => sync.run());
  addEventListener('beforeunload', () => { store.flush(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); else sync.run(); });
  setInterval(() => sync.run(), 60000);
  store.emit('wss');
  if (sync.enabled) { try { await sync.pullWorkspaces(); } catch { /* offline */ } sync.run(); }
  await maybeJoin();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  document.documentElement.dataset.ready = '1';
}
boot().catch((e) => { console.error(e); document.body.prepend(Object.assign(document.createElement('pre'), { className: 'fatal', textContent: 'Gagal memulai: ' + e.message })); });
