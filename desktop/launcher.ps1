# Offline translator launcher (ASCII only - PowerShell 5.1)
# - Opens the translator window (Chrome app mode), or focuses it if already open
# - While the translator window is open: Ctrl+Shift+Space translates the selected text
#   in any program and shows a small popup near the mouse
# - Exits automatically when the translator window is closed

Add-Type -AssemblyName System.Windows.Forms

$dir     = $PSScriptRoot
$chrome  = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
             "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
             "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
$main    = Get-ChildItem -LiteralPath $dir -Filter *.html | Where-Object { $_.Name -ne 'popup.html' } | Select-Object -First 1
$mainUrl = ([Uri]$main.FullName).AbsoluteUri
$popUrl  = ([Uri](Join-Path $dir 'popup.html')).AbsoluteUri

Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public static class TrWin
{
    // window titles (Korean, as \u escapes)
    public const string MainTitle  = "\uC624\uD504\uB77C\uC778 \uBC88\uC5ED\uAE30";   // offline translator
    public const string PopupTitle = "\uBC88\uC5ED \uD31D\uC5C5";                       // translation popup

    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);

    public static IntPtr[] Find(string title)
    {
        var list = new System.Collections.Generic.List<IntPtr>();
        EnumProc cb = (h, l) => {
            if (!IsWindowVisible(h)) return true;
            var c = new StringBuilder(64); GetClassName(h, c, 64);
            if (c.ToString() != "Chrome_WidgetWin_1") return true;
            var t = new StringBuilder(256); GetWindowText(h, t, 256);
            if (t.ToString() == title) list.Add(h);
            return true;
        };
        EnumWindows(cb, IntPtr.Zero);
        GC.KeepAlive(cb);
        return list.ToArray();
    }

    public static bool Activate(string title)
    {
        var w = Find(title);
        if (w.Length == 0) return false;
        if (IsIconic(w[0])) ShowWindow(w[0], 9);
        SetForegroundWindow(w[0]);
        return true;
    }

    public static void CloseAll(string title)
    {
        foreach (var h in Find(title)) PostMessage(h, 0x0010, IntPtr.Zero, IntPtr.Zero);   // WM_CLOSE
    }
}

class HotkeyWindow : NativeWindow
{
    public Action OnHotkey;
    public HotkeyWindow() { CreateHandle(new CreateParams()); }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0312 && OnHotkey != null) OnHotkey();   // WM_HOTKEY
        base.WndProc(ref m);
    }
}

