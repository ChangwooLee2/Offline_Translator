// 영어 데스크 — 데일리 영어 학습
// 학습 자료: 비공개 저장소의 lessons/<id>.json (매일 새벽 Claude 예약 작업이 생성)
// 학습 기록·피드백: data.json의 study 배열 (sync.js가 기기 간 동기화) → 다음 자료 생성 때 반영
(function () {
  const S_KEY = 'ed-study', IDX_KEY = 'ed-lesson-index', L_PREFIX = 'ed-lesson-', MODE_KEY = 'ed-mode';
  const SAMPLE_URL = 'study/sample/2026-10-07.json';
  const root = document.getElementById('studyView');

  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayStr = () => ymd(new Date());
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (text, cls, on) => { const b = el('button', cls, text); b.type = 'button'; if (on) b.addEventListener('click', on); return b; };
  const fmtDur = s => { s = Math.max(0, Math.round(s || 0)); const m = Math.floor(s / 60); return m + '분 ' + pad(s % 60) + '초'; };
  const SECTIONS = [['review', '복습'], ['vocab', '단어'], ['reading', '읽기'], ['listening', '듣기'], ['writing', '쓰기']];

  // ---- 학습 기록 ----
  const records = () => read(S_KEY, []);
  const getRec = id => records().find(r => r.lessonId === id) || null;
  function saveRec(rec, { sync = true } = {}) {
    rec.u = Date.now();
    write(S_KEY, records().filter(r => r.id !== rec.id).concat([rec]));
    if (sync) Sync.schedule(4000);
    updateBadge();
  }
  function newRec(lesson) {
    return { id: 'study-' + lesson.id, lessonId: lesson.id, day: lesson.day, title: lesson.title, topic: lesson.topic,
             t: Date.now(), started: Date.now(), startDate: todayStr(), done: false, seconds: 0,
             sections: {}, answers: { reading: {}, listening: {}, writing: [] }, savedWords: [] };
  }

  // ---- 학습 자료 불러오기 ----
  const state = { tab: 'today', index: [], lesson: null, source: 'none', error: '', loading: false,
                  viewing: null, viewLesson: null, month: null, selDay: null };

  async function getLesson(id) {
    const cached = read(L_PREFIX + id, null);
    if (cached) return cached;
    if (!Sync.configured()) return null;
    try { const l = await Sync.getJSON('lessons/' + id + '.json'); if (l) write(L_PREFIX + id, l); return l; }
    catch { return null; }
  }

  async function load() {
    state.loading = true; state.error = ''; render();
    try {
      if (Sync.configured()) {
        state.source = 'repo';
        let idx = null;
        try { idx = await Sync.getJSON('lessons/index.json'); if (idx) write(IDX_KEY, idx); }
        catch (e) { state.error = e.message; }
        state.index = Array.isArray(idx) ? idx : read(IDX_KEY, []);
        const last = state.index[state.index.length - 1];
        state.lesson = last ? await getLesson(last.id) : null;
      } else {
        state.source = 'sample';
        let l = read(L_PREFIX + 'sample', null);
        if (!l) {
          try { const r = await fetch(SAMPLE_URL, { cache: 'no-cache' }); if (r.ok) { l = await r.json(); write(L_PREFIX + 'sample', l); } } catch {}
        }
        state.lesson = l;
        state.index = l ? [{ id: l.id, day: l.day, date: l.date, title: l.title, topic: l.topic }] : [];
      }
    } finally { state.loading = false; }
    render(); updateBadge();
  }

  // ---- 듣기: 브라우저 음성 합성 ----
  const TTS = {
    ok: 'speechSynthesis' in window,
    voices: [],
    refresh() { if (this.ok) this.voices = speechSynthesis.getVoices().filter(v => /^en[-_]/i.test(v.lang)); },
    pick(speakers) {
      this.refresh();
      const used = new Set(), out = [];
      const fem = /female|samantha|karen|victoria|zira|hazel|susan|moira|tessa|serena|libby|sonia|natasha|aria|jenny|ava|allison|catherine|emma|kate|fiona|joanna|salli|kimberly/i;
      const mal = /\bmale|daniel|david|alex\b|fred|george|mark|ryan|guy|lee|james|thomas|oliver|arthur|aaron|gordon|matthew|joey|justin|brian|william/i;
      for (const s of speakers) {
        const lang = { US: 'en-US', GB: 'en-GB', AU: 'en-AU' }[s.accent] || 'en-US';
        const g = s.voice === 'female' ? fem : mal, ng = s.voice === 'female' ? mal : fem;
        const byLang = this.voices.filter(v => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
        const cands = [
          ...byLang.filter(v => g.test(v.name) && !ng.test(v.name)), ...this.voices.filter(v => g.test(v.name) && !ng.test(v.name)),
          ...byLang, ...this.voices];
        const v = cands.find(v => !used.has(v.name)) || cands[0] || null;
        if (v) used.add(v.name);
        out.push(v);
      }
      return out;
    }
  };
  if (TTS.ok) { TTS.refresh(); speechSynthesis.addEventListener?.('voiceschanged', () => TTS.refresh()); }
  const player = { idx: 0, playing: false, rate: 1, lines: [], voices: [], speakers: [], onLine: null, token: 0 };
  function stopAudio() { player.playing = false; player.token++; if (TTS.ok) speechSynthesis.cancel(); player.onLine && player.onLine(-1); }
  function playFrom(i, single = false) {
    if (!TTS.ok) return;
    speechSynthesis.cancel();
    const my = ++player.token;
    player.playing = true; player.idx = i;
    const step = () => {
      if (my !== player.token) return;
      if (player.idx >= player.lines.length) { player.playing = false; player.idx = 0; player.onLine && player.onLine(-1); return; }
      const ln = player.lines[player.idx], sp = player.speakers[ln.s] || {};
      const u = new SpeechSynthesisUtterance(ln.text);
      const v = player.voices[ln.s];
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-US';
      u.rate = player.rate;
      if (!v || player.voices.filter(x => x === v).length > 1) u.pitch = sp.voice === 'female' ? 1.15 : 0.85;   // 같은 목소리면 높낮이로 구분
      u.onend = () => { if (my !== player.token) return; if (single) { player.playing = false; player.onLine && player.onLine(-1); return; } player.idx++; setTimeout(step, 350); };
      u.onerror = u.onend;
      player.onLine && player.onLine(player.idx);
      speechSynthesis.speak(u);
    };
    step();
  }

  // ---- 학습 시간 ----
  let tickTimer = null, lastTick = 0;
  function tick() {
    const l = state.lesson, rec = l && getRec(l.id);
    const active = document.body.classList.contains('mode-study') && state.tab === 'today' && !state.viewing &&
                   rec && !rec.done && document.visibilityState === 'visible';
    const now = Date.now();
    if (active && lastTick) {
      rec.seconds = (rec.seconds || 0) + Math.min(5, (now - lastTick) / 1000);
      const t = root.querySelector('.st-timer'); if (t) t.textContent = fmtDur(rec.seconds);
      if (Math.floor(rec.seconds) % 30 === 0) saveRec(rec, { sync: false });
      else write(S_KEY, records().filter(r => r.id !== rec.id).concat([rec]));
    }
    lastTick = active ? now : 0;
  }

  // ---- 단어장 연동 ----
  function addWord(lesson, word, meaning, example) {
    const ok = Vocab.add({ word, meaning, example: example || '', src: 'study:' + lesson.id });
    const rec = getRec(lesson.id) || newRec(lesson);
    if (ok && !rec.savedWords.includes(word)) { rec.savedWords.push(word); saveRec(rec); }
    return ok;
  }

  // ---- 화면 ----
  function render() {
    if (!root) return;
    const keepScroll = root.scrollTop;
    root.replaceChildren();
    const wrap = el('div', 'st-wrap');
    const sub = el('div', 'st-sub');
    sub.append(
      btn('오늘 학습', state.tab === 'today' && !state.viewing ? 'on' : '', () => { state.tab = 'today'; state.viewing = null; render(); root.scrollTop = 0; }),
      btn('달력 · 이력', state.tab === 'cal' || state.viewing ? 'on' : '', () => { state.tab = 'cal'; state.viewing = null; render(); root.scrollTop = 0; }),
      btn('새로고침', '', () => load()));
    const ss = el('span', 'st-sync', Sync.configured() ? (Sync.state.status === 'err' ? '⚠ 동기화 오류' : '') : '동기화 미설정');
    sub.append(ss);
    wrap.append(sub);
    if (state.viewing) renderReviewView(wrap);
    else if (state.tab === 'cal') renderCalendar(wrap);
    else renderToday(wrap);
    root.append(wrap);
    root.scrollTop = keepScroll;
  }

  function banner(wrap, html, cls = '') {
    const b = el('div', 'st-banner ' + cls); b.innerHTML = html; wrap.append(b); return b;
  }

  function renderToday(wrap) {
    if (state.source === 'sample') {
      const b = banner(wrap, '<b>미리보기 (Day 1)</b> — 동기화를 연결하면 매일 새 학습이 준비되고, 기록과 피드백이 다음 학습에 반영됩니다. ');
      b.append(btn('동기화 설정', '', () => document.getElementById('syncBtn').click()));
    }
    if (state.error) banner(wrap, '학습 자료를 불러오지 못했습니다: ' + state.error + ' (저장해 둔 자료를 표시합니다)');
    if (state.loading && !state.lesson) { wrap.append(el('div', 'st-empty', '학습 자료를 불러오는 중…')); return; }
    const l = state.lesson;
    if (!l) {
      wrap.append(el('div', 'st-empty', '아직 준비된 학습이 없습니다. 매일 새벽 5시 전후에 자동으로 준비됩니다.'));
      return;
    }
    renderLesson(wrap, l, getRec(l.id), false);
  }

  function renderReviewView(wrap) {
    const bar = el('div', 'st-reviewbar');
    bar.append(btn('← 달력으로', '', () => { state.viewing = null; state.tab = 'cal'; render(); }));
    bar.append(el('span', '', '지난 학습 다시 보기'));
    wrap.append(bar);
    const l = state.viewLesson;
    if (!l) { wrap.append(el('div', 'st-empty', '이 학습 자료를 불러오지 못했습니다 (인터넷·동기화 확인).')); return; }
    renderLesson(wrap, l, getRec(l.id), true);
  }

  function renderLesson(wrap, l, rec, review) {
    const locked = review || (rec && rec.done);
    const ensure = () => { let r = getRec(l.id); if (!r) { r = newRec(l); saveRec(r); } return r; };
    const markDone = (key) => { const r = ensure(); if (!r.sections[key]) { r.sections[key] = true; saveRec(r); } };

    // 머리
    const head = el('div', 'st-head');
    const meta = el('div', 'st-meta');
    meta.append(el('span', 'st-day', 'Day ' + l.day), el('span', '', l.date), el('span', '', l.level), el('span', '', '약 ' + (l.minutes || 30) + '분'));
    if (rec) meta.append(el('span', 'st-timer', fmtDur(rec.seconds)));
    if (rec && rec.done) meta.append(el('span', 'st-done', '✓ 완료 ' + (rec.doneDate || '')));
    head.append(meta, el('h2', '', l.title), el('div', 'st-topic', l.topic));
    if (l.note_ko) head.append(el('div', 'st-note', l.note_ko));
    const steps = el('div', 'st-steps');
    for (const [k, name] of SECTIONS) {
      if (k === 'review' && !l.review) continue;
      const a = el('a', rec && rec.sections[k] ? 'done' : '', name); a.href = '#st-' + k;
      a.addEventListener('click', e => { e.preventDefault(); root.querySelector('#st-' + k)?.scrollIntoView({ behavior: 'smooth' }); });
      steps.append(a);
    }
    const fa = el('a', rec && rec.done ? 'done' : '', '피드백·완료'); fa.href = '#st-fb';
    fa.addEventListener('click', e => { e.preventDefault(); root.querySelector('#st-fb')?.scrollIntoView({ behavior: 'smooth' }); });
    steps.append(fa);
    head.append(steps);
    if (!rec && !review) {
      const go = el('div', 'st-foot');
      go.append(el('span', 'st-msg', '시작하면 학습 시간이 기록됩니다.'), btn('학습 시작', 'primary', () => { ensure(); render(); }));
      head.append(go);
    }
    wrap.append(head);

    const card = (key, title, min, desc) => {
      const c = el('div', 'st-card'); c.id = 'st-' + key;
      const h = el('h3', '', title);
      if (min) h.append(el('span', 'st-min', min + '분'));
      if (rec && rec.sections[key]) h.append(el('span', 'st-done', '✓'));
      c.append(h);
      if (desc) c.append(el('p', 'st-desc', desc));
      wrap.append(c); return c;
    };

    // 0. 복습
    if (l.review) {
      const c = card('review', '어제 학습 피드백', 3, '어제 작문 첨삭과 다시 볼 내용입니다.');
      if (l.review.summary_ko) c.append(el('div', 'st-note', l.review.summary_ko));
      for (const x of l.review.corrections || []) {
        const d = el('div', 'st-corr');
        d.append(el('div', 'o', x.original), el('div', 'c', x.corrected), el('div', 'n', x.note_ko));
        c.append(d);
      }
      if ((l.review.words || []).length) {
        c.append(el('div', 'st-desc', '복습 단어 — 뜻을 떠올린 뒤 눌러서 확인'));
        const chips = el('div', 'st-chips');
        for (const w of l.review.words) {
          const ch = el('span', 'st-chip', w.word); ch.title = '눌러서 뜻 보기'; ch.style.cursor = 'pointer';
          ch.addEventListener('click', () => { ch.textContent = ch.textContent === w.word ? w.word + ' — ' + w.meaning_ko : w.word; });
          chips.append(ch);
        }
        c.append(chips);
      }
      if (!locked) { const f = el('div', 'st-foot'); f.append(btn('확인했어요', '', () => { markDone('review'); render(); })); c.append(f); }
    }

    // 1. 단어
    {
      const c = card('vocab', '오늘의 표현', 5, '뜻을 먼저 떠올려 보고 가려진 칸을 눌러 확인하세요. 모르는 것은 단어장에 저장하면 번역기 단어장과 같이 관리됩니다.');
      const g = el('div', 'st-vocab');
      for (const v of l.vocab) {
        const box = el('div', 'st-vw');
        const w = el('div', 'w', v.word); w.append(el('small', '', v.pos));
        const m = el('div', 'm' + (locked ? '' : ' hide'), v.meaning_ko); m.title = '눌러서 뜻 보기/가리기';
        m.addEventListener('click', () => m.classList.toggle('hide'));
        box.append(w, m, el('div', 'ex', v.example));
        const saved = Vocab.load().some(x => x.word.toLowerCase() === v.word.toLowerCase());
        const b = btn(saved ? '단어장에 있음' : '단어장 추가', '', () => { b.textContent = addWord(l, v.word, v.meaning_ko, v.example) ? '추가됨 ✓' : '단어장에 있음'; b.disabled = true; });
        b.disabled = saved;
        box.append(b);
        g.append(box);
      }
      c.append(g);
      const f = el('div', 'st-foot');
      f.append(btn('전체 단어장 추가', '', () => { let n = 0; for (const v of l.vocab) if (addWord(l, v.word, v.meaning_ko, v.example)) n++; alert(n + '개를 단어장에 추가했습니다.'); render(); }));
      if (!locked) f.append(btn('다 봤어요', '', () => { markDone('vocab'); render(); }));
      c.append(f);
    }

    // 2. 읽기
    {
      const r = l.reading;
      const c = card('reading', '읽기 — ' + r.title, 9, '모르는 단어는 더블클릭(휴대폰: 길게 눌러 선택)하면 사전·번역 팝업이 뜹니다.');
      if (r.source_ko) c.append(el('div', 'st-src', r.source_ko));
      const t = el('div', 'st-text');
      for (const p of r.paragraphs) t.append(el('p', '', p));
      c.append(t);
      renderQuestions(c, l, rec, 'reading', r.questions, locked, ensure);
    }

    // 3. 듣기
    {
      const ls = l.listening;
      const c = card('listening', '듣기 — ' + ls.title, 6, ls.setting_ko);
      c.append(el('div', 'st-speakers', ls.speakers.map(s => s.name + ' (' + s.role + ')').join(' · ')));
      const pl = el('div', 'st-player');
      const now = el('span', 'now', TTS.ok ? '▶ 재생을 누르면 대화를 읽어 줍니다.' : '이 브라우저는 음성 읽기를 지원하지 않습니다. 스크립트를 읽으세요.');
      const rate = el('select'); for (const v of [0.8, 0.9, 1, 1.1]) { const o = el('option', '', '속도 ' + v + 'x'); o.value = v; if (v === player.rate) o.selected = true; rate.append(o); }
      rate.addEventListener('change', () => { player.rate = +rate.value; if (player.playing) playFrom(player.idx); });
      const bPlay = btn('▶ 재생', 'primary', () => { if (player.playing) { stopAudio(); bPlay.textContent = '▶ 재생'; } else { setup(); playFrom(player.idx || 0); bPlay.textContent = '⏸ 멈춤'; } });
      const bRe = btn('⏮ 처음부터', '', () => { setup(); player.idx = 0; playFrom(0); bPlay.textContent = '⏸ 멈춤'; });
      if (!TTS.ok) { bPlay.disabled = bRe.disabled = rate.disabled = true; }
      pl.append(bPlay, bRe, rate, now);
      c.append(pl);
      const showScript = locked || (rec && (rec.sections.listening || rec.sections.script));
      const script = el('div', 'st-script');
      const lineEls = ls.lines.map((ln, i) => {
        const row = el('div', 'st-line');
        const who = el('span', 'who', ls.speakers[ln.s]?.name || '?'); who.title = '이 줄만 듣기';
        who.addEventListener('click', () => { setup(); playFrom(i, true); });
        row.append(who, el('span', '', ln.text));
        script.append(row); return row;
      });
      function setup() {
        if (player.lines !== ls.lines) { stopAudio(); player.idx = 0; }
        player.lines = ls.lines; player.speakers = ls.speakers; player.voices = TTS.pick(ls.speakers);
        player.onLine = i => {
          lineEls.forEach((e, j) => e.classList.toggle('playing', j === i));
          if (i < 0) { bPlay.textContent = '▶ 재생'; now.textContent = '재생이 끝났습니다. 다시 들으려면 ▶ 재생'; return; }
          const s = ls.speakers[ls.lines[i].s] || {};
          now.textContent = (s.name || '') + ' 말하는 중… ' + (i + 1) + '/' + ls.lines.length;
          if (script.isConnected && !script.hidden) lineEls[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        };
      }
      if (showScript) c.append(script);
      else {
        const note = el('div', 'st-hidden-note', '먼저 스크립트 없이 듣고 문제를 푸세요. 채점하면 스크립트가 열립니다. ');
        note.append(btn('지금 스크립트 보기', '', () => { const r = ensure(); r.sections.script = true; saveRec(r); render(); }));
        c.append(note);
      }
      renderQuestions(c, l, rec, 'listening', ls.questions, locked, ensure);
    }

    // 4. 쓰기
    {
      const c = card('writing', '쓰기', 7, '작성한 답은 다음 날 학습의 "어제 학습 피드백"에서 첨삭됩니다.');
      const showModel = locked || (rec && rec.sections.writing);
      l.writing.tasks.forEach((task, i) => {
        const d = el('div', 'st-task');
        d.append(el('div', 'p', (i + 1) + '. ' + task.prompt_ko));
        if (task.hints && task.hints.length) d.append(el('div', 'h', '도움 표현: ' + task.hints.join(' / ')));
        const ta = el('textarea'); ta.spellcheck = true; ta.lang = 'en';
        ta.placeholder = task.type === 'translate' ? '1) …\n2) …\n3) …' : 'Write in English…';
        ta.value = (rec && rec.answers.writing[i]) || '';
        ta.readOnly = !!review || !!(rec && rec.done);
        const wc = el('div', 'wc');
        const count = () => { const n = (ta.value.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length; wc.textContent = n + ' 단어' + (task.min_words ? ' / 권장 ' + task.min_words + '+' : ''); };
        let tmr = null;
        ta.addEventListener('input', () => {
          count(); clearTimeout(tmr);
          tmr = setTimeout(() => { const r = ensure(); r.answers.writing[i] = ta.value; saveRec(r); }, 800);
        });
        count();
        d.append(ta, wc);
        if (showModel) { const m = el('div', 'st-model'); m.append(el('b', '', '모범 답안'), document.createTextNode(task.model)); d.append(m); }
        c.append(d);
      });
      if (!locked && !showModel) {
        const f = el('div', 'st-foot');
        f.append(el('span', 'st-msg', '다 쓰고 나서 모범 답안과 비교하세요.'));
        f.append(btn('답안 저장 · 모범 답안 보기', 'primary', () => {
          const r = ensure();
          c.querySelectorAll('textarea').forEach((t, i) => { r.answers.writing[i] = t.value; });
          if (!r.answers.writing.some(x => (x || '').trim()) && !confirm('작성한 답이 없습니다. 모범 답안을 볼까요?')) return;
          r.sections.writing = true; saveRec(r); render();
        }));
        c.append(f);
      }
    }

    // 5. 피드백·완료
    renderFeedback(wrap, l, rec, review, ensure);
  }

  function renderQuestions(c, l, rec, key, qs, locked, ensure) {
    const graded = locked || (rec && rec.sections[key]);
    const ans = (rec && rec.answers[key]) || {};
    let right = 0;
    qs.forEach((q, i) => {
      const box = el('div', 'st-q');
      box.append(el('div', 'q', (i + 1) + '. ' + q.q));
      q.options.forEach((o, j) => {
        const lab = el('label');
        const inp = el('input'); inp.type = 'radio'; inp.name = key + '-' + l.id + '-' + i; inp.value = j;
        inp.checked = ans[i] === j; inp.disabled = !!graded;
        inp.addEventListener('change', () => { const r = ensure(); r.answers[key][i] = j; saveRec(r, { sync: false }); });
        lab.append(inp, el('span', '', '①②③④'[j] + ' ' + o));
        if (graded) { if (j === q.answer) lab.classList.add('right'); else if (ans[i] === j) lab.classList.add('wrong'); }
        box.append(lab);
      });
      if (graded) { if (ans[i] === q.answer) right++; box.append(el('div', 'ex', (ans[i] === q.answer ? '정답 · ' : ans[i] == null ? '미응답 · 정답 ' + '①②③④'[q.answer] + ' · ' : '오답 · 정답 ' + '①②③④'[q.answer] + ' · ') + q.explain_ko)); }
      c.append(box);
    });
    const f = el('div', 'st-foot');
    if (graded) f.append(el('span', 'st-score', '점수 ' + right + ' / ' + qs.length));
    else f.append(btn('채점하기', 'primary', () => {
      const r = ensure();
      const n = Object.keys(r.answers[key]).length;
      if (n < qs.length && !confirm('아직 ' + (qs.length - n) + '문제를 풀지 않았습니다. 채점할까요?')) return;
      r.sections[key] = true;
      r.score = r.score || {}; r.score[key] = qs.filter((q, i) => r.answers[key][i] === q.answer).length + '/' + qs.length;
      saveRec(r); render();
    }));
    c.append(f);
  }

  function renderFeedback(wrap, l, rec, review, ensure) {
    const c = el('div', 'st-card st-fb'); c.id = 'st-fb';
    c.append(el('h3', '', '피드백 · 학습 완료'));
    if (rec && rec.done) {
      const fb = rec.feedback || {};
      const done = el('div', 'st-complete');
      done.append(el('div', 'big', '✓ ' + (rec.doneDate || '') + ' 완료 · ' + fmtDur(rec.seconds)));
      const sc = rec.score ? Object.entries(rec.score).map(([k, v]) => ({ reading: '읽기', listening: '듣기' }[k] || k) + ' ' + v).join(' · ') : '';
      if (sc) done.append(el('div', '', sc));
      const lv = ['', '너무 쉬움', '쉬움', '적당', '어려움', '너무 어려움'][fb.level] || '-';
      const am = { less: '많았다', ok: '적당', more: '부족했다' }[fb.amount] || '-';
      done.append(el('div', 'st-desc', '난이도 ' + lv + ' · 분량 ' + am + (fb.helpful && fb.helpful.length ? ' · 도움: ' + fb.helpful.map(k => (SECTIONS.find(s => s[0] === k) || [k, k])[1]).join(', ') : '')));
      if (fb.text) done.append(el('div', 'st-note', fb.text));
      if (!review && state.lesson && state.lesson.id === l.id) {
        done.append(el('div', 'st-desc', state.source === 'sample'
          ? '동기화를 연결하면 이 기록과 피드백을 반영한 다음 학습이 내일 새벽에 준비됩니다.'
          : '다음 학습은 이 피드백과 작문을 반영해 내일 새벽 5시 전후에 준비됩니다. 아침에 [새로고침]을 누르세요.'));
      }
      c.append(done);
      wrap.append(c); return;
    }
    if (review) { c.append(el('div', 'st-desc', '완료하지 않은 학습입니다.')); wrap.append(c); return; }

    const draft = (rec && rec.draftFeedback) || { level: 0, amount: '', helpful: [], text: '' };
    const saveDraft = () => { const r = ensure(); r.draftFeedback = draft; saveRec(r, { sync: false }); };
    const seg = (label, opts, getter, setter, multi) => {
      const row = el('div', 'row'); row.append(el('div', 'lab', label));
      const s = el('div', 'st-seg');
      for (const [v, t] of opts) {
        const b = btn(t, (multi ? getter().includes(v) : getter() === v) ? 'on' : '', () => { setter(v); saveDraft(); paint(); });
        b.dataset.v = v; s.append(b);
      }
      const paint = () => s.querySelectorAll('button').forEach(b => {
        const v = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
        b.classList.toggle('on', multi ? getter().includes(b.dataset.v) : getter() === v);
      });
      row.append(s); c.append(row);
    };
    seg('난이도', [[1, '너무 쉬움'], [2, '쉬움'], [3, '적당'], [4, '어려움'], [5, '너무 어려움']], () => draft.level, v => { draft.level = v; });
    seg('분량 (30분 기준)', [['less', '많았다 → 줄이기'], ['ok', '적당'], ['more', '부족했다 → 늘리기']], () => draft.amount, v => { draft.amount = v; });
    seg('도움이 된 부분 (여러 개 선택)', SECTIONS.filter(([k]) => k !== 'review' || l.review), () => draft.helpful,
        v => { draft.helpful = draft.helpful.includes(v) ? draft.helpful.filter(x => x !== v) : draft.helpful.concat([v]); }, true);
    const row = el('div', 'row'); row.append(el('div', 'lab', '다음 학습에 바라는 점 (주제, 형식, 어려웠던 점 등)'));
    const ta = el('textarea'); ta.value = draft.text || ''; ta.placeholder = '예) 이메일 쓰기를 더 하고 싶어요 / 듣기가 너무 빨랐어요 / 논문 리뷰어 답변 연습';
    let t = null; ta.addEventListener('input', () => { draft.text = ta.value; clearTimeout(t); t = setTimeout(saveDraft, 800); });
    row.append(ta); c.append(row);
    const f = el('div', 'st-foot');
    const msg = el('span', 'st-msg', '');
    f.append(msg, btn('학습 완료', 'primary', () => {
      draft.text = ta.value;
      if (!draft.level || !draft.amount) { msg.textContent = '난이도와 분량을 골라 주세요.'; msg.style.color = 'var(--err)'; return; }
      const r = ensure();
      const left = SECTIONS.filter(([k]) => (k !== 'review' || l.review) && !r.sections[k]).map(s => s[1]);
      if (left.length && !confirm('아직 끝내지 않은 단계가 있습니다: ' + left.join(', ') + '\n그래도 완료할까요?')) return;
      r.done = true; r.doneAt = Date.now(); r.doneDate = todayStr();
      r.feedback = { level: draft.level, amount: draft.amount, helpful: draft.helpful, text: (draft.text || '').trim() };
      delete r.draftFeedback;
      saveRec(r, { sync: false });
      if (Sync.configured()) Sync.run();
      stopAudio(); render(); root.querySelector('#st-fb')?.scrollIntoView({ behavior: 'smooth' });
    }));
    c.append(f);
    wrap.append(c);
  }

  // ---- 달력 · 이력 ----
  function renderCalendar(wrap) {
    const recs = records().slice().sort((a, b) => (b.doneAt || b.started) - (a.doneAt || a.started));
    const done = recs.filter(r => r.done);
    const byDay = new Map();
    for (const r of recs) {
      const d = r.done ? r.doneDate : r.startDate;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(r);
    }
    // 통계
    const days = new Set(done.map(r => r.doneDate));
    let streak = 0; const d0 = new Date();
    if (!days.has(ymd(d0))) d0.setDate(d0.getDate() - 1);
    while (days.has(ymd(d0))) { streak++; d0.setDate(d0.getDate() - 1); }
    const now = new Date(); const ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    const avg = done.length ? done.reduce((s, r) => s + (r.seconds || 0), 0) / done.length : 0;
    const stats = el('div', 'st-stats');
    for (const [v, k] of [[done.length + '회', '총 학습'], [[...days].filter(d => d.startsWith(ym)).length + '일', '이번 달'], [streak + '일', '연속 학습'], [Math.round(avg / 60) + '분', '평균 학습 시간']]) {
      const s = el('div', 'st-stat'); s.append(el('div', 'v', v), el('div', 'k', k)); stats.append(s);
    }
    wrap.append(stats);

    // 달력
    const m = state.month || new Date(now.getFullYear(), now.getMonth(), 1);
    state.month = m;
    const card = el('div', 'st-card');
    const hd = el('div', 'st-cal-head');
    hd.append(btn('◀', '', () => { state.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(); }),
              el('strong', '', m.getFullYear() + '년 ' + (m.getMonth() + 1) + '월'),
              btn('▶', '', () => { state.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(); }),
              btn('오늘', '', () => { state.month = null; state.selDay = todayStr(); render(); }));
    card.append(hd);
    const cal = el('div', 'st-cal');
    for (const w of '일월화수목금토') cal.append(el('div', 'dow', w));
    const first = new Date(m.getFullYear(), m.getMonth(), 1), start = first.getDay();
    const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
    for (let i = 0; i < start; i++) cal.append(el('div', 'd out'));
    for (let day = 1; day <= last; day++) {
      const key = ymd(new Date(m.getFullYear(), m.getMonth(), day));
      const rs = byDay.get(key) || [];
      const c = el('div', 'd');
      c.append(el('span', '', day));
      if (key === todayStr()) c.classList.add('today');
      if (rs.length) {
        c.classList.add('has', rs.some(r => r.done) ? 'done' : 'prog');
        c.append(el('span', 'mk', rs.map(r => 'D' + r.day).join(' ') + (rs.some(r => r.done) ? '' : ' …')));
        c.title = rs.map(r => 'Day ' + r.day + ' ' + r.title + (r.done ? ' (완료)' : ' (진행 중)')).join('\n');
        c.addEventListener('click', () => { state.selDay = key; render(); });
      }
      if (state.selDay === key) c.classList.add('sel');
      cal.append(c);
    }
    card.append(cal);
    wrap.append(card);

    // 이력
    const list = state.selDay ? byDay.get(state.selDay) || [] : recs;
    const h = el('div', 'st-hist');
    const ht = el('div', 'st-cal-head');
    ht.append(el('b', '', state.selDay ? state.selDay + ' 학습' : '전체 학습 이력'));
    if (state.selDay) ht.append(btn('전체 보기', '', () => { state.selDay = null; render(); }));
    h.append(ht);
    if (!list.length) h.append(el('div', 'st-empty', '학습 기록이 없습니다.'));
    for (const r of list) {
      const row = el('div', 'st-hrow');
      row.append(el('div', 'dt', (r.done ? r.doneDate : r.startDate + ' 시작')));
      const tt = el('div', 'tt', 'Day ' + r.day + ' · ' + r.title); tt.append(el('small', '', r.topic || ''));
      row.append(tt);
      const sc = r.score ? Object.entries(r.score).map(([k, v]) => ({ reading: '읽기', listening: '듣기' }[k] || k) + ' ' + v).join(' · ') : '';
      const lv = r.feedback ? ['', '너무 쉬움', '쉬움', '적당', '어려움', '너무 어려움'][r.feedback.level] : '';
      row.append(el('div', 'sc', (r.done ? '' : '진행 중 · ') + [sc, fmtDur(r.seconds).replace(/ \d+초$/, ''), lv].filter(Boolean).join(' · ')));
      row.addEventListener('click', async () => {
        if (state.lesson && r.lessonId === state.lesson.id && !r.done) { state.tab = 'today'; state.viewing = null; render(); return; }
        state.viewing = r.lessonId; state.viewLesson = null; render();
        state.viewLesson = r.lessonId === (state.lesson && state.lesson.id) ? state.lesson
          : (await getLesson(r.lessonId)) || (read(L_PREFIX + 'sample', null)?.id === r.lessonId ? read(L_PREFIX + 'sample', null) : null);
        render(); root.scrollTop = 0;
      });
      h.append(row);
    }
    wrap.append(h);
  }

  // ---- 모드 전환 ----
  function updateBadge() {
    const b = document.getElementById('modeSt'); if (!b) return;
    const l = state.lesson, r = l && getRec(l.id);
    b.querySelector('.badge')?.remove();
    if (l && state.source === 'repo' && !(r && r.done)) { const s = el('span', 'badge'); s.title = '오늘 학습이 남아 있습니다'; b.append(s); }
  }
  let loaded = false;
  function setMode(mode) {
    const study = mode === 'study';
    document.body.classList.toggle('mode-study', study);
    document.getElementById('modeTr')?.classList.toggle('on', !study);
    document.getElementById('modeSt')?.classList.toggle('on', study);
    write(MODE_KEY, mode);
    if (study) { if (!loaded) { loaded = true; load(); } else render(); }
    else stopAudio();
  }

  // 동기화로 기록이 바뀌면 다시 그림 (입력 중이면 미룸)
  let pending = false;
  function refresh() {
    if (!document.body.classList.contains('mode-study')) return;
    if (root.contains(document.activeElement) && /TEXTAREA|INPUT/.test(document.activeElement.tagName)) {
      if (!pending) { pending = true; document.activeElement.addEventListener('blur', () => { pending = false; render(); }, { once: true }); }
      return;
    }
    render();
  }

  window.Study = {
    setMode, refresh, load,
    active: () => document.body.classList.contains('mode-study'),
    vocabSrc: () => (document.body.classList.contains('mode-study') && (state.viewLesson || state.lesson)) ? 'study:' + (state.viewing || state.lesson.id) : '',
    noteWord(word) {
      const l = state.lesson; if (!this.active() || !l || state.viewing) return;
      const r = getRec(l.id); if (r && !r.savedWords.includes(word)) { r.savedWords.push(word); saveRec(r); }
    },
    onSyncConfigured() { loaded = true; load(); }
  };

  document.getElementById('modeTr')?.addEventListener('click', () => setMode('translate'));
  document.getElementById('modeSt')?.addEventListener('click', () => setMode('study'));
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', () => { lastTick = 0; });
  if (read(MODE_KEY, 'translate') === 'study') setMode('study');
  else {   // 번역 모드여도 오늘 학습 여부(배지)는 표시
    const idx = read(IDX_KEY, []), last = idx[idx.length - 1];
    if (last && Sync.configured()) { state.source = 'repo'; state.lesson = read(L_PREFIX + last.id, null) || { id: last.id }; updateBadge(); state.lesson = null; }
  }
})();
