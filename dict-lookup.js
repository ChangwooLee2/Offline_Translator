// 오프라인 사전 조회 — 번역기.html, popup.html 공용
// 사전 데이터(dict-en.js, dict-ko.js)는 처음 조회할 때 한 번만 불러옴
// 출처: Wiktionary(kaikki.org, CC BY-SA 4.0), kengdic(MPL 2.0)
(function () {
  const HANGUL = /[ㄱ-ㆎ가-힣]/;
  const loading = {};

  function load(lang) {
    const g = lang === 'en' ? 'DICT_EN' : 'DICT_KO';
    if (window[g]) return Promise.resolve(window[g]);
    if (!loading[lang]) loading[lang] = new Promise(res => {
      const s = document.createElement('script');
      s.src = 'dict-' + lang + '.js';
      s.onload = () => res(window[g] || null);
      s.onerror = () => res(null);
      document.head.append(s);
    });
    return loading[lang];
  }

  // 영어: 복수형·과거형·진행형 등을 원형 후보로
  function enCandidates(text) {
    const w = text.toLowerCase().replace(/[’']s$/, '').replace(/^[^a-z]+|[^a-z]+$/g, '');
    const c = [w];
    const add = x => { if (x && x.length > 1 && !c.includes(x)) c.push(x); };
    if (w.endsWith('ies')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('es')) add(w.slice(0, -2));
    if (w.endsWith('s')) add(w.slice(0, -1));
    if (w.endsWith('ied')) add(w.slice(0, -3) + 'y');
    if (w.endsWith('ed')) { add(w.slice(0, -2)); add(w.slice(0, -1)); if (/(.)\1ed$/.test(w)) add(w.slice(0, -3)); }
    if (w.endsWith('ing')) { add(w.slice(0, -3)); add(w.slice(0, -3) + 'e'); if (/(.)\1ing$/.test(w)) add(w.slice(0, -4)); }
    if (w.endsWith('er')) add(w.slice(0, -2));
    if (w.endsWith('est')) add(w.slice(0, -3));
    if (w.endsWith('ly')) add(w.slice(0, -2));
    return c;
  }

  // 한국어: 조사·어미를 뒤에서부터 떼어 가며 후보로 (선박의 → 선박, 확인했다 → 확인하다 …)
  function koCandidates(text) {
    const w = text.replace(/[^가-힣ㄱ-ㆎ0-9A-Za-z ]/g, '').trim();
    const c = [w];
    const nos = w.replace(/\s+/g, '');
    if (nos !== w) c.push(nos);
    const min = Math.min(2, nos.length);
    for (let i = nos.length - 1; i >= min; i--) { c.push(nos.slice(0, i)); c.push(nos.slice(0, i) + '다'); }
    return c;
  }

  // 단어(또는 짧은 구)면 사전 결과 {word, entries}, 아니면 null
  async function lookup(text) {
    text = (text || '').trim();
    if (!text || text.length > 40 || text.includes('\n')) return null;
    const ko = HANGUL.test(text);
    if (text.split(/\s+/).length > (ko ? 2 : 3)) return null;
    const dict = await load(ko ? 'ko' : 'en');
    if (!dict) return null;
    const cands = (ko ? koCandidates(text) : enCandidates(text)).filter(c => c && dict[c]);
    // Wiktionary 뜻이 있는 후보 우선 (running → run), 없으면 첫 후보
    const best = cands.find(c => dict[c].some(e => e[2] === 'w')) || cands[0];
    return best ? { word: best, entries: dict[best], lang: ko ? 'ko' : 'en' } : null;
  }

  // 단어장 저장용 짧은 뜻 (Wiktionary 우선, 앞의 두 뜻)
  function summary(res) {
    if (!res) return '';
    const defs = [];
    for (const [, d, src] of res.entries) { if (src === 'w' || !defs.length) defs.push(...d); if (defs.length >= 2) break; }
    return defs.slice(0, 2).map(s => s.replace(/\.$/, '')).join('; ');
  }

  // 사전 결과를 el 안에 그림
  function render(el, res) {
    el.replaceChildren();
    if (!res) return;
    const head = document.createElement('div'); head.className = 'd-head';
    head.textContent = res.word;
    el.append(head);
    let shown = 0;
    for (const [pos, defs, src] of res.entries) {
      if (shown >= 8) break;
      const g = document.createElement('div'); g.className = 'd-group' + (src === 'k' ? ' d-ref' : '');
      if (pos || src === 'k') {
        const b = document.createElement('span'); b.className = 'd-pos';
        b.textContent = src === 'k' ? (pos ? pos + ' · 참고' : '참고') : pos;
        g.append(b);
      }
      const ol = document.createElement('ol'); ol.className = 'd-defs';
      for (const d of defs.slice(0, 8 - shown)) { const li = document.createElement('li'); li.textContent = d; ol.append(li); shown++; }
      g.append(ol);
      el.append(g);
    }
  }

  // 사전 표시 스타일 (두 페이지의 색 변수 --muted, --accent, --border 사용)
  if (typeof document !== 'undefined') {
    const st = document.createElement('style');
    st.textContent = `
      .d-head { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
      .d-group { margin-top: 4px; }
      .d-pos { display: inline-block; font-size: 11px; font-weight: 700; color: var(--accent);
        border: 1px solid var(--accent); border-radius: 4px; padding: 0 5px; margin-bottom: 2px; }
      .d-defs { margin: 2px 0 0; padding-left: 20px; font-size: 13.5px; }
      .d-defs li { margin: 1px 0; }
      .d-ref { opacity: .6; }
      .d-ref .d-pos { color: var(--muted); border-color: var(--border); }
      .d-sep { font-size: 11px; color: var(--muted); margin: 8px 0 2px; border-top: 1px solid var(--border); padding-top: 6px; }`;
    document.head.append(st);
  }

  const naverUrl = word => 'https://en.dict.naver.com/#/search?query=' + encodeURIComponent(word);

  window.OfflineDict = { load, lookup, render, summary, naverUrl };
})();
