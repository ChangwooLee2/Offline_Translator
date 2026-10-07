"""PC 설치판 zip 만들기: 웹 버전과 같은 파일로 setup/OfflineTranslator_setup.zip 생성.
실행: 저장소 최상위에서  python tools/build_setup_zip.py
"""
import pathlib, zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOP = '영어데스크_설치'
APP_FILES = {  # zip 안 app 폴더 이름: 저장소 파일
    '번역기.html': 'index.html', 'popup.html': 'popup.html', 'dict-lookup.js': 'dict-lookup.js',
    'sync.js': 'sync.js', 'qrcode.js': 'qrcode.js', 'study.js': 'study.js', 'study.css': 'study.css', 'dict-en.js': 'dict-en.js', 'dict-ko.js': 'dict-ko.js',
    'translator.ico': 'translator.ico', 'launcher.ps1': 'desktop/launcher.ps1',
}
TOP_FILES = ['설치.bat', '제거.bat', 'install.ps1', 'uninstall.ps1', '사용설명서.txt']

out = ROOT / 'setup' / 'OfflineTranslator_setup.zip'
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name in TOP_FILES:
        z.write(ROOT / 'desktop' / name, f'{TOP}/{name}')
    for name, src in APP_FILES.items():
        z.write(ROOT / src, f'{TOP}/app/{name}')
    for f in sorted((ROOT / 'study' / 'sample').glob('*.json')):   # 동기화 전 미리보기용 Day 1
        z.write(f, f'{TOP}/app/study/sample/{f.name}')
print(out, out.stat().st_size)
