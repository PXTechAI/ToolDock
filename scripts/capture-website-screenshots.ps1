param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\website\assets"),
  [string]$ExecutablePath = (Join-Path $PSScriptRoot "..\src-tauri\target\release\tooldock.exe")
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ToolDockWindowCapture {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct Point {
        public int X;
        public int Y;
    }

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxLength);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    public static extern bool GetClientRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    public static extern bool ClientToScreen(IntPtr hWnd, ref Point point);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hWnd, bool altTab);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    public static extern bool MoveWindow(
        IntPtr hWnd,
        int x,
        int y,
        int width,
        int height,
        bool repaint
    );

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(
        uint flags,
        uint dx,
        uint dy,
        int data,
        UIntPtr extraInfo
    );

    [DllImport("user32.dll")]
    public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
}
"@

function Set-ToolDockTopmost {
  param(
    [IntPtr]$Window,
    [bool]$Enabled
  )

  $insertAfter = if ($Enabled) { [IntPtr](-1) } else { [IntPtr](-2) }
  [void][ToolDockWindowCapture]::SetWindowPos(
    $Window,
    $insertAfter,
    0,
    0,
    0,
    0,
    0x0001 -bor 0x0002 -bor 0x0040
  )
}

function Set-ToolDockForeground {
  param([IntPtr]$Window)

  [void][ToolDockWindowCapture]::ShowWindow($Window, 9)
  Set-ToolDockTopmost -Window $Window -Enabled $true
  [ToolDockWindowCapture]::SwitchToThisWindow($Window, $true)
  [void][ToolDockWindowCapture]::SetForegroundWindow($Window)
  Start-Sleep -Milliseconds 180
}

function Get-ToolDockMainWindow {
  param([int]$ProcessId)

  $script:mainWindow = [IntPtr]::Zero
  $callback = [ToolDockWindowCapture+EnumWindowsProc]{
    param([IntPtr]$handle, [IntPtr]$unused)

    $windowProcessId = 0
    [void][ToolDockWindowCapture]::GetWindowThreadProcessId($handle, [ref]$windowProcessId)
    if ($windowProcessId -ne $ProcessId) {
      return $true
    }

    $title = [Text.StringBuilder]::new(256)
    [void][ToolDockWindowCapture]::GetWindowText($handle, $title, $title.Capacity)
    if ($title.ToString() -eq "ToolDock") {
      $script:mainWindow = $handle
      return $false
    }
    return $true
  }

  [void][ToolDockWindowCapture]::EnumWindows($callback, [IntPtr]::Zero)
  return $script:mainWindow
}

function Set-ToolDockClientSize {
  param(
    [IntPtr]$Window,
    [int]$Width,
    [int]$Height
  )

  $windowRect = [ToolDockWindowCapture+Rect]::new()
  $clientRect = [ToolDockWindowCapture+Rect]::new()
  [void][ToolDockWindowCapture]::GetWindowRect($Window, [ref]$windowRect)
  [void][ToolDockWindowCapture]::GetClientRect($Window, [ref]$clientRect)

  $windowWidth = $windowRect.Right - $windowRect.Left
  $windowHeight = $windowRect.Bottom - $windowRect.Top
  $clientWidth = $clientRect.Right - $clientRect.Left
  $clientHeight = $clientRect.Bottom - $clientRect.Top
  $outerWidth = $Width + ($windowWidth - $clientWidth)
  $outerHeight = $Height + ($windowHeight - $clientHeight)

  [void][ToolDockWindowCapture]::ShowWindow($Window, 9)
  [void][ToolDockWindowCapture]::MoveWindow($Window, 40, 40, $outerWidth, $outerHeight, $true)
  Set-ToolDockForeground -Window $Window
  Start-Sleep -Milliseconds 500
}

function Get-ClientOrigin {
  param([IntPtr]$Window)

  $origin = [ToolDockWindowCapture+Point]::new()
  [void][ToolDockWindowCapture]::ClientToScreen($Window, [ref]$origin)
  return $origin
}

