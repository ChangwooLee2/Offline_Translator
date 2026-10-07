"""학습 자료 JSON 검증: python3 -I tools/validate_lesson.py lessons/2026-10-08.json [...]
문제가 있으면 목록을 출력하고 종료 코드 1."""
import json, re, sys


def words(s):
    return len(re.findall(r"[A-Za-z][A-Za-z'’-]*", s))


def check_questions(errs, where, qs, need):
    if not isinstance(qs, list) or len(qs) < need:
        errs.append(f'{where}.questions: {need}개 이상 필요')
        return
    for i, q in enumerate(qs):
        p = f'{where}.questions[{i}]'
        if not str(q.get('q', '')).strip():
            errs.append(p + '.q 비어 있음')
        opts = q.get('options')
        if not isinstance(opts, list) or len(opts) != 4 or not all(str(o).strip() for o in opts):
            errs.append(p + '.options: 비어 있지 않은 4개 필요')
        a = q.get('answer')
        if not isinstance(a, int) or not 0 <= a <= 3:
            errs.append(p + '.answer: 0~3 정수')
        if not str(q.get('explain_ko', '')).strip():
            errs.append(p + '.explain_ko 비어 있음')


def validate(d):
    errs, warns = [], []
    for k in ('id', 'day', 'date', 'title', 'topic', 'level', 'minutes', 'note_ko', 'vocab', 'reading', 'listening', 'writing'):
        if k not in d:
            errs.append('필수 키 없음: ' + k)
    if errs:
        return errs, warns
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(d['id'])):
        errs.append('id 형식: YYYY-MM-DD')
    if not isinstance(d['day'], int) or d['day'] < 1:
        errs.append('day: 1 이상 정수')
    if d['day'] != 1 and not d.get('review'):
        warns.append('Day 2 이후인데 review 없음')
    r = d.get('review')
    if r:
        if not str(r.get('summary_ko', '')).strip():
            errs.append('review.summary_ko 비어 있음')
        for i, c in enumerate(r.get('corrections') or []):
            if not all(str(c.get(k, '')).strip() for k in ('original', 'corrected', 'note_ko')):
                errs.append(f'review.corrections[{i}] 항목 누락')
        for i, w in enumerate(r.get('words') or []):
            if not str(w.get('word', '')).strip() or not str(w.get('meaning_ko', '')).strip():
                errs.append(f'review.words[{i}] 항목 누락')

    v = d['vocab']
    if not isinstance(v, list) or not 6 <= len(v) <= 12:
        errs.append('vocab: 6~12개')
    else:
        for i, x in enumerate(v):
            if not all(str(x.get(k, '')).strip() for k in ('word', 'pos', 'meaning_ko', 'example')):
                errs.append(f'vocab[{i}] 항목 누락')

    rd = d['reading']
    paras = rd.get('paragraphs') or []
    n = sum(words(p) for p in paras)
    if not paras or not rd.get('title'):
        errs.append('reading.title/paragraphs 필요')
    elif not 250 <= n <= 550:
        warns.append(f'reading 단어 수 {n} (권장 300~450)')
    check_questions(errs, 'reading', rd.get('questions'), 3)

    ls = d['listening']
    sp, lines = ls.get('speakers') or [], ls.get('lines') or []
    if len(sp) < 2:
        errs.append('listening.speakers: 2명 이상')
    for i, s in enumerate(sp):
        if s.get('voice') not in ('female', 'male') or s.get('accent') not in ('US', 'GB', 'AU'):
            errs.append(f'listening.speakers[{i}] voice/accent 값 확인')
    for i, l in enumerate(lines):
        if not isinstance(l.get('s'), int) or not 0 <= l['s'] < len(sp) or not str(l.get('text', '')).strip():
            errs.append(f'listening.lines[{i}] 확인')
    n = sum(words(l.get('text', '')) for l in lines)
    if len(lines) < 8:
        errs.append('listening.lines: 8줄 이상')
    elif not 200 <= n <= 480:
        warns.append(f'listening 단어 수 {n} (권장 280~380)')
    check_questions(errs, 'listening', ls.get('questions'), 3)

    tasks = (d['writing'] or {}).get('tasks') or []
    if not tasks:
        errs.append('writing.tasks 필요')
    for i, t in enumerate(tasks):
        if t.get('type') not in ('email', 'paragraph', 'translate'):
            errs.append(f'writing.tasks[{i}].type')
        if not str(t.get('prompt_ko', '')).strip() or not str(t.get('model', '')).strip():
            errs.append(f'writing.tasks[{i}] prompt_ko/model 필요')

    answers = [q['answer'] for s in ('reading', 'listening') for q in d[s].get('questions', []) if isinstance(q.get('answer'), int)]
    if answers and len(set(answers)) == 1:
        warns.append('정답 번호가 모두 같음')
    return errs, warns


def main(paths):
    bad = False
    for p in paths:
        try:
            d = json.load(open(p, encoding='utf-8'))
        except Exception as e:
            print(f'{p}: JSON 읽기 실패 — {e}')
            bad = True
            continue
        errs, warns = validate(d)
        for w in warns:
            print(f'{p}: 경고 — {w}')
        for e in errs:
            print(f'{p}: 오류 — {e}')
        if errs:
            bad = True
        else:
            print(f'{p}: OK')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main(sys.argv[1:])
