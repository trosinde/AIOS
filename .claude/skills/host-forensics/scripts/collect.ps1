<#
.SYNOPSIS
  AIOS host-forensics — Beweissicherung für Windows.

.DESCRIPTION
  Sammelt rein lesend in einen Fallordner. Reihenfolge nach RFC 3227
  (flüchtig zuerst):
    1. Speicherabbild (nur mit -Memory)
    2. Prozesse und Netzwerk
    3. Autostarts
    4. Konten
    5. Logs
    6. Dateien
    7. Hashes

  Nichts auf dem untersuchten System wird verändert. Geschrieben wird
  ausschliesslich in den Fallordner. Für vollständige Ergebnisse ist ein
  Terminal mit Administrator-Rechten nötig; ohne diese fehlen Security-
  Eventlog, Registry-Hives und Prefetch.

.PARAMETER CaseDir
  Fallordner. Wird angelegt, falls nicht vorhanden.

.PARAMETER Mode
  live    = schnelle Momentaufnahme, Logs begrenzt (Standard)
  collect = vollständige Sicherung inklusive Registry-Hives

.PARAMETER Memory
  Speicherabbild mit winpmem. Braucht Administrator-Rechte, dauert lange und
  belegt Platz in Höhe des Arbeitsspeichers.

.PARAMETER LogDays
  Zeitfenster für Eventlog-Zusammenfassungen. Standard: 7 (live), 30 (collect).

.PARAMETER ExtraDir
  Zusätzliche Verzeichnisse für die Dateiprüfung.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File collect.ps1 -CaseDir .\cases\fall-1 -Mode live
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CaseDir,
  [ValidateSet('live','collect')][string]$Mode = 'live',
  [switch]$Memory,
  [int]$LogDays = 0,
  [string[]]$ExtraDir = @()
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

if ($LogDays -le 0) { $LogDays = if ($Mode -eq 'collect') { 30 } else { 7 } }

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

# try/catch ist in PowerShell eine Anweisung, kein Ausdruck. Welche
# Ausdrucks-Schreibweise trotzdem funktioniert, haengt von der Version ab —
# und der Parser meldet die ungueltigen NICHT, sie scheitern erst zur
# Laufzeit. Deshalb geht jede "nimm den Wert, sonst den Ersatz"-Stelle hier
# durch diesen Helfer: try/catch im Funktionskoerper ist immer eine Anweisung
# und damit auf 5.1 wie auf 7 gueltig.
function Invoke-Probe([scriptblock]$Script, $Default = $null) {
  try { & $Script } catch { $Default }
}

function Get-NowUtc { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }
function Write-Note([string]$m) { [Console]::Error.WriteLine("  $m") }

# ─── Fallordner und Beweiskette ───────────────────────────────────────────

