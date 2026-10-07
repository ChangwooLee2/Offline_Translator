# 오프라인 번역기 설치 스크립트 (설치.bat 에서 실행)
# - 프로그램 파일을 %LOCALAPPDATA%\OfflineTranslator 로 복사 (항상 같은 위치 → 재설치해도 이력·단어장 유지)
# - 바탕화면·시작 메뉴 바로가기 생성 (아이콘, 작업 표시줄 묶음용 앱 ID 설정)
Add-Type -AssemblyName System.Windows.Forms
$title = '오프라인 번역기 설치'
function Say([string]$msg, [string]$icon = 'Information') {
  [System.Windows.Forms.MessageBox]::Show($msg, $title, 'OK', $icon) | Out-Null
}

$src = Join-Path $PSScriptRoot 'app'
$dst = Join-Path $env:LOCALAPPDATA 'OfflineTranslator'
if (-not (Test-Path (Join-Path $src 'launcher.ps1'))) { Say "설치 파일이 손상되었습니다. app 폴더를 찾을 수 없습니다.`n압축을 모두 푼 뒤 다시 실행해 주세요." 'Error'; exit 1 }

# 1) Chrome 확인 (내장 번역 기능은 Chrome 138 이상)
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
            "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
            "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { Say 'Chrome이 설치되어 있지 않습니다. 이 번역기는 Chrome의 내장 번역 기능을 사용합니다.' 'Error'; exit 1 }
$ver = (Get-Item $chrome).VersionInfo.ProductMajorPart
if ($ver -lt 138) { Say "Chrome 버전이 낮습니다 (현재 $ver). Chrome을 최신 버전으로 업데이트한 뒤 다시 설치해 주세요." 'Warning'; exit 1 }

# 2) 파일 복사
try {
  New-Item -ItemType Directory -Force $dst | Out-Null
  Copy-Item (Join-Path $src '*') $dst -Recurse -Force -ErrorAction Stop
} catch { Say "파일 복사에 실패했습니다.`n$($_.Exception.Message)" 'Error'; exit 1 }

# 3) 바로가기 (바탕화면, 시작 메뉴)
$launcher = Join-Path $dst 'launcher.ps1'
$psExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$lnkName = '오프라인 번역기.lnk'
$lnks = @((Join-Path ([Environment]::GetFolderPath('Desktop')) $lnkName),
          (Join-Path ([Environment]::GetFolderPath('Programs')) $lnkName))
$ws = New-Object -ComObject WScript.Shell
foreach ($p in $lnks) {
  $s = $ws.CreateShortcut($p)
  $s.TargetPath = $psExe
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""
  $s.WorkingDirectory = $dst
  $s.WindowStyle = 7
  $s.IconLocation = (Join-Path $dst 'translator.ico') + ',0'
  $s.Description = '오프라인 한↔영 번역기'
  $s.Save()
}

# 4) 번역기를 한 번 실행해 창의 앱 ID를 읽고 바로가기에 기록 (작업 표시줄 아이콘이 하나로 묶이도록)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AppId
{
    [StructLayout(LayoutKind.Sequential, Pack = 4)] public struct PROPERTYKEY { public Guid fmtid; public uint pid; }
    [StructLayout(LayoutKind.Explicit)] public struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore { int GetCount(out uint c); int GetAt(uint i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v); int Commit(); }
    [ComImport, Guid("0000010b-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPersistFile { void GetClassID(out Guid g); [PreserveSig] int IsDirty(); void Load([MarshalAs(UnmanagedType.LPWStr)] string f, uint m); void Save([MarshalAs(UnmanagedType.LPWStr)] string f, bool r); void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string f); void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string f); }
    [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid riid, out IPropertyStore ps);
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    static PROPERTYKEY Key = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    static Guid IID = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");

    public static string ForTitle(string title)
    {
        string found = null;
        EnumProc cb = (h, l) => {
            if (!IsWindowVisible(h)) return true;
            var c = new StringBuilder(64); GetClassName(h, c, 64);
            var t = new StringBuilder(256); GetWindowText(h, t, 256);
            if (c.ToString() != "Chrome_WidgetWin_1" || t.ToString() != title) return true;
            IPropertyStore ps;
            if (SHGetPropertyStoreForWindow(h, ref IID, out ps) == 0 && ps != null) {
                PROPVARIANT v; var k = Key; ps.GetValue(ref k, out v);
                if (v.vt == 31) found = Marshal.PtrToStringUni(v.p);
                PropVariantClear(ref v);
            }
            return found == null;
        };
        EnumWindows(cb, IntPtr.Zero); GC.KeepAlive(cb);
        return found;
    }

    public static void SetOnShortcut(string path, string id)
    {
        var link = (IPersistFile)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
        link.Load(path, 2);
        var ps = (IPropertyStore)link;
        var v = new PROPVARIANT { vt = 31, p = Marshal.StringToCoTaskMemUni(id) }; var k = Key;
        Marshal.ThrowExceptionForHR(ps.SetValue(ref k, ref v));
        Marshal.ThrowExceptionForHR(ps.Commit());
        Marshal.FreeCoTaskMem(v.p);
        link.Save(path, true);
    }
}
'@

Start-Process -FilePath $psExe -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`"" -WindowStyle Hidden
$appId = $null
for ($i = 0; $i -lt 40 -and -not $appId; $i++) { Start-Sleep -Milliseconds 500; $appId = [AppId]::ForTitle('오프라인 번역기') }
if ($appId) { foreach ($p in $lnks) { try { [AppId]::SetOnShortcut($p, $appId) } catch {} } }

# 5) 완료 안내
$msg = "설치가 완료되었습니다.`n`n" +
       "• 바탕화면과 시작 메뉴에 '오프라인 번역기'가 생겼습니다.`n" +
       "• 작업 표시줄에 고정하려면: 바탕화면 아이콘 우클릭 → 추가 옵션 표시 → 작업 표시줄에 고정`n" +
       "• 처음 한 번은 번역기 화면의 [번역 모델 다운로드]를 눌러 주세요 (인터넷 필요, 위·아래 칸 각각).`n" +
       "• 번역기가 켜져 있는 동안 다른 프로그램에서 글자 선택 후 Ctrl+Shift+Space 로 팝업 번역.`n`n" +
       "설치 위치: $dst"
if (-not $appId) { $msg += "`n`n(참고: 번역기 창을 확인하지 못해 작업 표시줄 아이콘이 따로 표시될 수 있습니다. 설치.bat 을 한 번 더 실행하면 해결됩니다.)" }
Say $msg