public class TrHost : ApplicationContext
{
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mod, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int pid);
    struct POINT { public int X, Y; }

    const uint MOD_CONTROL = 2, MOD_SHIFT = 4, MOD_NOREPEAT = 0x4000, VK_SPACE = 0x20;
    readonly string chrome, popUrl;
    readonly HotkeyWindow win = new HotkeyWindow();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly DateTime started = DateTime.Now;
    bool seen; int missing;
    public bool Registered;

    public TrHost(string chrome, string popUrl)
    {
        this.chrome = chrome; this.popUrl = popUrl;
        win.OnHotkey = OnHotkey;
        Registered = RegisterHotKey(win.Handle, 1, MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT, VK_SPACE);
        timer.Interval = 1500;
        timer.Tick += (s, e) => WatchMain();
        timer.Start();
    }

    // exit when the translator window is gone (wait up to 30 s for it to appear first)
    void WatchMain()
    {
        if (TrWin.Find(TrWin.MainTitle).Length > 0) { seen = true; missing = 0; return; }
        if (seen ? ++missing >= 2 : (DateTime.Now - started).TotalSeconds > 30) Quit();
    }

    void Quit()
    {
        timer.Stop();
        UnregisterHotKey(win.Handle, 1);
        TrWin.CloseAll(TrWin.PopupTitle);
        win.DestroyHandle();
        ExitThread();
    }

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    static string ClipText()
    {
        for (int i = 0; i < 10; i++) {
            try { return Clipboard.ContainsText() ? Clipboard.GetText() : null; }
            catch { Thread.Sleep(30); }
        }
        return null;
    }

    static void SetClip(string s)
    {
        for (int i = 0; i < 10; i++) {
            try { Clipboard.SetText(s); return; } catch { Thread.Sleep(30); }
        }
    }

    void OnHotkey()
    {
        POINT p; GetCursorPos(out p);

        // wait for the user to release Ctrl/Shift/Space so the copy is a clean Ctrl+C
        var t0 = DateTime.Now;
        while ((Down(0x10) || Down(0x11) || Down(0x20)) && (DateTime.Now - t0).TotalMilliseconds < 1000) Thread.Sleep(15);
        keybd_event(0x10, 0, 2, UIntPtr.Zero);   // Shift up (in case still held)
        keybd_event(0x20, 0, 2, UIntPtr.Zero);   // Space up

        string old = ClipText();
        uint seq = GetClipboardSequenceNumber();
        keybd_event(0x11, 0, 0, UIntPtr.Zero);   // Ctrl down
        keybd_event(0x43, 0, 0, UIntPtr.Zero);   // C down
        keybd_event(0x43, 0, 2, UIntPtr.Zero);   // C up
        keybd_event(0x11, 0, 2, UIntPtr.Zero);   // Ctrl up

        t0 = DateTime.Now;
        while (GetClipboardSequenceNumber() == seq && (DateTime.Now - t0).TotalMilliseconds < 700) Thread.Sleep(15);
        string text = GetClipboardSequenceNumber() != seq ? (ClipText() ?? "") : "";
        if (old != null && GetClipboardSequenceNumber() != seq) SetClip(old);   // restore clipboard

        if (text.Length > 2000) text = text.Substring(0, 2000);
        string json = "{\"t\":" + Json(text) + ",\"x\":" + p.X + ",\"y\":" + p.Y + "}";
        string url = popUrl + "#" + Uri.EscapeDataString(json);

        TrWin.CloseAll(TrWin.PopupTitle);   // only one popup at a time
        AllowSetForegroundWindow(-1);
        int x = p.X + 12, y = p.Y + 18;
        try {
            Process.Start(chrome, "--app=\"" + url + "\" --window-size=460,200 --window-position=" + x + "," + y);
        } catch { }
    }

    static string Json(string s)
    {
        var b = new StringBuilder("\"");
        foreach (char c in s) {
            switch (c) {
                case '"': b.Append("\\\""); break;
                case '\\': b.Append("\\\\"); break;
                case '\n': b.Append("\\n"); break;
                case '\r': break;
                case '\t': b.Append("\\t"); break;
                default:
                    if (c < 0x20) b.Append("\\u").Append(((int)c).ToString("x4"));
                    else b.Append(c);
                    break;
            }
        }
        return b.Append('"').ToString();
    }
}
'@

# Open or focus the translator window
function Open-Main {
    if (-not [TrWin]::Activate([TrWin]::MainTitle)) {
        Start-Process -FilePath $chrome -ArgumentList "--app=`"$mainUrl`" --window-size=1000,620"
    }
}

# Only one hotkey host at a time
$mutex = New-Object System.Threading.Mutex($false, 'Local\OfflineTranslatorHotkey')
if (-not $mutex.WaitOne(0)) { Open-Main; exit }

Open-Main
$host_ = New-Object TrHost($chrome, $popUrl)
if (-not $host_.Registered) {
    $msg = "Ctrl+Shift+Space " + [string]::Concat([char[]](0xB2E8,0xCD95,0xD0A4,0xB97C,0x20,0xB2E4,0xB978,0x20,0xD504,0xB85C,0xADF8,0xB7A8,0xC774,0x20,0xC0AC,0xC6A9,0x20,0xC911,0xC774,0xB77C,0x20,0xD31D,0xC5C5,0x20,0xBC88,0xC5ED,0xC744,0x20,0xCF24,0x20,0xC218,0x20,0xC5C6,0xC2B5,0xB2C8,0xB2E4,0x2E))
    [System.Windows.Forms.MessageBox]::Show($msg, [TrWin]::MainTitle) | Out-Null
    exit
}
[System.Windows.Forms.Application]::Run($host_)
$mutex.ReleaseMutex()