if (-not (Test-Path -LiteralPath $CaseDir)) {
  New-Item -ItemType Directory -Path $CaseDir -Force | Out-Null
}
$CaseRoot = (Resolve-Path -LiteralPath $CaseDir).Path
foreach ($d in @('host','volatile','persistence','accounts','logs','filesystem','hashes','memory','registry')) {
  $p = Join-Path $CaseRoot $d
  if (-not (Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

$CocPath = Join-Path $CaseRoot 'chain-of-custody.log'
$skipped = @()

$identity = Invoke-Probe { [Security.Principal.WindowsIdentity]::GetCurrent() } $null
$isAdmin  = $false
if ($identity) {
  $isAdmin = Invoke-Probe {
    ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } $false
}
$operator = if ($identity) { [string]$identity.Name } elseif ($env:USERNAME) { $env:USERNAME } else { 'unknown' }

if (-not (Test-Path -LiteralPath $CocPath)) {
  $header = @(
    '# AIOS host-forensics — chain of custody',
    '# Jede Zeile: UTC-Zeitstempel, Zieldatei (relativ), Exit-Code oder "skipped", Bytes, Befehl',
    '# Spaltentrenner: Tabulator. Diese Datei wird nur angehaengt, nie veraendert.',
    '#',
    ("# begin`t{0}`tmode={1}`tsource_os=windows`thost={2}`toperator={3}`tadmin={4}" -f `
       (Get-NowUtc), $Mode, $env:COMPUTERNAME, $operator, $isAdmin)
  ) -join "`n"
  # LF statt CRLF: dieses Protokoll wird in WSL von collect-windows.sh
  # fortgeschrieben und von awk/grep gelesen.
  [System.IO.File]::WriteAllText($CocPath, $header + "`n", $Utf8NoBom)
}

function Add-Coc([string]$Rel, $Rc, $Bytes, [string]$Command) {
  # Tabulatoren im Pfad wuerden die Spalten sprengen; Steuerzeichen ersetzen.
  $safeRel = ($Rel -replace "[`t`r`n]", '?')
  $safeCmd = ($Command -replace "[`t`r`n]", ' ')
  $line = "{0}`t{1}`t{2}`t{3}`t{4}`n" -f (Get-NowUtc), $safeRel, $Rc, $Bytes, $safeCmd
  [System.IO.File]::AppendAllText($CocPath, $line, $Utf8NoBom)
}

function Add-Skip([string]$Rel, [string]$Reason) {
  $script:skipped += ("{0}: {1}" -f $Rel, $Reason)
  Add-Coc $Rel 'skipped' 0 ("SKIPPED: " + $Reason)
  Write-Note ("uebersprungen - {0} ({1})" -f $Rel, $Reason)
}

function Get-FileSizeSafe([string]$Path) {
  if (Test-Path -LiteralPath $Path -PathType Leaf) { (Get-Item -LiteralPath $Path).Length } else { 0 }
}

# Führt einen Block aus und schreibt sein Ergebnis in den Fallordner.
# Ein Fehlschlag beendet die Sammlung NICHT — er wird als Lücke vermerkt.
function Save-Output {
  param(
    [Parameter(Mandatory = $true)][string]$Rel,
    [Parameter(Mandatory = $true)][scriptblock]$Script,
    [ValidateSet('Text','Csv','Json')][string]$As = 'Text',
    [string]$Label = ''
  )
  $path = Join-Path $CaseRoot $Rel
  $dir  = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (-not $Label) { $Label = $Script.ToString().Trim() -replace '\s+', ' ' }
  if ($Label.Length -gt 400) { $Label = $Label.Substring(0, 400) + ' …' }

  try {
    $data = & $Script 2>$null
    $text = ''
    if ($null -ne $data) {
      switch ($As) {
        'Csv'  { $text = (@($data) | ConvertTo-Csv -NoTypeInformation) -join "`r`n" }
        'Json' { $text = $data | ConvertTo-Json -Depth 6 }
        default { $text = (@($data) | Out-String -Width 500) }
      }
    }
    [System.IO.File]::WriteAllText($path, [string]$text, $Utf8NoBom)
    Add-Coc $Rel 0 (Get-FileSizeSafe $path) $Label
  } catch {
    [System.IO.File]::WriteAllText(($path + '.stderr'), $_.Exception.Message, $Utf8NoBom)
    # Nur Add-Skip, nicht zusätzlich eine rc=1-Zeile: sonst taucht derselbe
    # Posten in "nicht gesammelt" UND in "Befehle mit Fehlern" auf.
    Add-Skip $Rel ("Fehler: " + $_.Exception.Message)
  }
}

# Externes Programm aufrufen (wevtutil, reg, netstat …).
function Save-Native {
  param(
    [Parameter(Mandatory = $true)][string]$Rel,
    [Parameter(Mandatory = $true)][string]$Exe,
    [string[]]$Arguments = @(),
    [switch]$WritesOwnFile
  )
  $path = Join-Path $CaseRoot $Rel
  $dir  = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $label = ($Exe + ' ' + ($Arguments -join ' ')).Trim()

  $resolved = Get-Command $Exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $resolved) { Add-Skip $Rel ("Werkzeug nicht vorhanden: " + $Exe); return }

  try {
    $out = & $resolved.Source @Arguments 2>&1
    $rc  = $LASTEXITCODE
    if ($null -eq $rc) { $rc = 0 }
    if (-not $WritesOwnFile) {
      [System.IO.File]::WriteAllText($path, ((@($out) | Out-String -Width 500)), $Utf8NoBom)
    } elseif ($out) {
      [System.IO.File]::WriteAllText(($path + '.stderr'), ((@($out) | Out-String -Width 500)), $Utf8NoBom)
    }
    Add-Coc $Rel $rc (Get-FileSizeSafe $path) $label
    if ($rc -ne 0) { Add-Skip $Rel ("Exit-Code {0} — Ergebnis unvollständig" -f $rc) }
  } catch {
    [System.IO.File]::WriteAllText(($path + '.stderr'), $_.Exception.Message, $Utf8NoBom)
    Add-Coc $Rel 1 0 $label
    Add-Skip $Rel ("Fehler: " + $_.Exception.Message)
  }
}

function Copy-Evidence {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Rel,
    [switch]$Recurse
  )
  $path = Join-Path $CaseRoot $Rel
  $dir  = Split-Path -Parent $path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  if (-not (Test-Path -LiteralPath $Source)) { Add-Skip $Rel ("nicht vorhanden: " + $Source); return }
  try {
    Copy-Item -LiteralPath $Source -Destination $path -Force -Recurse:$Recurse -ErrorAction Stop
    Add-Coc $Rel 0 (Get-FileSizeSafe $path) ("copy " + $Source)
  } catch {
    Add-Coc $Rel 1 0 ("copy " + $Source)
    Add-Skip $Rel ("nicht kopierbar (meist gesperrt oder Rechte fehlen): " + $_.Exception.Message + " — Velociraptor liest solche Dateien roh vom Laufwerk, siehe references/guides.md")
  }
}

# ─── Start ────────────────────────────────────────────────────────────────

[Console]::Error.WriteLine("")
[Console]::Error.WriteLine("AIOS host-forensics - Sammlung (windows, Betriebsart $Mode)")
[Console]::Error.WriteLine("")
Write-Note "Fallordner: $CaseRoot"
if (-not $isAdmin) {
  Write-Note "WARNUNG: keine Administrator-Rechte. Security-Eventlog, Registry-Hives und Prefetch fehlen."
}

# ─── 0. Systemzustand ─────────────────────────────────────────────────────

$detect = Join-Path (Split-Path -Parent $PSCommandPath) 'detect.ps1'
if (Test-Path -LiteralPath $detect) {
  try {
    & $detect -Json -Out (Join-Path $CaseRoot 'detect.json') | Out-Null
    Add-Coc 'detect.json' 0 (Get-FileSizeSafe (Join-Path $CaseRoot 'detect.json')) 'detect.ps1 -Json'
  } catch { Add-Skip 'detect.json' ("Erkennung fehlgeschlagen: " + $_.Exception.Message) }
} else {
  Add-Skip 'detect.json' 'detect.ps1 nicht gefunden'
}

Save-Output 'host/systeminfo.txt'  { systeminfo }
Save-Output 'host/os.json'         { Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,InstallDate,LastBootUpTime,OSArchitecture,SystemDirectory } -As Json
Save-Output 'host/computer.json'   { Get-CimInstance Win32_ComputerSystem | Select-Object Name,Domain,Manufacturer,Model,TotalPhysicalMemory,PartOfDomain } -As Json
Save-Output 'host/whoami-all.txt'  { whoami /all }
Save-Output 'host/timezone.txt'    { Get-TimeZone | Format-List * }
Save-Output 'host/hotfixes.csv'    { Get-CimInstance Win32_QuickFixEngineering | Select-Object HotFixID,Description,InstalledOn } -As Csv
Save-Output 'host/env-sanitized.csv' {
  # Zugangsdaten gehören nicht in den Fallordner.
  Get-ChildItem Env: | ForEach-Object {
    $v = if ($_.Name -match '(?i)TOKEN|SECRET|PASSWORD|PASSWD|PASS|KEY|SESSION|CREDENTIAL|AUTH|COOKIE|BEARER|PRIVATE') {
      '<redigiert>'
    } else {
      ($_.Value -replace '(?<=://)[^/:@\s]+:[^/@\s]+(?=@)', '<redigiert>:<redigiert>')
    }
    [pscustomobject]@{ Name = $_.Name; Value = $v }
  }
} -As Csv

# ─── 1. Speicherabbild ────────────────────────────────────────────────────

[Console]::Error.WriteLine("  [1/7] Speicherabbild")
if (-not $Memory) {
  Add-Skip 'memory/' 'nicht angefordert (-Memory setzen)'
} elseif (-not $isAdmin) {
  Add-Skip 'memory/' 'Speicherabbild braucht Administrator-Rechte'
} else {
  $toolsDir = if ($env:HOST_FORENSICS_TOOLS) { $env:HOST_FORENSICS_TOOLS } else { '.\tools' }
  $winpmem = @(
    (Join-Path (Join-Path $toolsDir 'bin') 'winpmem.exe'),
    (Join-Path $toolsDir 'winpmem.exe')
  ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
  if (-not $winpmem) {
    Add-Skip 'memory/memory.raw' 'winpmem nicht vorhanden (fetch-tools.ps1 -Install winpmem)'
  } else {
    Write-Note 'Speicherabbild laeuft - das dauert und braucht Platz in Hoehe des RAM.'
    Save-Native 'memory/memory.raw' (Resolve-Path -LiteralPath $winpmem).Path `
      @('--format','raw','--output', (Join-Path $CaseRoot 'memory\memory.raw')) -WritesOwnFile
  }
}

# ─── 2. Prozesse und Netzwerk ─────────────────────────────────────────────

[Console]::Error.WriteLine("  [2/7] Prozesse und Netzwerk")

# Win32_Process liefert die Kommandozeile — Get-Process tut das nicht, und
# genau die Kommandozeile unterscheidet harmlos von verdaechtig.
Save-Output 'volatile/processes.csv' {
  Get-CimInstance Win32_Process |
    Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine,
                  @{n='CreationDate';e={ if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { '' } }},
                  SessionId
} -As Csv

Save-Output 'volatile/process-owners.csv' {
  Get-CimInstance Win32_Process | ForEach-Object {
    $o = Invoke-Probe { (Invoke-CimMethod -InputObject $_ -MethodName GetOwner -ErrorAction Stop) } $null
    [pscustomobject]@{
      ProcessId = $_.ProcessId
      Name      = $_.Name
      Domain    = if ($o) { $o.Domain } else { '' }
      User      = if ($o) { $o.User }   else { '' }
    }
  }
} -As Csv

# Prozesse ohne Pfad auf der Platte oder aus Benutzer-schreibbaren Pfaden.
Save-Output 'volatile/processes-suspicious-paths.csv' {
  Get-CimInstance Win32_Process |
    Where-Object {
      -not $_.ExecutablePath -or
      $_.ExecutablePath -match '(?i)\\(Temp|Tmp|AppData\\Local\\Temp|Downloads|Public|ProgramData)\\' -or
      $_.ExecutablePath -match '(?i)^[A-Z]:\\(Users|Windows\\Temp)\\.*\\(Temp|Downloads)\\'
    } |
    Select-Object ProcessId, Name, ExecutablePath, CommandLine
} -As Csv

Save-Output 'volatile/net-tcp.csv' {
  Get-NetTCPConnection | ForEach-Object {
    $p = Invoke-Probe { Get-Process -Id $_.OwningProcess -ErrorAction Stop } $null
    [pscustomobject]@{
      LocalAddress  = $_.LocalAddress
      LocalPort     = $_.LocalPort
      RemoteAddress = $_.RemoteAddress
      RemotePort    = $_.RemotePort
      State         = $_.State
      OwningProcess = $_.OwningProcess
      ProcessName   = if ($p) { $p.Name } else { '' }
      ProcessPath   = if ($p) { $p.Path } else { '' }
    }
  }
} -As Csv

Save-Output 'volatile/net-udp.csv'        { Get-NetUDPEndpoint | Select-Object LocalAddress,LocalPort,OwningProcess } -As Csv
Save-Output 'volatile/net-netstat.txt'    { netstat -anob }
Save-Output 'volatile/net-ipconfig.txt'   { ipconfig /all }
Save-Output 'volatile/net-route.txt'      { route print }
Save-Output 'volatile/net-arp.txt'        { arp -a }
Save-Output 'volatile/net-dnscache.csv'   { Get-DnsClientCache | Select-Object Entry,Name,Type,Data,TimeToLive } -As Csv
Save-Output 'volatile/net-dnsserver.csv'  { Get-DnsClientServerAddress | Select-Object InterfaceAlias,AddressFamily,ServerAddresses } -As Csv
Save-Output 'volatile/net-firewall-profiles.txt' { Get-NetFirewallProfile | Format-List * }
Save-Output 'volatile/net-firewall-rules-enabled.csv' {
  Get-NetFirewallRule -Enabled True | Select-Object Name,DisplayName,Direction,Action,Profile,Description
} -As Csv
Save-Output 'volatile/net-proxy.txt' {
  Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' |
    Select-Object ProxyEnable,ProxyServer,AutoConfigURL | Format-List *
}
Copy-Evidence "$env:SystemRoot\System32\drivers\etc\hosts" 'volatile/hosts'

Save-Output 'volatile/smb-sessions.csv'   { Get-SmbSession | Select-Object ClientComputerName,ClientUserName,NumOpens } -As Csv
Save-Output 'volatile/smb-shares.csv'     { Get-SmbShare | Select-Object Name,Path,Description } -As Csv
Save-Output 'volatile/smb-openfiles.csv'  { Get-SmbOpenFile | Select-Object ClientComputerName,ClientUserName,Path } -As Csv
Save-Output 'volatile/logged-on-users.txt' { query user }
Save-Output 'volatile/drivers.csv' {
  Get-CimInstance Win32_SystemDriver | Select-Object Name,DisplayName,PathName,State,StartMode
} -As Csv
Save-Output 'volatile/loaded-modules-unsigned.csv' {
  # Nicht signierte oder nicht prüfbare Module in laufenden Prozessen.
  #
  # Prozesse, deren Modulliste nicht lesbar ist (fehlende Rechte, 32/64-Bit-
  # Mismatch, Prozess beendet sich), werden gezählt und als eigene Zeile
  # ausgegeben: eine leere Datei soll nicht wie "alles signiert" aussehen,
  # wenn in Wahrheit nicht hineingesehen werden konnte.
  $unreadable = 0
  Get-Process | Where-Object { $_.Path } | ForEach-Object {
    $pname = $_.Name; $pid_ = $_.Id
    try {
      $_.Modules | ForEach-Object {
        $sig = Invoke-Probe { Get-AuthenticodeSignature -LiteralPath $_.FileName -ErrorAction Stop } $null
        if (-not $sig -or $sig.Status -ne 'Valid') {
          [pscustomobject]@{
            ProcessId = $pid_; Process = $pname; Module = $_.ModuleName
            Path = $_.FileName
            SignatureStatus = if ($sig) { [string]$sig.Status } else { 'nicht prüfbar' }
          }
        }
      }
    } catch { $unreadable++ }
  }
  if ($unreadable -gt 0) {
    [pscustomobject]@{
      ProcessId = -1; Process = "($unreadable Prozesse)"; Module = '(Modulliste nicht lesbar)'
      Path = ''; SignatureStatus = 'nicht prüfbar — Ergebnis unvollständig'
    }
  }
} -As Csv

# ─── 3. Autostarts ────────────────────────────────────────────────────────

[Console]::Error.WriteLine("  [3/7] Autostarts")

Save-Output 'persistence/scheduled-tasks.csv' {
  # Werte vorab berechnen: try/catch ist in PowerShell eine Anweisung, kein
  # Ausdruck, und darf deshalb nicht in einem Hashtable-Literal stehen.
  Get-ScheduledTask | ForEach-Object {
    $task = $_
    $info = Invoke-Probe { Get-ScheduledTaskInfo -TaskPath $task.TaskPath -TaskName $task.TaskName -ErrorAction Stop } $null
    $runAs = Invoke-Probe { [string]$task.Principal.UserId } ''
    $exes  = @()
    $args_ = @()
    foreach ($a in @($task.Actions)) {
      $exes  += (Invoke-Probe { [string]$a.Execute }   '')
      $args_ += (Invoke-Probe { [string]$a.Arguments } '')
    }
    [pscustomobject]@{
      TaskPath  = [string]$task.TaskPath
      TaskName  = [string]$task.TaskName
      State     = [string]$task.State
      Author    = [string]$task.Author
      RunAs     = $runAs
      Execute   = ($exes  -join ' | ')
      Arguments = ($args_ -join ' | ')
      LastRun   = if ($info -and $info.LastRunTime) { $info.LastRunTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { '' }
      NextRun   = if ($info -and $info.NextRunTime) { $info.NextRunTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { '' }
    }
  }
} -As Csv

Save-Output 'persistence/services.csv' {
  Get-CimInstance Win32_Service |
    Select-Object Name,DisplayName,State,StartMode,StartName,PathName,ServiceType,Description
} -As Csv

# Dienste, deren Binary in einem benutzerschreibbaren Pfad liegt oder deren
# Pfad unquotiert ist (klassische Rechteausweitung).
Save-Output 'persistence/services-suspicious.csv' {
  Get-CimInstance Win32_Service | Where-Object {
    $_.PathName -and (
      $_.PathName -match '(?i)\\(Temp|AppData|Downloads|ProgramData|Public)\\' -or
      ($_.PathName -notmatch '^"' -and $_.PathName -match '^[A-Za-z]:\\[^"]* [^"]*\.exe')
    )
  } | Select-Object Name,DisplayName,State,StartMode,StartName,PathName
} -As Csv

# Registry-Autostartpunkte. Nur lesen — reg.exe query/export verändert nichts.
$runKeys = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunServices',
  'HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Run',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\RunOnce',
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer\Run'
)
Save-Output 'persistence/registry-run-keys.csv' {
  foreach ($k in $runKeys) {
    if (-not (Test-Path -LiteralPath $k)) { continue }
    $item = Get-ItemProperty -LiteralPath $k -ErrorAction SilentlyContinue
    if (-not $item) { continue }
    $item.PSObject.Properties |
      Where-Object { $_.Name -notmatch '^PS(Path|ParentPath|ChildName|Drive|Provider)$' } |
      ForEach-Object { [pscustomobject]@{ Key = $k; Name = $_.Name; Value = [string]$_.Value } }
  }
} -As Csv

Save-Output 'persistence/registry-winlogon.txt' {
  Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon' |
    Select-Object Shell,Userinit,Taskman,AppSetup,GinaDLL,System,VMApplet | Format-List *
}
Save-Output 'persistence/registry-ifeo.csv' {
  # Image File Execution Options mit Debugger = Prozess-Hijacking.
  $base = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options'
  if (Test-Path -LiteralPath $base) {
    Get-ChildItem -LiteralPath $base | ForEach-Object {
      $v = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      if ($v -and ($v.PSObject.Properties.Name -contains 'Debugger')) {
        [pscustomobject]@{ Image = $_.PSChildName; Debugger = [string]$v.Debugger }
      }
    }
  }
} -As Csv
Save-Output 'persistence/registry-appinit.txt' {
  foreach ($k in @('HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows',
                   'HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows NT\CurrentVersion\Windows')) {
    if (Test-Path -LiteralPath $k) {
      Get-ItemProperty -LiteralPath $k | Select-Object PSPath,AppInit_DLLs,LoadAppInit_DLLs | Format-List *
    }
  }
}
Save-Output 'persistence/registry-lsa.txt' {
  Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Lsa' |
    Select-Object 'Authentication Packages','Notification Packages','Security Packages' | Format-List *
}
Save-Output 'persistence/registry-print-monitors.csv' {
  $base = 'HKLM:\SYSTEM\CurrentControlSet\Control\Print\Monitors'
  if (Test-Path -LiteralPath $base) {
    Get-ChildItem -LiteralPath $base | ForEach-Object {
      $v = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      [pscustomobject]@{ Monitor = $_.PSChildName; Driver = if ($v) { [string]$v.Driver } else { '' } }
    }
  }
} -As Csv

# WMI-Event-Abonnements: dauerhafte Persistenz ganz ohne Datei auf der Platte.
Save-Output 'persistence/wmi-event-filters.csv'   { Get-CimInstance -Namespace root\subscription -ClassName __EventFilter             | Select-Object Name,Query,QueryLanguage } -As Csv
Save-Output 'persistence/wmi-event-consumers.csv' { Get-CimInstance -Namespace root\subscription -ClassName __EventConsumer           | Select-Object * } -As Csv
Save-Output 'persistence/wmi-event-bindings.csv'  { Get-CimInstance -Namespace root\subscription -ClassName __FilterToConsumerBinding | Select-Object Filter,Consumer } -As Csv

Save-Output 'persistence/startup-folders.csv' {
  @(
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\StartUp'),
    (Join-Path $env:AppData     'Microsoft\Windows\Start Menu\Programs\Startup')
  ) | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object {
    Get-ChildItem -LiteralPath $_ -Force -ErrorAction SilentlyContinue |
      Select-Object FullName, Length,
                    @{n='LastWriteUtc';e={ $_.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ') }}
  }
} -As Csv

Save-Output 'persistence/bits-jobs.csv' { Get-BitsTransfer -AllUsers | Select-Object JobId,DisplayName,JobState,OwnerAccount,FileList } -As Csv
Save-Output 'persistence/winrm-listeners.txt' { winrm enumerate winrm/config/listener }

# Autoruns liefert in einem Durchgang mehr als die Einzelabfragen oben —
# wenn vorhanden, wird es zusätzlich mitgeschrieben.
$toolsDir = if ($env:HOST_FORENSICS_TOOLS) { $env:HOST_FORENSICS_TOOLS } else { '.\tools' }
$autorunsc = @(
  (Join-Path (Join-Path $toolsDir 'bin') 'autorunsc64.exe'),
  (Join-Path $toolsDir 'autorunsc64.exe')
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
if ($autorunsc) {
  # -accepteula ist nötig, damit der erste Lauf nicht auf eine Eingabe wartet.
  Save-Native 'persistence/autorunsc.csv' (Resolve-Path -LiteralPath $autorunsc).Path @('-accepteula','-a','*','-c','-h','-s','-nobanner','*')
} else {
  Add-Skip 'persistence/autorunsc.csv' 'Autoruns nicht vorhanden (fetch-tools.ps1 -Install autoruns) — die Registry-Abfragen oben deckten die wichtigsten Orte ab'
}

# ─── 4. Konten ────────────────────────────────────────────────────────────

[Console]::Error.WriteLine("  [4/7] Konten")

Save-Output 'accounts/local-users.csv' {
  Get-LocalUser | Select-Object Name,Enabled,SID,LastLogon,PasswordLastSet,PasswordRequired,PasswordExpires,Description
} -As Csv
Save-Output 'accounts/local-groups.csv' { Get-LocalGroup | Select-Object Name,SID,Description } -As Csv
Save-Output 'accounts/privileged-group-members.csv' {
  foreach ($g in @('Administrators','Remote Desktop Users','Remote Management Users','Backup Operators','Power Users')) {
    try {
      Get-LocalGroupMember -Group $g -ErrorAction Stop | ForEach-Object {
        [pscustomobject]@{ Group = $g; Member = $_.Name; Class = $_.ObjectClass; Source = $_.PrincipalSource }
      }
    } catch { }
  }
} -As Csv
Save-Output 'accounts/net-accounts.txt'   { net accounts }
Save-Output 'accounts/user-profiles.csv'  {
  Get-CimInstance Win32_UserProfile |
    Select-Object SID,LocalPath,Special,
                  @{n='LastUseUtc';e={ if ($_.LastUseTime) { $_.LastUseTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { '' } }}
} -As Csv
Save-Output 'accounts/rdp-settings.txt' {
  Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server' |
    Select-Object fDenyTSConnections,fSingleSessionPerUser | Format-List *
}
Save-Output 'accounts/ssh-authorized-keys.txt' {
  foreach ($d in @(Get-ChildItem -LiteralPath (Join-Path $env:SystemDrive 'Users') -Directory -ErrorAction SilentlyContinue)) {
    $f = Join-Path $d.FullName '.ssh\authorized_keys'
    if (Test-Path -LiteralPath $f) { "===== $f ====="; Get-Content -LiteralPath $f -ErrorAction SilentlyContinue }
  }
  $admKeys = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
  if (Test-Path -LiteralPath $admKeys) { "===== $admKeys ====="; Get-Content -LiteralPath $admKeys -ErrorAction SilentlyContinue }
}

# ─── 5. Logs ──────────────────────────────────────────────────────────────

[Console]::Error.WriteLine("  [5/7] Logs (Zeitfenster $LogDays Tage)")

# wevtutil epl exportiert auch gesperrte Logs — der Weg, der ohne Zugriff auf
# die .evtx-Dateien auf der Platte funktioniert.
$evtxLogs = @(
  @{ Name = 'Security';                                        File = 'security.evtx' },
  @{ Name = 'System';                                          File = 'system.evtx' },
  @{ Name = 'Application';                                     File = 'application.evtx' },
  @{ Name = 'Microsoft-Windows-Sysmon/Operational';            File = 'sysmon.evtx' },
  @{ Name = 'Microsoft-Windows-PowerShell/Operational';        File = 'powershell.evtx' },
  @{ Name = 'Windows PowerShell';                              File = 'powershell-classic.evtx' },
  @{ Name = 'Microsoft-Windows-TaskScheduler/Operational';     File = 'taskscheduler.evtx' },
  @{ Name = 'Microsoft-Windows-Windows Defender/Operational';  File = 'defender.evtx' },
  @{ Name = 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational'; File = 'rdp-local.evtx' },
  @{ Name = 'Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational'; File = 'rdp-remote.evtx' },
  @{ Name = 'Microsoft-Windows-WMI-Activity/Operational';      File = 'wmi-activity.evtx' },
  @{ Name = 'Microsoft-Windows-Bits-Client/Operational';       File = 'bits.evtx' }
)
foreach ($log in $evtxLogs) {
  $target = Join-Path $CaseRoot ('logs\' + $log.File)
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
  Save-Native ('logs/' + $log.File) 'wevtutil.exe' @('epl', $log.Name, $target, '/ow:true') -WritesOwnFile
}

Save-Output 'logs/eventlog-inventory.csv' {
  Get-WinEvent -ListLog * -ErrorAction SilentlyContinue |
    Where-Object { $_.RecordCount -gt 0 } |
    Select-Object LogName,RecordCount,IsEnabled,MaximumSizeInBytes,LogFilePath
} -As Csv

# Zusammenfassung der Ereignisse, die in einer Triage zuerst zählen.
# Die Event-IDs sind in references/windows.md erklärt.
$since = (Get-Date).AddDays(-$LogDays)
Save-Output 'logs/security-key-events.csv' {
  # "No events were found" ist der NORMALE Fall, wenn im Zeitfenster nichts
  # Passendes passiert ist — und damit eine Feststellung, keine Lücke.
  # Ohne dieses catch meldet summary.txt das Security-Log als nicht gesammelt.
  try {
  Get-WinEvent -FilterHashtable @{
    LogName = 'Security'
    StartTime = $since
    Id = 1102,4624,4625,4648,4672,4688,4698,4699,4700,4702,4719,4720,4722,4724,4728,4732,4738,4756,4776,5140,5145
  } -ErrorAction Stop |
    Select-Object @{n='TimeUtc';e={ $_.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }},
                  Id, LevelDisplayName, ProviderName,
                  @{n='Message';e={ ($_.Message -replace "\s+", ' ') }}
  } catch {
    if ($_.Exception.Message -notmatch 'No events were found') { throw }
  }
} -As Csv

Save-Output 'logs/system-key-events.csv' {
  try {
  Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    StartTime = $since
    Id = 6005,6006,6008,7034,7035,7036,7045,104,1074
  } -ErrorAction Stop |
    Select-Object @{n='TimeUtc';e={ $_.TimeCreated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }},
                  Id, LevelDisplayName, ProviderName,
                  @{n='Message';e={ ($_.Message -replace "\s+", ' ') }}
  } catch {
    if ($_.Exception.Message -notmatch 'No events were found') { throw }
  }
} -As Csv

Save-Output 'logs/defender-detections.csv' { Get-MpThreatDetection | Select-Object * } -As Csv
Save-Output 'logs/defender-threats.csv'    { Get-MpThreat          | Select-Object * } -As Csv
Save-Output 'logs/defender-status.txt'     { Get-MpComputerStatus  | Format-List * }
Save-Output 'logs/defender-preferences.txt' {
  # Ausnahmen sind ein beliebtes Angreifer-Ziel: was hier steht, wird nicht gescannt.
  Get-MpPreference | Select-Object ExclusionPath,ExclusionExtension,ExclusionProcess,DisableRealtimeMonitoring,
                                   DisableBehaviorMonitoring,DisableScriptScanning,MAPSReporting,SubmitSamplesConsent |
    Format-List *
}
Save-Output 'logs/auditpol.txt' { auditpol /get /category:* }

# ─── 6. Dateien ───────────────────────────────────────────────────────────

[Console]::Error.WriteLine("  [6/7] Dateien")

$tempPaths = @("$env:SystemRoot\Temp", $env:TEMP, (Join-Path $env:SystemDrive 'Users\Public')) |
  Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique

Save-Output 'filesystem/temp-executables.csv' {
  foreach ($p in $tempPaths) {
    Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -match '(?i)^\.(exe|dll|scr|sys|ps1|bat|cmd|vbs|js|jse|wsf|hta|lnk|jar|msi|com|pif)$' } |
      Select-Object -First 2000 FullName, Length,
                    @{n='LastWriteUtc';e={ $_.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ') }},
                    @{n='CreationUtc';e={ $_.CreationTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ') }}
  }
} -As Csv

Save-Output 'filesystem/user-startup-and-downloads.csv' {
  Get-ChildItem -LiteralPath (Join-Path $env:SystemDrive 'Users') -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    foreach ($sub in @('Downloads','Desktop','AppData\Local\Temp','AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup')) {
      $d = Join-Path $_.FullName $sub
      if (-not (Test-Path -LiteralPath $d)) { continue }
      Get-ChildItem -LiteralPath $d -File -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -match '(?i)^\.(exe|dll|scr|ps1|bat|cmd|vbs|js|hta|lnk|msi|iso|img|zip|7z|rar)$' } |
        Select-Object -First 500 FullName, Length,
                      @{n='LastWriteUtc';e={ $_.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ') }}
    }
  }
} -As Csv

# Alternative Datenströme: Herkunft heruntergeladener Dateien (Zone.Identifier)
# und versteckte Nutzlasten.
Save-Output 'filesystem/alternate-data-streams.csv' {
  foreach ($p in $tempPaths) {
    Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue |
      Select-Object -First 2000 | ForEach-Object {
        $streams = Invoke-Probe { Get-Item -LiteralPath $_.FullName -Stream * -ErrorAction Stop } $null
        if ($streams) {
          $streams | Where-Object { $_.Stream -ne ':$DATA' } | ForEach-Object {
            [pscustomobject]@{ File = $_.FileName; Stream = $_.Stream; Length = $_.Length }
          }
        }
      }
  }
} -As Csv

Save-Output 'filesystem/unsigned-in-system32.csv' {
  Get-ChildItem -LiteralPath "$env:SystemRoot\System32" -File -Filter *.exe -ErrorAction SilentlyContinue |
    Select-Object -First 3000 | ForEach-Object {
      $sig = Invoke-Probe { Get-AuthenticodeSignature -LiteralPath $_.FullName -ErrorAction Stop } $null
      if (-not $sig -or $sig.Status -ne 'Valid') {
        [pscustomobject]@{
          Path = $_.FullName; Status = if ($sig) { [string]$sig.Status } else { 'nicht prüfbar' }
          LastWriteUtc = $_.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ')
        }
      }
    }
} -As Csv

Save-Output 'filesystem/recycle-bin.csv' {
  $rb = Join-Path $env:SystemDrive '$Recycle.Bin'
  if (Test-Path -LiteralPath $rb) {
    Get-ChildItem -LiteralPath $rb -Recurse -Force -ErrorAction SilentlyContinue |
      Select-Object -First 2000 FullName, Length,
                    @{n='LastWriteUtc';e={ $_.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ') }}
  }
} -As Csv

foreach ($d in $ExtraDir) {
  if (-not $d) { continue }
  if (-not (Test-Path -LiteralPath $d)) { Add-Skip 'filesystem/extra' ("nicht vorhanden: " + $d); continue }
  $safe = ($d -replace '[^A-Za-z0-9._-]', '_')
  Save-Output ("filesystem/extra-$safe.csv") {
    Get-ChildItem -LiteralPath $d -Recurse -File -Force -ErrorAction SilentlyContinue |
      Select-Object -First 20000 FullName, Length,
                    @{n='LastWriteUtc';e={ $_.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ') }}
  } -As Csv
}

# Prefetch und Amcache sind gesperrt bzw. nur mit Rechten lesbar. Der Versuch
# wird protokolliert; der saubere Weg steht in der Fehlermeldung.
if ($isAdmin) {
  Copy-Evidence "$env:SystemRoot\Prefetch" 'filesystem/Prefetch' -Recurse
  Copy-Evidence "$env:SystemRoot\AppCompat\Programs\Amcache.hve" 'filesystem/Amcache.hve'
  Copy-Evidence "$env:SystemRoot\System32\sru\SRUDB.dat" 'filesystem/SRUDB.dat'
} else {
  Add-Skip 'filesystem/Prefetch' 'Administrator-Rechte nötig'
  Add-Skip 'filesystem/Amcache.hve' 'Administrator-Rechte nötig'
}

# ─── 6b. Registry-Hives (nur Betriebsart collect) ─────────────────────────

if ($Mode -eq 'collect') {
  if ($isAdmin) {
    # reg save nutzt das Backup-Privileg und liest damit auch gesperrte Hives.
    foreach ($h in @(
      @{ Key = 'HKLM\SYSTEM';   File = 'SYSTEM.hiv' },
      @{ Key = 'HKLM\SOFTWARE'; File = 'SOFTWARE.hiv' },
      @{ Key = 'HKLM\SAM';      File = 'SAM.hiv' },
      @{ Key = 'HKLM\SECURITY'; File = 'SECURITY.hiv' }
    )) {
      $target = Join-Path $CaseRoot ('registry\' + $h.File)
      if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Force -ErrorAction SilentlyContinue }
      Save-Native ('registry/' + $h.File) 'reg.exe' @('save', $h.Key, $target, '/y') -WritesOwnFile
    }
    Write-Note 'SAM- und SECURITY-Hive enthalten Passwort-Hashes. Fallordner entsprechend behandeln.'
  } else {
    Add-Skip 'registry/' 'Registry-Hives brauchen Administrator-Rechte (reg save)'
  }
} else {
  Add-Skip 'registry/' 'nur in Betriebsart collect (-Mode collect)'
}

# ─── 7. Hashes ────────────────────────────────────────────────────────────

[Console]::Error.WriteLine("  [7/7] Hashes")

Save-Output 'hashes/process-binaries.csv' {
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } |
    Select-Object -Property ExecutablePath -Unique | ForEach-Object {
      $h = Invoke-Probe { (Get-FileHash -LiteralPath $_.ExecutablePath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } 'UNREADABLE'
      $sig = Invoke-Probe { [string](Get-AuthenticodeSignature -LiteralPath $_.ExecutablePath -ErrorAction Stop).Status } 'nicht prüfbar'
      [pscustomobject]@{ Sha256 = $h; Signature = $sig; Path = $_.ExecutablePath }
    }
} -As Csv

Save-Output 'hashes/service-binaries.csv' {
  Get-CimInstance Win32_Service | Where-Object { $_.PathName } | ForEach-Object {
    # PathName enthält Argumente; nur der Programmpfad wird gehasht.
    $exe = if ($_.PathName -match '^"([^"]+)"') { $Matches[1] } else { ($_.PathName -split ' ')[0] }
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { return }
    $h = Invoke-Probe { (Get-FileHash -LiteralPath $exe -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } 'UNREADABLE'
    $sig = Invoke-Probe { [string](Get-AuthenticodeSignature -LiteralPath $exe -ErrorAction Stop).Status } 'nicht prüfbar'
    [pscustomobject]@{ Sha256 = $h; Signature = $sig; Service = $_.Name; Path = $exe }
  }
} -As Csv

Save-Output 'hashes/scheduled-task-binaries.csv' {
  Get-ScheduledTask | ForEach-Object {
    $task = $_
    foreach ($a in @($task.Actions)) {
      $exe = Invoke-Probe { $a.Execute } $null
      if (-not $exe) { continue }
      $exe = $exe.Trim('"')
      $resolved = Invoke-Probe { [Environment]::ExpandEnvironmentVariables($exe) } $exe
      if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { continue }
      $h = Invoke-Probe { (Get-FileHash -LiteralPath $resolved -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } 'UNREADABLE'
      [pscustomobject]@{ Sha256 = $h; Task = ($task.TaskPath + $task.TaskName); Path = $resolved }
    }
  }
} -As Csv

Save-Output 'hashes/temp-executables.csv' {
  foreach ($p in $tempPaths) {
    Get-ChildItem -LiteralPath $p -Recurse -File -Force -ErrorAction SilentlyContinue |
      Where-Object { $_.Extension -match '(?i)^\.(exe|dll|scr|sys|ps1|bat|cmd|vbs|js|hta|msi|com)$' -and $_.Length -lt 200MB } |
      Select-Object -First 2000 | ForEach-Object {
        $h = Invoke-Probe { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } 'UNREADABLE'
        [pscustomobject]@{ Sha256 = $h; Path = $_.FullName; Length = $_.Length }
      }
  }
} -As Csv

# ─── Abschluss: Manifest und Zusammenfassung ──────────────────────────────

[Console]::Error.WriteLine("")

$manifestPath = Join-Path $CaseRoot 'manifest.tsv'
$summaryPath  = Join-Path $CaseRoot 'summary.txt'
$bookkeeping  = @('manifest.tsv','summary.txt','chain-of-custody.log')

$manifestLines = @(
  '# AIOS host-forensics — Manifest',
  ('# Erzeugt: ' + (Get-NowUtc)),
  '# Spalten (Tabulator): sha256  bytes  mtime_utc  pfad_relativ',
  '# Erfasst sind die Beweisdateien. Nicht erfasst sind manifest.tsv,',
  '# summary.txt und chain-of-custody.log — sie entstehen bzw. wachsen nach',
  '# dem Hashen. Das Protokoll haelt am Ende den Hash dieses Manifests.'
)

$count = 0
foreach ($f in (Get-ChildItem -LiteralPath $CaseRoot -Recurse -File -Force -ErrorAction SilentlyContinue)) {
  $rel = $f.FullName.Substring($CaseRoot.Length).TrimStart('\','/')
  if ($bookkeeping -contains $rel) { continue }
  $h = Invoke-Probe { (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } 'UNAVAILABLE'
  $manifestLines += ("{0}`t{1}`t{2}`t{3}" -f $h, $f.Length,
                     $f.LastWriteTimeUtc.ToString('yyyy-MM-ddTHH:mm:ssZ'),
                     ($rel -replace "[`t`r`n]", '?'))
  $count++
}
[System.IO.File]::WriteAllText($manifestPath, (($manifestLines -join "`n") + "`n"), $Utf8NoBom)

$manifestHash = Invoke-Probe { (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } 'UNAVAILABLE'

# Die drei Zustände getrennt halten: "geprüft, kein Treffer" ist eine
# Feststellung, "nicht gesammelt" ist eine Lücke. Verwechslung macht aus
# "nicht geprüft" versehentlich ein "sauber".
$cocParsed = @(Get-Content -LiteralPath $CocPath -ErrorAction SilentlyContinue |
  Where-Object { $_ -and $_ -notmatch '^#' } |
  ForEach-Object {
    $c = $_ -split "`t"
    if ($c.Count -ge 4) { [pscustomobject]@{ Rel = $c[1]; Rc = $c[2]; Bytes = $c[3] } }
  })

$emptyOk = @($cocParsed | Where-Object { $_.Rc -eq '0' -and $_.Bytes -eq '0' } | Select-Object -ExpandProperty Rel -Unique | Sort-Object)
$failed  = @($cocParsed | Where-Object { $_.Rc -ne '0' -and $_.Rc -ne 'skipped' } | ForEach-Object { "Exit $($_.Rc)  $($_.Rel)" } | Select-Object -Unique | Sort-Object)

$sum = @()
$sum += 'AIOS host-forensics — Sammlungsbericht'
$sum += '======================================='
$sum += ''
$sum += ('Abgeschlossen : ' + (Get-NowUtc))
$sum += ('Betriebsart   : ' + $Mode)
$sum += ('Host          : ' + $env:COMPUTERNAME)
$sum += ('System        : windows ' + $env:PROCESSOR_ARCHITECTURE)
$sum += ('Operator      : ' + $operator)
$sum += ('Rechte        : ' + $(if ($isAdmin) { 'Administrator' } else { 'eingeschränkt (kein Administrator) — Lücken siehe unten' }))
$sum += ('Dateien       : ' + $count)
$sum += ('Manifest      : manifest.tsv (sha256 ' + $manifestHash + ')')
$sum += ''
$sum += 'Nicht gesammelt (Lücke in der Abdeckung)'
$sum += '----------------------------------------'
if (@($skipped).Count -gt 0) { $sum += @($skipped) } else { $sum += '(nichts übersprungen)' }
$sum += ''
$sum += 'Geprüft, kein Treffer (leeres Ergebnis, Befehl lief fehlerfrei)'
$sum += '--------------------------------------------------------------'
if ($emptyOk.Count -gt 0) { $sum += ($emptyOk | ForEach-Object { '  ' + $_ }) } else { $sum += '  (keine)' }
$sum += ''
$sum += 'Befehle mit Fehlern (Ergebnis unvollständig, stderr im Fallordner)'
$sum += '-----------------------------------------------------------------'
if ($failed.Count -gt 0) { $sum += ($failed | ForEach-Object { '  ' + $_ }) } else { $sum += '  (keine)' }
$sum += ''
$sum += 'Diese Sammlung ist eine Momentaufnahme mit Bordmitteln des laufenden'
$sum += 'Systems. Ein Rootkit kann Prozesse, Dateien und Verbindungen vor diesen'
$sum += 'Werkzeugen verbergen. Die Ergebnisse sind daher "mindestens", nie "genau".'
[System.IO.File]::WriteAllText($summaryPath, (($sum -join "`n") + "`n"), $Utf8NoBom)

# Kommentar-Zeichen zuerst, wie in lib.sh: sonst liest der Filter in
# hf_case_finalize diese Zeile als normalen Befehl und meldet die
# Dateianzahl als Exit-Code.
[System.IO.File]::AppendAllText(
  $CocPath,
  ("# end`t{0}`tfiles={1}`tmanifest_sha256={2}`n" -f (Get-NowUtc), $count, $manifestHash),
  $Utf8NoBom)

Write-Note ("Manifest: {0} Dateien, sha256 {1}" -f $count, $manifestHash)
[Console]::Error.WriteLine("")
Write-Note 'Naechster Schritt: Auswertung. Die Rohdaten bleiben ab jetzt unveraendert.'
[Console]::Out.Write($CaseRoot)
[Console]::Out.Write("`n")