function Invoke-ClientClick {
  param(
    [IntPtr]$Window,
    [int]$X,
    [int]$Y
  )

  Set-ToolDockForeground -Window $Window
  $origin = Get-ClientOrigin -Window $Window
  [void][ToolDockWindowCapture]::SetCursorPos($origin.X + $X, $origin.Y + $Y)
  Start-Sleep -Milliseconds 80
  [ToolDockWindowCapture]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  [ToolDockWindowCapture]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

function Save-ClientScreenshot {
  param(
    [IntPtr]$Window,
    [string]$Path
  )

  $clientRect = [ToolDockWindowCapture+Rect]::new()
  [void][ToolDockWindowCapture]::GetClientRect($Window, [ref]$clientRect)
  $origin = Get-ClientOrigin -Window $Window
  $width = $clientRect.Right - $clientRect.Left
  $height = $clientRect.Bottom - $clientRect.Top

  $bitmap = [Drawing.Bitmap]::new($width, $height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    Set-ToolDockForeground -Window $Window
    $hdc = $graphics.GetHdc()
    try {
      $printed = [ToolDockWindowCapture]::PrintWindow($Window, $hdc, 0x00000001 -bor 0x00000002)
    } finally {
      $graphics.ReleaseHdc($hdc)
    }

    if (-not $printed) {
      $graphics.CopyFromScreen(
        $origin.X,
        $origin.Y,
        0,
        0,
        [Drawing.Size]::new($width, $height),
        [Drawing.CopyPixelOperation]::SourceCopy
      )
    }
    $bitmap.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

if (-not (Test-Path -LiteralPath $ExecutablePath)) {
  throw "ToolDock executable not found: $ExecutablePath"
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$process = Get-Process -Name "tooldock" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $process) {
  Start-Process -FilePath $ExecutablePath
  Start-Sleep -Seconds 4
  $process = Get-Process -Name "tooldock" -ErrorAction Stop | Select-Object -First 1
} else {
  Start-Process -FilePath $ExecutablePath
  Start-Sleep -Seconds 2
}

$window = Get-ToolDockMainWindow -ProcessId $process.Id
if ($window -eq [IntPtr]::Zero) {
  throw "The ToolDock main window could not be found."
}

Set-ToolDockClientSize -Window $window -Width 1180 -Height 760
Set-ToolDockTopmost -Window $window -Enabled $true

try {
  $pages = @(
    @{ Name = "color-picker.png"; Y = 111; Delay = 900 },
    @{ Name = "ports.png"; Y = 174; Delay = 900 },
    @{ Name = "screenshot.png"; Y = 237; Delay = 1200 },
    @{ Name = "recording.png"; Y = 300; Delay = 1800 },
    @{ Name = "string-generator.png"; Y = 363; Delay = 900 },
    @{ Name = "lan-file-transfer.png"; Y = 426; Delay = 1800 }
  )

  foreach ($page in $pages) {
    Invoke-ClientClick -Window $window -X 105 -Y $page.Y
    Start-Sleep -Milliseconds $page.Delay
    Set-ToolDockForeground -Window $window
    [Windows.Forms.SendKeys]::SendWait("^{HOME}")
    Start-Sleep -Milliseconds 250
    Save-ClientScreenshot -Window $window -Path (Join-Path $OutputDirectory $page.Name)
  }

  Invoke-ClientClick -Window $window -X 1008 -Y 386
  Start-Sleep -Milliseconds 900
  Save-ClientScreenshot -Window $window -Path (Join-Path $OutputDirectory "cross-device-clipboard.png")

  Invoke-ClientClick -Window $window -X 105 -Y 489
  Start-Sleep -Seconds 4
  Set-ToolDockForeground -Window $window
  [Windows.Forms.SendKeys]::SendWait("^{HOME}")
  Start-Sleep -Milliseconds 250
  Save-ClientScreenshot -Window $window -Path (Join-Path $OutputDirectory "system-monitor.png")
} finally {
  Set-ToolDockTopmost -Window $window -Enabled $false
}

Write-Output "Captured ToolDock website screenshots in $OutputDirectory"
