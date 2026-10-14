# 영어 데스크 (한↔영 번역 · 사전 · 데일리 업무 영어 학습)

- 웹: https://changwoolee2.github.io/Offline_Translator/

## 저장 방식 — 기기(PC·브라우저)에는 아무것도 저장하지 않음
- 이력·단어장·학습 기록·설정은 이 창의 메모리에만 두고, 비공개 저장소 `translator-data`의 `data.json`에만 저장합니다.
- localStorage·쿠키·IndexedDB·서비스워커 캐시를 쓰지 않습니다. 파일 내보내기·가져오기, PC 설치판도 없습니다.
- GitHub 토큰도 기기에 저장하지 않습니다. 창을 열 때마다 **비밀번호로 잠금 해제**를 합니다.
  - `access.json`(이 저장소, 공개)에는 비밀번호로 암호화한 {저장소, 토큰}이 들어 있습니다(PBKDF2-SHA256 600,000회 + AES-GCM). 비밀번호 없이는 풀 수 없습니다.
  - 처음 설정이나 비밀번호 변경은 앱의 [잠김] → [처음 설정]에서 합니다. 앱이 만들어 준 내용을 `access.json`으로 커밋하면 됩니다.
- 변경 사항은 1.5초 안에 GitHub에 저장됩니다. 화면을 벗어나면 바로 저장하고, 저장되지 않은 내용이 있으면 창을 닫기 전에 확인합니다.
- 예전 버전이 브라우저에 남긴 데이터는 처음 잠금을 풀 때 GitHub로 합친 뒤 기기에서 지웁니다.
- 기기 밖으로 나가는 것은 GitHub API(api.github.com)로 보내는 내 입력값(이력·단어장·학습 기록)뿐입니다. 온라인 번역을 켠 기기에서는 번역할 문장이 Google/MyMemory로도 전송됩니다.
- 다만 브라우저가 프로그램 파일(HTML·JS·사전)을 일반 웹 캐시에 담는 것과 Chrome 내장 번역 모델은 브라우저 기능이라 앱이 막을 수 없습니다. 둘 다 내 데이터는 아닙니다.

| 기기 | 번역 | 비고 |
|---|---|---|
| PC Chrome 138+ | Chrome 내장 번역 (기기 내) | 입력 내용이 번역 때문에 PC 밖으로 나가지 않음 |
| 휴대폰·기타 브라우저 | 온라인 번역 (Google → MyMemory) | 처음 한 번 동의 (동의 여부도 GitHub에 저장) |

## 데일리 영어 학습
- 학습 자료: 비공개 저장소 `translator-data`의 `lessons/<날짜>.json`, 목록 `lessons/index.json`
- 학습 기록·피드백·작문: `data.json`의 `study` 배열
- 매일 새벽 Claude 예약 작업이 `study/GENERATOR.md` 규칙대로 다음 학습을 생성합니다 (직전 학습을 완료했을 때만)
- 검증: `python3 -I tools/validate_lesson.py <lesson.json>`

## 파일
- `index.html` 번역기 본체, `sync.js` 메모리 저장·GitHub 저장·비밀번호 잠금, `dict-lookup.js` + `dict-*.js` 사전
- `study.js`, `study.css` 학습 화면, `study/sample/` 잠금 해제 전 미리보기용 Day 1
- `access.json` 암호화된 GitHub 접속 정보 (앱에서 생성)
- `sw.js` 예전 버전의 오프라인 캐시를 지우는 용도 (지우지 마세요)
- `manifest.webmanifest` 휴대폰 홈 화면 추가

사전 데이터: Wiktionary (kaikki.org, CC BY-SA 4.0), kengdic (MPL 2.0).
