<#
.SYNOPSIS
  AIOS host-forensics — Systemerkennung für Windows.

.DESCRIPTION
  Ermittelt rein lesend: Windows-Version, Administrator-Rechte, vorhandene
  Werkzeuge, Defender-/EDR-Status und die Protokoll-Abdeckung (Audit-Policy,
  PowerShell-Logging, Sysmon). Das Ergebnis entscheidet über Betriebsart und
  Umfang der anschliessenden Sammlung.

  Ergebnis als JSON auf stdout, Hinweise auf stderr.

.PARAMETER Text
  Lesbare Zusammenfassung statt JSON.

.PARAMETER Out
  Ergebnis in diese Datei schreiben statt auf stdout.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File detect.ps1 -Json
#>
[CmdletBinding()]
param(
  [switch]$Json,
  [switch]$Text,
  [string]$Out = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# Bewusst einfache PowerShell-Arrays statt List<T>: der Cast einer Hashtable
# nach [ordered] und @() auf List[object] verhalten sich zwischen
# PowerShell-Versionen unterschiedlich. Die Listen hier sind klein, der
# Zuwachs per += kostet nichts.
$limits = @()
function Add-Limit([string]$m) { $script:limits += $m }

# Jede Sonde einzeln abfangen: eine fehlende Quelle darf die Erkennung nicht beenden.
function Invoke-Probe([scriptblock]$Probe, $Fallback = $null) {
  try { & $Probe } catch { $Fallback }
}

# ─── Basisdaten ───────────────────────────────────────────────────────────

$os = Invoke-Probe { Get-CimInstance Win32_OperatingSystem -ErrorAction Stop }
$cs = Invoke-Probe { Get-CimInstance Win32_ComputerSystem  -ErrorAction Stop }

$host_ = [ordered]@{
  hostname   = $env:COMPUTERNAME
  os         = 'windows'
  os_name    = if ($os) { $os.Caption }      else { 'unknown' }
  os_version = if ($os) { $os.Version }      else { [string][System.Environment]::OSVersion.Version }
  build      = if ($os) { $os.BuildNumber }  else { 'unknown' }
  arch       = if ($env:PROCESSOR_ARCHITECTURE) { $env:PROCESSOR_ARCHITECTURE } else { 'unknown' }
  domain     = if ($cs) { $cs.Domain }       else { 'unknown' }
  boot_time  = if ($os -and $os.LastBootUpTime) { $os.LastBootUpTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { 'unknown' }
}

# Auch die Identitaetsabfrage wird gekapselt: auf Nicht-Windows wirft sie,
# und das Skript soll dann eine klare Meldung liefern statt abzubrechen.
$identity = Invoke-Probe { [Security.Principal.WindowsIdentity]::GetCurrent() }
$isAdmin  = $false
if ($identity) {
  $isAdmin = Invoke-Probe {
    ([Security.Principal.WindowsPrincipal]$identity).IsInRole(
      [Security.Principal.WindowsBuiltInRole]::Administrator)
  } $false
}

$privileges = [ordered]@{
  user     = if ($identity) { [string]$identity.Name } elseif ($env:USERNAME) { $env:USERNAME } else { 'unknown' }
  is_admin = [bool]$isAdmin
  sid      = if ($identity -and $identity.User) { [string]$identity.User.Value } else { '' }
}

if (-not $identity) {
  Add-Limit 'Die Windows-Identität war nicht abfragbar — dieses Skript läuft offenbar nicht auf Windows. Für Linux und macOS detect.sh verwenden, für Windows-aus-WSL collect-windows.sh.'
}

if (-not $isAdmin) {
  Add-Limit 'Keine Administrator-Rechte: Security-Eventlog, Registry-Hives, fremde Prozess-Pfade, Dienst-Binaries und Prefetch sind nicht lesbar. Ein Rot-Befund kann dadurch unentdeckt bleiben. Terminal als Administrator neu starten.'
}

# ─── Werkzeuge ────────────────────────────────────────────────────────────

$toolsDir = if ($env:HOST_FORENSICS_TOOLS) { $env:HOST_FORENSICS_TOOLS } else { '.\tools' }

$probe = @(
  'hayabusa.exe','chainsaw.exe','yr.exe','yara64.exe','velociraptor.exe',
  'winpmem.exe','vol.exe','osqueryi.exe','Autoruns64.exe','autorunsc64.exe',
  'wevtutil.exe','reg.exe','schtasks.exe','sc.exe','tasklist.exe','netstat.exe',
  'powershell.exe','pwsh.exe','certutil.exe','robocopy.exe','clamscan.exe'
)

$tools = @()
foreach ($t in $probe) {
  $path = $null; $source = $null
  foreach ($cand in @((Join-Path (Join-Path $toolsDir 'bin') $t), (Join-Path $toolsDir $t))) {
    if (Test-Path -LiteralPath $cand -PathType Leaf) { $path = (Resolve-Path -LiteralPath $cand).Path; $source = 'tools'; break }
  }
  if (-not $path) {
    $cmd = Get-Command $t -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($cmd) { $path = $cmd.Source; $source = 'path' }
  }
  if ($path) { $tools += [pscustomobject]@{ name = $t; path = $path; source = $source } }
}

# @() erzwingt ein Array: unter StrictMode hat $null kein .Count.
function Test-Tool([string]$n) { ($tools | Where-Object { $_.name -eq $n } | Measure-Object).Count -gt 0 }

if (-not (Test-Tool 'hayabusa.exe') -and -not (Test-Tool 'chainsaw.exe')) {
  Add-Limit 'Weder Hayabusa noch Chainsaw vorhanden: Eventlogs können nicht regelbasiert ausgewertet werden. Nachladen mit fetch-tools.ps1 -Install hayabusa,chainsaw.'
}
if (-not (Test-Tool 'yr.exe') -and -not (Test-Tool 'yara64.exe') -and -not (Test-Tool 'clamscan.exe')) {
  Add-Limit 'Kein Malware-Scanner vorhanden (YARA-X, YARA oder ClamAV). Die Dateiprüfung bleibt auf Hash-Abgleich und Defender beschränkt.'
}

# ─── Defender / EDR ───────────────────────────────────────────────────────

$security = @()
function Add-Sec($product, $state, $detail) {
  $script:security += [pscustomobject]@{
    product = [string]$product
    state   = [string]$state
    detail  = [string]$detail
  }
}

$mp = Invoke-Probe { Get-MpComputerStatus -ErrorAction Stop }
if ($mp) {
  Add-Sec 'Microsoft Defender' $(if ($mp.AMServiceEnabled) { 'aktiv' } else { 'inaktiv' }) (
    ('RealTime={0}; Tamper={1}; Signaturen={2}; Engine={3}' -f `
      $mp.RealTimeProtectionEnabled, $mp.IsTamperProtected,
      $(if ($mp.AntivirusSignatureLastUpdated) { $mp.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { 'unbekannt' }),
      $mp.AMEngineVersion))
  if (-not $mp.RealTimeProtectionEnabled) {
    Add-Limit 'Defender-Echtzeitschutz ist aus. Das ist selbst ein Befund — prüfe, wer ihn abgeschaltet hat (Eventlog Microsoft-Windows-Windows Defender/Operational, ID 5001).'
  }
} else {
  Add-Sec 'Microsoft Defender' 'nicht abfragbar' 'Get-MpComputerStatus fehlgeschlagen — fehlende Rechte, oder Defender wurde durch ein anderes Produkt ersetzt'
  Add-Limit 'Defender-Status nicht abfragbar: der Scanner-Zustand bleibt unbekannt und gehört so in die Abdeckungstabelle.'
}

# Registrierte AV-Produkte (auch Drittanbieter) über das Security Center.
$avs = Invoke-Probe { Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop }
foreach ($av in @($avs)) {
  if (-not $av) { continue }
  # Drittanbieter-Einträge liefern nicht immer alle Properties.
  $avName = Invoke-Probe { [string]$av.displayName } 'unbekannt'
  $avPath = Invoke-Probe { [string]$av.pathToSignedProductExe } ''
  Add-Sec $avName 'registriert' ("Pfad=" + $avPath)
}

$sysmon = Invoke-Probe { Get-Service -Name 'Sysmon*' -ErrorAction Stop | Select-Object -First 1 }
if ($sysmon) {
  Add-Sec 'Sysmon' $sysmon.Status 'Dienst gefunden — Eventlog Microsoft-Windows-Sysmon/Operational auswerten'
} else {
  Add-Limit 'Sysmon ist nicht installiert: Prozessstart-Historie mit Kommandozeilen und Hashes fehlt. Ohne Sysmon stützt sich die Prozessanalyse nur auf Security 4688, falls dort aktiviert.'
}

$bl = Invoke-Probe { Get-BitLockerVolume -MountPoint 'C:' -ErrorAction Stop }
if ($bl) { Add-Sec 'BitLocker (C:)' $bl.ProtectionStatus ('Verschlüsselung=' + $bl.VolumeStatus) }

# ─── Protokoll-Abdeckung ──────────────────────────────────────────────────
#
# Ohne diese Einstellungen gibt es die Ereignisse gar nicht — das ist eine
# Lücke in der Prüfung, nicht ein Befund "nichts gefunden".

$logging = [ordered]@{}

$ap = Invoke-Probe { & auditpol.exe /get /category:* 2>$null }
if ($ap) {
  $logonAudit = (@($ap) | Out-String)
  $logging['auditpol_available'] = $true
  if ($logonAudit -match 'Logon/Logoff' -and $logonAudit -match 'No Auditing|Keine Überwachung') {
    Add-Limit 'Die Audit-Policy protokolliert Anmeldungen nicht vollständig. Fehlende Logon-Events bedeuten nicht, dass es keine Anmeldungen gab.'
  }
} else {
  $logging['auditpol_available'] = $false
  Add-Limit 'auditpol nicht abfragbar (meist fehlende Admin-Rechte): die Protokoll-Abdeckung des Security-Logs ist unbekannt.'
}

$sbl = Invoke-Probe { (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\PowerShell\ScriptBlockLogging' -Name 'EnableScriptBlockLogging' -ErrorAction Stop).EnableScriptBlockLogging }
$logging['powershell_scriptblock_logging'] = [bool]$sbl
if (-not $sbl) {
  Add-Limit 'PowerShell-ScriptBlock-Logging ist aus: ausgeführte PowerShell-Befehle sind nachträglich nicht rekonstruierbar (Eventlog 4104 fehlt).'
}

$cmdline = Invoke-Probe { (Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System\Audit' -Name 'ProcessCreationIncludeCmdLine_Enabled' -ErrorAction Stop).ProcessCreationIncludeCmdLine_Enabled }
$logging['process_cmdline_auditing'] = [bool]$cmdline
if (-not $cmdline) {
  Add-Limit 'Prozessstart-Protokollierung ohne Kommandozeile (4688 ohne CommandLine): der Aufrufparameter verdächtiger Prozesse fehlt in der Historie.'
}

# ─── Eventlog-Grössen (sagt, wie weit die Historie reicht) ────────────────

$logs = @()
foreach ($name in @('Security','System','Application','Microsoft-Windows-Sysmon/Operational','Microsoft-Windows-PowerShell/Operational','Microsoft-Windows-TaskScheduler/Operational')) {
  $li = Invoke-Probe { Get-WinEvent -ListLog $name -ErrorAction Stop }
  if ($li) {
    $logs += [pscustomobject]@{
      name    = $name
      enabled = [bool]$li.IsEnabled
      records = [int64]$li.RecordCount
      max_mb  = [math]::Round($li.MaximumSizeInBytes / 1MB, 1)
      file    = [string]$li.LogFilePath
    }
  }
}
# -ListLog gelingt auch ohne Admin-Rechte, es sagt also nichts über die
# Lesbarkeit. Erst der Versuch, einen Datensatz zu holen, zeigt es.
$securityReadable = $null -ne (Invoke-Probe { Get-WinEvent -LogName 'Security' -MaxEvents 1 -ErrorAction Stop })
$logging['security_log_readable'] = [bool]$securityReadable
if (-not $securityReadable) {
  Add-Limit 'Das Security-Eventlog ist nicht lesbar (Administrator-Rechte nötig). Anmeldungen, Rechteausweitungen und Kontoänderungen bleiben ungeprüft.'
}

# ─── Ergebnis ─────────────────────────────────────────────────────────────

# Gleiche Form wie in detect.sh, damit beide Erkennungen austauschbar sind.
$wslInfo = [ordered]@{}
$wslInfo['is_wsl']          = $false
$wslInfo['interop']         = $false
$wslInfo['mnt_c']           = $false
$wslInfo['windows_version'] = ''
$wslInfo['windows_admin']   = ''


$result = [ordered]@{}
$result['schema']            = 'aios.host-forensics.detect/1'
$result['generated_at']      = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$result['host']              = $host_
$result['privileges']        = $privileges
$result['wsl']               = $wslInfo
$result['tools_dir']         = $toolsDir
$result['tools']             = @($tools)
$result['security_products'] = @($security)
$result['logging']           = $logging
$result['event_logs']        = @($logs)
$result['recommended_mode']  = 'live'
$result['limitations']       = @($limits)

# -Json ist der Standard; der Schalter macht ihn explizit und schliesst -Text aus.
if ($Json -and $Text) {
  [Console]::Error.WriteLine('  -Json und -Text schliessen sich aus.')
  exit 1
}

if ($Text) {
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine(("Host        : {0} ({1} Build {2}, {3})" -f $host_.hostname, $host_.os_name, $host_.build, $host_.arch))
  [void]$sb.AppendLine(("Nutzer      : {0}{1}" -f $privileges.user, $(if ($isAdmin) { ' — Administrator' } else { ' — KEIN Administrator' })))
  [void]$sb.AppendLine(("Tools-Pfad  : {0}" -f $toolsDir))
  [void]$sb.AppendLine(("Werkzeuge   : {0} gefunden" -f @($tools).Count))
  [void]$sb.AppendLine(("Scanner     : {0}" -f (($security | ForEach-Object { "$($_.product)=$($_.state)" }) -join '; ')))
  [void]$sb.AppendLine('')
  [void]$sb.AppendLine('Grenzen dieser Prüfung')
  [void]$sb.AppendLine('----------------------')
  if (@($limits).Count -gt 0) { foreach ($l in $limits) { [void]$sb.AppendLine("- $l") } } else { [void]$sb.AppendLine('- keine') }
  $output = $sb.ToString()
} else {
  $output = $result | ConvertTo-Json -Depth 6
}

if ($Out) {
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  # UTF-8 ohne BOM: sonst stolpern Linux-Werkzeuge über die Signatur.
  [System.IO.File]::WriteAllText($Out, $output, (New-Object System.Text.UTF8Encoding $false))
  [Console]::Error.WriteLine("  Erkennung geschrieben: $Out")
} else {
  [Console]::Out.Write($output)
  [Console]::Out.Write("`n")
}
