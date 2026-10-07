# 오프라인 번역기 (한국어 ↔ 영어)

- 웹: https://changwoolee2.github.io/Offline_Translator/
- 설치판·사용법: https://changwoolee2.github.io/Offline_Translator/download.html

| 기기 | 번역 | 비고 |
|---|---|---|
| PC Chrome 138+ | Chrome 내장 번역 (기기 내) | 입력 내용이 PC 밖으로 나가지 않음 |
| 휴대폰·기타 브라우저 | 온라인 번역 (Google → MyMemory) | 기기마다 처음 한 번 동의 후 사용 |

이력·단어장은 비공개 저장소 `translator-data`의 `data.json`으로 기기 간 동기화됩니다 (Fine-grained 토큰, Contents: Read and write).

## 파일
- `index.html` 번역기 본체 (웹·설치판 공용), `sync.js` GitHub 동기화, `dict-lookup.js` + `dict-*.js` 오프라인 사전
- `sw.js`, `manifest.webmanifest` 오프라인 캐시·홈 화면 추가
- `download.html` 설치판 받기·사용법
- `desktop/` 설치판 스크립트 (Ctrl+Shift+Space 단축키 포함), `setup/` 설치판 zip
- 설치판 zip 다시 만들기: `python tools/build_setup_zip.py`
- 코드 수정 후에는 `sw.js`의 `VERSION`을 바꿔야 사전 캐시가 갱신됩니다.

사전 데이터: Wiktionary (kaikki.org, CC BY-SA 4.0), kengdic (MPL 2.0). QR: qrcode-generator (MIT).
