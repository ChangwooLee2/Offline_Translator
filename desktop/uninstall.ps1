# 오프라인 번역기 제거 스크립트 (제거.bat 에서 실행)
# 프로그램 파일과 바로가기를 지움. 이력·단어장은 Chrome 안에 남음 (지우려면 번역기에서 [전체 삭제] 후 제거)
Add-Type -AssemblyName System.Windows.Forms
$title = '영어 데스크 제거'
$dst = Join-Path $env:LOCALAPPDATA 'OfflineTranslator'

$ans = [System.Windows.Forms.MessageBox]::Show("영어 데스크를 제거할까요?`n`n이력과 단어장을 보관하려면 먼저 번역기에서 [내보내기]를 해 두세요.", $title, 'YesNo', 'Question')
if ($ans -ne 'Yes') { exit }

# 실행 중인 번역기 창 닫기 (창이 닫히면 단축키 스크립트도 스스로 종료)
Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '영어 데스크' -or $_.MainWindowTitle -eq '오프라인 번역기' -or $_.MainWindowTitle -eq '번역 팝업' } | ForEach-Object { $_.CloseMainWindow() | Out-Null }
Start-Sleep -Seconds 3

# 바로가기: 바탕화면, 시작 메뉴, 작업 표시줄 고정 중 이 번역기를 가리키는 것
$ws = New-Object -ComObject WScript.Shell
$dirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'),
          "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")
foreach ($d in $dirs) {
  Get-ChildItem $d -Filter *.lnk -ErrorAction SilentlyContinue | Where-Object {
    $ws.CreateShortcut($_.FullName).Arguments -like '*OfflineTranslator*'
  } | Remove-Item -Force -ErrorAction SilentlyContinue
}

Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $dst) {
  [System.Windows.Forms.MessageBox]::Show("일부 파일을 지우지 못했습니다. 번역기를 모두 닫은 뒤 다시 실행해 주세요.`n$dst", $title, 'OK', 'Warning') | Out-Null
} else {
  [System.Windows.Forms.MessageBox]::Show('제거가 완료되었습니다. (작업 표시줄에 아이콘이 남아 있으면 우클릭 → 고정 해제)', $title, 'OK', 'Information') | Out-Null
}
