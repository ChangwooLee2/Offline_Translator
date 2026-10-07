// GitHub 동기화 — 이력·단어장·학습 기록을 비공개 저장소의 data.json 한 파일로 여러 기기에서 공유
// 저장소·토큰 설정은 각 기기 브라우저(localStorage)에만 보관되고, GitHub API(api.github.com)로만 전송됨
(function () {
  const H_KEY = 'offline-translator-history', V_KEY = 'offline-translator-vocab';
  const S_KEY = 'ed-study';                     // 데일리 학습 기록
  const T_KEY = 'offline-translator-tomb';      // 삭제 기록 {id: 삭제 시각} — 다른 기기에서 지운 항목이 되살아나지 않게
  const C_KEY = 'offline-translator-sync';      // {repo, token, path, last}
  const H_MAX = 1000, TOMB_DAYS = 365;

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const stamp = x => x.u || x.t || 0;

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
    return { v: 1, history, vocab, study, tomb };
  }

  const local = () => ({ history: read(H_KEY, []), vocab: read(V_KEY, []), study: read(S_KEY, []), tomb: read(T_KEY, {}) });
  const same = (x, y) => JSON.stringify(x.history) === JSON.stringify(y.history) &&
                         JSON.stringify(x.vocab) === JSON.stringify(y.vocab) &&
                         JSON.stringify(x.study || []) === JSON.stringify(y.study || []);

  // ---- UTF-8 ↔ base64 ----
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---- GitHub API ----
  const config = () => read(C_KEY, null);
  const configured = () => { const c = config(); return !!(c && c.repo && c.token); };

  async function gh(c, method, url, body) {
    const r = await fetch('https://api.github.com/repos/' + c.repo + url, {
      method, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return r;
  }

  function explain(status) {
    if (status === 401) return '토큰이 올바르지 않거나 만료되었습니다';
    if (status === 403) return '토큰에 이 저장소 쓰기 권한(Contents: Read and write)이 없습니다';
    if (status === 404) return '저장소를 찾을 수 없습니다 (이름 또는 토큰의 저장소 선택 확인)';
    return 'GitHub 응답 오류 (' + status + ')';
  }

  async function pull(c) {
    const path = encodeURIComponent(c.path || 'data.json');
    const r = await gh(c, 'GET', '/contents/' + path);
    if (r.status === 404) {
      // 파일이 없는 것인지, 저장소 자체가 없는 것인지 구분
      const repo = await gh(c, 'GET', '');
      if (!repo.ok) throw new Error(explain(repo.status));
      return { data: { history: [], vocab: [], study: [], tomb: {} }, sha: null };
    }
    if (!r.ok) throw new Error(explain(r.status));
    const j = await r.json();
    let text;
    if (j.content && j.encoding === 'base64') text = b64decode(j.content);
    else {   // 1MB 넘는 파일은 blob으로 받음
      const b = await gh(c, 'GET', '/git/blobs/' + j.sha);
      if (!b.ok) throw new Error(explain(b.status));
      text = b64decode((await b.json()).content);
    }
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('저장소의 data.json 형식이 올바르지 않습니다'); }
    return { data, sha: j.sha };
  }

  async function push(c, data, sha) {
    const d = new Date();
    const r = await gh(c, 'PUT', '/contents/' + encodeURIComponent(c.path || 'data.json'), {
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
    return /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
         : /Windows/.test(ua) ? (location.protocol === 'file:' ? 'PC 설치판' : 'Windows') : /Mac/.test(ua) ? 'Mac' : 'web';
  }

  // 저장소의 다른 JSON 파일 읽기 (학습 자료 등). 없으면 null
  async function getJSON(path) {
    const c = config();
    if (!c || !c.repo || !c.token) throw new Error('동기화가 설정되지 않았습니다');
    const r = await gh(c, 'GET', '/contents/' + path.split('/').map(encodeURIComponent).join('/'));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(explain(r.status));
    const j = await r.json();
    let text;
    if (j.content && j.encoding === 'base64') text = b64decode(j.content);
    else {
      const b = await gh(c, 'GET', '/git/blobs/' + j.sha);
      if (!b.ok) throw new Error(explain(b.status));
      text = b64decode((await b.json()).content);
    }
    return JSON.parse(text);
  }

  // ---- 동기화 실행 ----
  let running = null, again = false, timer = null;
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
    setState('busy', '동기화 중…');
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = local();
      const { data: remote, sha } = await pull(c);
      const merged = merge(before, remote);
      const remoteSame = sha && same(merged, { history: remote.history || [], vocab: remote.vocab || [], study: remote.study || [] }) &&
                         JSON.stringify(merged.tomb) === JSON.stringify(remote.tomb || {});
      if (!remoteSame && !(await push(c, merged, sha))) continue;
      // 동기화하는 동안 이 기기에서 바뀐 내용도 잃지 않도록 한 번 더 합침
      const now = local();
      const final = merge(merged, now);
      write(H_KEY, final.history); write(V_KEY, final.vocab); write(S_KEY, final.study); write(T_KEY, final.tomb);
      if (!same(final, merged)) again = true;
      const cc = config(); if (cc) { cc.last = Date.now(); write(C_KEY, cc); }
      setState('ok', '동기화 완료');
      Sync.onApplied && Sync.onApplied();
      return;
    }
    throw new Error('다른 기기와 동시에 저장되어 잠시 후 다시 시도합니다');
  }

  function run() {
    if (running) { again = true; return running; }
    running = (async () => {
      try {
        do { again = false; await runOnce(); } while (again);
      } catch (e) {
        setState('err', e.message || '동기화 실패 (인터넷 연결 확인)');
        if (/fetch|network/i.test(e.message || '')) setState('err', '인터넷에 연결되어 있지 않아 동기화하지 못했습니다');
      } finally { running = null; }
    })();
    return running;
  }

  // 변경 직후 바로 올리지 않고 잠시 모아서 (연속 입력 시 요청 수 절약)
  function schedule(ms = 2500) {
    if (!configured()) return;
    clearTimeout(timer);
    timer = setTimeout(run, ms);
  }

  // 지운 항목 기록 (다른 기기에서 되살아나지 않도록)
  function tomb(ids) {
    const t = read(T_KEY, {}), now = Date.now();
    for (const id of [].concat(ids)) if (id) t[id] = now;
    write(T_KEY, t);
    schedule();
  }

  function setup(repo, token) {
    repo = String(repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
    token = String(token || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('저장소는 "아이디/저장소이름" 형식으로 입력해 주세요');
    if (!token) throw new Error('토큰을 입력해 주세요');
    write(C_KEY, { repo, token, path: 'data.json', last: 0 });
    return run();
  }
  function disconnect() { try { localStorage.removeItem(C_KEY); } catch {} setState('off'); }

  // 다른 기기로 설정 넘기기: #sync=... 링크 (주소의 # 뒤는 웹서버로 전송되지 않음)
  function shareLink(base) {
    const c = config(); if (!c) return '';
    return base + '#sync=' + b64encode(JSON.stringify({ r: c.repo, k: c.token })).replace(/=+$/, '');
  }
  function importFromHash() {
    const m = location.hash.match(/[#&]sync=([A-Za-z0-9+/_-]+)/);
    if (!m) return false;
    try {
      const j = JSON.parse(b64decode(m[1].replace(/-/g, '+').replace(/_/g, '/')));
      history.replaceState(null, '', location.pathname + location.search);   // 주소창·방문 기록에서 토큰 제거
      if (j.r && j.k) { write(C_KEY, { repo: j.r, token: j.k, path: 'data.json', last: 0 }); return true; }
    } catch {}
    return false;
  }

  // 화면으로 돌아올 때(다른 기기에서 바꿨을 수 있음) 자동 동기화
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && configured() && Date.now() - state.at > 15000) run();
  });
  window.addEventListener('online', () => { if (configured()) run(); });

  window.Sync = { run, schedule, tomb, setup, getJSON, disconnect, configured, config, shareLink, importFromHash,
                  merge, state, onState: f => { listeners.add(f); f(state); }, onApplied: null };
})();
