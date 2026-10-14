// GitHub 저장 — 이력·단어장·학습 기록은 이 기기(PC·브라우저)에 저장하지 않음
// · 모든 데이터는 이 창의 메모리에만 두고, 비공개 저장소의 data.json 한 파일에만 저장
// · GitHub 토큰도 기기에 저장하지 않음: 창을 열 때마다 비밀번호로 access.json(암호화된 토큰)을 풀어 메모리에만 둠
// · 창을 닫으면 이 기기에는 아무것도 남지 않음 (localStorage·쿠키·IndexedDB·서비스워커 캐시 미사용)
(function () {
  const H_MAX = 1000, TOMB_DAYS = 365;
  const ACCESS_URL = 'access.json';
  const PBKDF2_ITER = 600000;

  // ---- 메모리 저장소 (이 창이 열려 있는 동안만) ----
  const MEM = new Map();
  const Mem = {
    get(k, d) { return MEM.has(k) ? structuredClone(MEM.get(k)) : d; },
    set(k, v) { MEM.set(k, structuredClone(v)); },
    del(k) { MEM.delete(k); }
  };
  const K = { H: 'history', V: 'vocab', S: 'study', T: 'tomb', SET: 'settings', C: 'config' };
  const read = Mem.get, write = Mem.set;
  const stamp = x => x.u || x.t || 0;

  // ---- 예전 버전이 이 기기에 남긴 데이터: 읽어서 메모리로 옮기고, GitHub에 올린 뒤 기기에서 삭제 ----
  const LEGACY = { H: 'offline-translator-history', V: 'offline-translator-vocab', S: 'ed-study',
                   T: 'offline-translator-tomb', C: 'offline-translator-sync', OK: 'offline-translator-online-ok' };
  const LEGACY_JUNK = /^(ed-lesson-|ed-mode$|offline-translator-)/;   // 캐시·화면 상태 등 옮길 필요 없는 것
  let legacy = { count: 0, keys: [] };
  (function adoptLegacy() {
    let ls; try { ls = window.localStorage; } catch { return; }
    if (!ls) return;
    const get = k => { try { return JSON.parse(ls.getItem(k)); } catch { return null; } };
    const h = get(LEGACY.H), v = get(LEGACY.V), s = get(LEGACY.S), t = get(LEGACY.T), c = get(LEGACY.C);
    if (Array.isArray(h)) write(K.H, h);
    if (Array.isArray(v)) write(K.V, v);
    if (Array.isArray(s)) write(K.S, s);
    if (t && typeof t === 'object') write(K.T, t);
    if (c && c.repo && c.token) write(K.C, { repo: c.repo, token: c.token, how: 'legacy' });
    let ok = null; try { ok = ls.getItem(LEGACY.OK); } catch {}
    if (ok === '1') write(K.SET, { onlineOk: { v: true, u: 1 } });
    legacy.count = (h?.length || 0) + (v?.length || 0) + (s?.length || 0);
    // 옮길 필요 없는 항목(학습 자료 캐시, 화면 모드, 동의 여부)은 바로 삭제
    const keys = []; try { for (let i = 0; i < ls.length; i++) keys.push(ls.key(i)); } catch {}
    legacy.keys = keys.filter(k => LEGACY_JUNK.test(k) || Object.values(LEGACY).includes(k));
    for (const k of legacy.keys) if (![LEGACY.H, LEGACY.V, LEGACY.S, LEGACY.T, LEGACY.C].includes(k)) { try { ls.removeItem(k); } catch {} }
    legacy.keys = legacy.keys.filter(k => [LEGACY.H, LEGACY.V, LEGACY.S, LEGACY.T, LEGACY.C].includes(k));
    if (!legacy.keys.length) legacy.count = 0;
  })();
  function wipeLegacy() {
    try { for (const k of legacy.keys) localStorage.removeItem(k); } catch {}
    legacy = { count: 0, keys: [] };
  }

  // 예전 버전의 오프라인 캐시(서비스워커) 제거
  (async function dropServiceWorker() {
    try {
      if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      if (self.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch {}
  })();

  // ---- 병합 (순서와 무관하게 같은 결과: 여러 번 해도 안전) ----
  function merge(a, b) {
    const tomb = { ...(a.tomb || {}) };
    for (const [id, t] of Object.entries(b.tomb || {})) if (!(tomb[id] >= t)) tomb[id] = t;
    const cutoff = Date.now() - TOMB_DAYS * 864e5;
    for (const id in tomb) if (tomb[id] < cutoff) delete tomb[id];

    const unite = (x, y) => {
      const m = new Map();
      for (const it of [...(x || []), ...(y || [])]) {
        if (!it || typeof it.id !== 'string') continue;
        const cur = m.get(it.id);
        if (!cur || stamp(cur) < stamp(it)) m.set(it.id, it);
      }
      return [...m.values()].filter(it => !(tomb[it.id] >= stamp(it)));
    };

    const history = unite(a.history, b.history).sort((p, q) => q.t - p.t).slice(0, H_MAX);
    // 단어장: 두 기기에서 같은 단어를 따로 추가한 경우 하나만 남김 (최근 수정본)
    const byWord = new Map();
    for (const v of unite(a.vocab, b.vocab)) {
      const k = String(v.word || '').toLowerCase();
      const cur = byWord.get(k);
      if (!cur) { byWord.set(k, v); continue; }
      const [keep, drop] = stamp(v) > stamp(cur) || (stamp(v) === stamp(cur) && v.id > cur.id) ? [v, cur] : [cur, v];
      byWord.set(k, keep);
      tomb[drop.id] = Math.max(tomb[drop.id] || 0, stamp(drop));
    }
    const vocab = [...byWord.values()].sort((p, q) => q.t - p.t);
    const study = unite(a.study, b.study).sort((p, q) => String(p.lessonId).localeCompare(String(q.lessonId)));
    const settings = { ...(a.settings || {}) };
    for (const [k, s] of Object.entries(b.settings || {})) if (!settings[k] || (settings[k].u || 0) < (s.u || 0)) settings[k] = s;
    return { v: 1, history, vocab, study, settings, tomb };
  }

  const local = () => ({ history: read(K.H, []), vocab: read(K.V, []), study: read(K.S, []),
                         settings: read(K.SET, {}), tomb: read(K.T, {}) });
  const same = (x, y) => ['history', 'vocab', 'study', 'settings', 'tomb'].every(k =>
    JSON.stringify(x[k] || (k === 'settings' || k === 'tomb' ? {} : [])) === JSON.stringify(y[k] || (k === 'settings' || k === 'tomb' ? {} : [])));

  // ---- base64 ----
  const bytesToB64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const b64ToBytes = b64 => { const bin = atob(b64.replace(/\s/g, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const b64encode = str => bytesToB64(new TextEncoder().encode(str));
  const b64decode = b64 => new TextDecoder().decode(b64ToBytes(b64));

  // ---- 비밀번호 잠금 (토큰을 기기에 저장하지 않기 위해) ----
  // access.json = 비밀번호로 암호화한 {저장소, 토큰}. 공개 저장소에 두어도 비밀번호 없이는 풀 수 없음
  async function deriveKey(pass, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base,
                                   { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function makeAccess(repo, token, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt, PBKDF2_ITER);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
                                                          new TextEncoder().encode(JSON.stringify({ r: repo, k: token }))));
    return JSON.stringify({ v: 1, kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct) }, null, 1) + '\n';
  }
  let accessCache;   // undefined: 아직 확인 전, null: 없음
  async function access() {
    if (accessCache !== undefined) return accessCache;
    try {
      const r = await fetch(ACCESS_URL + '?t=' + Date.now(), { cache: 'no-store' });
      accessCache = r.ok ? await r.json() : null;
    } catch { accessCache = undefined; return null; }
    return accessCache;
  }
  async function unlock(pass) {
    const a = await access();
    if (!a) throw new Error('잠금 파일(access.json)이 아직 없습니다. 아래 [처음 설정]을 먼저 해 주세요');
    let j;
    try {
      const key = await deriveKey(pass, b64ToBytes(a.salt), a.iter || PBKDF2_ITER);
      j = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(a.iv) }, key, b64ToBytes(a.ct))));
    } catch { throw new Error('비밀번호가 맞지 않습니다'); }
    return connect(j.r, j.k, 'pass');
  }

  // ---- GitHub API ----
  const config = () => read(K.C, null);
  const configured = () => { const c = config(); return !!(c && c.repo && c.token); };

  async function gh(c, method, url, body) {
    return fetch('https://api.github.com/repos/' + c.repo + url, {
      method, cache: 'no-store', credentials: 'omit',
      headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  }

  function explain(status) {
    if (status === 401) return '토큰이 올바르지 않거나 만료되었습니다';
    if (status === 403) return '토큰에 이 저장소 쓰기 권한(Contents: Read and write)이 없습니다';
    if (status === 404) return '저장소를 찾을 수 없습니다 (이름 또는 토큰의 저장소 선택 확인)';
    return 'GitHub 응답 오류 (' + status + ')';
  }

  async function fileText(c, j) {
    if (j.content && j.encoding === 'base64') return b64decode(j.content);
    const b = await gh(c, 'GET', '/git/blobs/' + j.sha);   // 1MB 넘는 파일은 blob으로 받음
    if (!b.ok) throw new Error(explain(b.status));
    return b64decode((await b.json()).content);
  }

  async function pull(c) {
    const r = await gh(c, 'GET', '/contents/data.json');
    if (r.status === 404) {
      const repo = await gh(c, 'GET', '');   // 파일이 없는 것인지, 저장소 자체가 없는 것인지 구분
      if (!repo.ok) throw new Error(explain(repo.status));
      return { data: { history: [], vocab: [], study: [], settings: {}, tomb: {} }, sha: null };
    }
    if (!r.ok) throw new Error(explain(r.status));
    const j = await r.json();
    let data;
    try { data = JSON.parse(await fileText(c, j)); } catch (e) { throw new Error(e.message.startsWith('GitHub') ? e.message : '저장소의 data.json 형식이 올바르지 않습니다'); }
    return { data, sha: j.sha };
  }

  async function push(c, data, sha) {
    const d = new Date();
    const r = await gh(c, 'PUT', '/contents/data.json', {
      message: 'sync ' + d.toISOString().slice(0, 16).replace('T', ' ') + ' (' + device() + ')',
      content: b64encode(JSON.stringify(data)),
      ...(sha ? { sha } : {})
    });
    if (r.status === 409 || r.status === 422) return false;   // 그 사이 다른 기기가 먼저 올림 → 다시 시도
    if (!r.ok) throw new Error(explain(r.status));
    return true;
  }

  function device() {
    const ua = navigator.userAgent;
    return /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'web';
  }

  // 저장소의 다른 JSON 파일 읽기 (학습 자료 등). 없으면 null
  async function getJSON(path) {
    const c = config();
    if (!c || !c.repo || !c.token) throw new Error('잠금이 풀려 있지 않습니다');
    const r = await gh(c, 'GET', '/contents/' + path.split('/').map(encodeURIComponent).join('/'));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(explain(r.status));
    return JSON.parse(await fileText(c, await r.json()));
  }

  // ---- 저장 실행 ----
  let running = null, again = false, timer = null, dirty = false;
  const listeners = new Set();
  const state = { status: 'idle', msg: '', at: 0 };
  function setState(status, msg) {
    state.status = status; state.msg = msg || '';
    if (status === 'ok') state.at = Date.now();
    listeners.forEach(f => { try { f(state); } catch {} });
  }

  async function runOnce() {
    const c = config();
    if (!c || !c.repo || !c.token) { setState('off'); return; }
    setState('busy', '저장 중…');
    for (let attempt = 0; attempt < 4; attempt++) {
      dirty = false;
      const before = local();
      const { data: remote, sha } = await pull(c);
      const merged = merge(before, remote);
      const remoteSame = sha && same(merged, remote);
      if (!remoteSame && !(await push(c, merged, sha))) { dirty = true; continue; }
      // 저장하는 동안 이 창에서 바뀐 내용도 잃지 않도록 한 번 더 합침
      const final = merge(merged, local());
      write(K.H, final.history); write(K.V, final.vocab); write(K.S, final.study); write(K.SET, final.settings); write(K.T, final.tomb);
      if (!same(final, merged)) { again = true; dirty = true; }
      if (legacy.count || legacy.keys.length) wipeLegacy();   // GitHub에 올라갔으니 이 기기에 남은 예전 데이터 삭제
      setState('ok', 'GitHub에 저장됨');
      Sync.onApplied && Sync.onApplied();
      return;
    }
    dirty = true;
    throw new Error('다른 기기와 동시에 저장되어 잠시 후 다시 시도합니다');
  }

  function run() {
    clearTimeout(timer); timer = null;
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do { again = false; await runOnce(); } while (again);
      } catch (e) {
        dirty = true;
        setState('err', /fetch|network|Failed/i.test(e.message || '') ? '인터넷(api.github.com)에 연결하지 못해 저장하지 못했습니다' : (e.message || '저장 실패'));
      } finally { running = null; }
    })();
    return running;
  }

  // 변경 직후 잠시 모아서 저장 (연속 입력 시 요청 수 절약)
  function schedule(ms = 1500) {
    dirty = true;
    if (!configured()) { setState('off'); return; }
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }
  const markDirty = () => { dirty = true; };

  // 지운 항목 기록 (다른 기기에서 되살아나지 않도록)
  function tomb(ids) {
    const t = read(K.T, {}), now = Date.now();
    for (const id of [].concat(ids)) if (id) t[id] = now;
    write(K.T, t);
    schedule();
  }

  function normRepo(repo) {
    repo = String(repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('저장소는 "아이디/저장소이름" 형식으로 입력해 주세요');
    return repo;
  }
  // 이 창에서만 연결 (메모리에만 보관)
  function connect(repo, token, how = 'token') {
    repo = normRepo(repo); token = String(token || '').trim();
    if (!token) throw new Error('토큰을 입력해 주세요');
    write(K.C, { repo, token, how });
    return run();
  }
  function lock() { Mem.del(K.C); setState('off'); }

  const getSetting = k => (read(K.SET, {})[k] || {}).v;
  function setSetting(k, v) { const s = read(K.SET, {}); s[k] = { v, u: Date.now() }; write(K.SET, s); schedule(); }

  // 화면으로 돌아오면 다른 기기 변경분 받기, 화면을 벗어나면 바로 저장
  document.addEventListener('visibilitychange', () => {
    if (!configured()) return;
    if (document.visibilityState === 'hidden') { if (dirty) run(); }
    else if (Date.now() - state.at > 15000) run();
  });
  window.addEventListener('online', () => { if (configured()) run(); });
  // 아직 GitHub에 올라가지 않은 변경이 있으면 창을 닫기 전에 확인 (이 기기에는 남지 않으므로)
  window.addEventListener('beforeunload', e => {
    if (dirty || running) { if (configured()) run(); e.preventDefault(); e.returnValue = ''; }
  });

  if (legacy.count) dirty = true;   // 예전 데이터는 아직 GitHub에 올라가지 않았을 수 있음

  window.Mem = Mem;
  window.Sync = { run, schedule, markDirty, tomb, connect, unlock, lock, makeAccess, access, getJSON, configured, config,
                  merge, state, getSetting, setSetting, K,
                  dirty: () => dirty, legacy: () => legacy, wipeLegacy,
                  onState: f => { listeners.add(f); f(state); }, onApplied: null };
})();
