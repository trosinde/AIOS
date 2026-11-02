<#
.SYNOPSIS
  AIOS host-forensics — portable Werkzeuge nachladen und prüfen (Windows).

.DESCRIPTION
  Lädt die im Katalog (tools.catalog.tsv) gepinnten Versionen in das
  Tools-Verzeichnis des Arbeitsverzeichnisses und prüft jede Datei gegen die
  vom Projekt veröffentlichte SHA-256-Prüfsumme.

  Woher die Prüfsumme kommt (Spalte digest_source im Katalog):
    gh-api  Die GitHub-Release-API nennt pro Asset ein Feld "digest"
            (sha256:...). Das ist die Angabe des Projekts auf GitHub.
    <URL>   Das Projekt veröffentlicht eine Checksum-Datei.
    none    Kein veröffentlichter Hash. Dann gilt Trust-on-First-Use: der
            Hash des ersten Downloads wird in tools\lock.tsv festgeschrieben,
            jeder spätere Lauf vergleicht dagegen. Braucht -AllowUnpinned.

  tools\lock.tsv ist die Prüfsummen-Datei des Arbeitsverzeichnisses. Weicht
  ein erneuter Download davon ab, bricht das Skript ab — das ist der Fall,
  den man sehen will.

.PARAMETER List
  Verfügbare Werkzeuge für diese Plattform anzeigen.

.PARAMETER Install
  Werkzeuge installieren. Namen durch Komma getrennt, oder 'all'.

.PARAMETER Verify
  Installierte Werkzeuge gegen lock.tsv prüfen.

.PARAMETER Dir
  Zielverzeichnis. Standard: $env:HOST_FORENSICS_TOOLS oder .\tools

.PARAMETER AllowUnpinned
  Werkzeuge ohne veröffentlichte Prüfsumme zulassen.

.PARAMETER Force
  Abweichenden Hash akzeptieren und lock.tsv überschreiben.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File fetch-tools.ps1 -List

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File fetch-tools.ps1 -Install hayabusa,chainsaw
#>
[CmdletBinding()]
param(
  [switch]$List,
  [string[]]$Install = @(),
  [switch]$Verify,
  [string]$Dir = '',
  [switch]$AllowUnpinned,
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
function Write-Note([string]$m) { [Console]::Error.WriteLine("  $m") }
function Write-Fail([string]$m) { [Console]::Error.WriteLine("ERROR $m") }
function Write-Warn2([string]$m) { [Console]::Error.WriteLine("WARN  $m") }
function Get-NowUtc { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

if (-not ($List -or $Verify -or @($Install).Count -gt 0)) {
  Write-Fail 'Eine Aktion fehlt: -List, -Install <namen|all> oder -Verify'
  exit 1
}

$catalog = Join-Path (Split-Path -Parent $PSCommandPath) '..\tools.catalog.tsv'
if (-not (Test-Path -LiteralPath $catalog)) { Write-Fail "Katalog nicht gefunden: $catalog"; exit 1 }
$catalog = (Resolve-Path -LiteralPath $catalog).Path

if (-not $Dir) { $Dir = if ($env:HOST_FORENSICS_TOOLS) { $env:HOST_FORENSICS_TOOLS } else { '.\tools' } }
if (-not (Test-Path -LiteralPath $Dir)) { New-Item -ItemType Directory -Path $Dir -Force | Out-Null }
$ToolsDir = (Resolve-Path -LiteralPath $Dir).Path
$LockPath = Join-Path $ToolsDir 'lock.tsv'

$targetOs = 'windows'
$targetArch = switch -Regex ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'x86_64' }
  'ARM64' { 'aarch64' }
  'x86'   { 'x86' }
  default { 'x86_64' }
}

# ─── Katalog ──────────────────────────────────────────────────────────────

function Get-CatalogRows {
  Get-Content -LiteralPath $catalog | ForEach-Object {
    if ($_ -match '^\s*#' -or -not $_.Trim()) { return }
    $c = $_ -split "`t"
    if ($c.Count -lt 10) { return }
    if (($c[1] -ne $targetOs -and $c[1] -ne 'any')) { return }
    if (($c[2] -ne $targetArch -and $c[2] -ne 'any')) { return }
    [pscustomobject]@{
      Id = $c[0]; Os = $c[1]; Arch = $c[2]; Version = $c[3]; Url = $c[4]
      DigestSource = $c[5]; Extract = $c[6]; Entry = $c[7]; License = $c[8]; Purpose = $c[9]
    }
  }
}

# ─── lock.tsv ─────────────────────────────────────────────────────────────

function Get-LockRows {
  if (-not (Test-Path -LiteralPath $LockPath)) { return @() }
  Get-Content -LiteralPath $LockPath | ForEach-Object {
    if ($_ -match '^\s*#' -or -not $_.Trim()) { return }
    $c = $_ -split "`t"
    if ($c.Count -lt 8) { return }
    [pscustomobject]@{
      Id = $c[0]; Os = $c[1]; Arch = $c[2]; Version = $c[3]
      ArtifactSha = $c[4]; DigestSource = $c[5]; InstalledAt = $c[6]; Path = $c[7]
      InstalledSha = if ($c.Count -ge 9) { $c[8] } else { '' }
    }
  }
}

function Set-LockRow($Row) {
  # Zwei Hashes pro Eintrag: der des Downloads (gegen die Projekt-Angabe
  # geprüft) und der des Installierten. Bei Archiven sind das verschiedene
  # Dateien, ein einziger Hash kann beides nicht leisten.
  $keep = @(Get-LockRows | Where-Object { -not ($_.Id -eq $Row.Id -and $_.Os -eq $Row.Os -and $_.Arch -eq $Row.Arch) })
  $lines = @(
    '# AIOS host-forensics — Prüfsummen der installierten Werkzeuge',
    "# Spalten (Tabulator): id`tos`tarch`tversion`tartifact_sha256`tdigest_source`tinstalliert_am`tpfad`tinstalled_sha256",
    '#   artifact_sha256  = Hash der heruntergeladenen Datei (gegen die Projekt-Angabe geprüft)',
    '#   installed_sha256 = Hash dessen, was in tools\ liegt; bei Verzeichnissen ein Baum-Hash',
    '# Weicht ein erneuter Download ab, bricht fetch-tools.ps1 ab. Das ist Absicht.',
    '# Diese Datei gehört zum Arbeitsverzeichnis, nicht in das AIOS-Repository.'
  )
  foreach ($r in ($keep + @($Row))) {
    $lines += ("{0}`t{1}`t{2}`t{3}`t{4}`t{5}`t{6}`t{7}`t{8}" -f `
      $r.Id, $r.Os, $r.Arch, $r.Version, $r.ArtifactSha, $r.DigestSource, $r.InstalledAt, $r.Path, $r.InstalledSha)
  }
  [System.IO.File]::WriteAllText($LockPath, (($lines -join "`n") + "`n"), $Utf8NoBom)
}

# ─── Hashes ───────────────────────────────────────────────────────────────

function Get-Sha256([string]$Path) {
  try { (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant() } catch { '' }
}

# Baum-Hash für Regelsammlungen: die sortierte Liste der Datei-Hashes, ohne
# Namen. Dadurch reihenfolgeunabhängig; eine reine Umbenennung fällt nicht
# auf, was für eine Integritätsprüfung von Regeldateien genügt.
function Get-Sha256Tree([string]$Path) {
  $hashes = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue |
    ForEach-Object { Get-Sha256 $_.FullName } | Sort-Object)
  if ($hashes.Count -eq 0) { return '' }
  $joined = ($hashes -join "`n") + "`n"
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    ([System.BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($joined)))`
      -replace '-','').ToLowerInvariant()
  } finally { $sha.Dispose() }
}

# ─── Prüfsumme beschaffen ─────────────────────────────────────────────────

function Get-GithubAssetDigest([string]$Url) {
  # https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>
  if ($Url -notmatch '^https://github\.com/([^/]+)/([^/]+)/releases/download/([^/]+)/(.+)$') { return '' }
  $owner = $Matches[1]; $repo = $Matches[2]; $tag = $Matches[3]; $asset = $Matches[4]
  $api = "https://api.github.com/repos/$owner/$repo/releases/tags/$tag"
  try {
    $rel = Invoke-RestMethod -Uri $api -Headers @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'aios-host-forensics' } -TimeoutSec 60 -ErrorAction Stop
  } catch { return '' }
  foreach ($a in @($rel.assets)) {
    $name = try { [string]$a.name } catch { '' }
    if ($name -eq $asset) {
      $d = try { [string]$a.digest } catch { '' }
      if ($d -like 'sha256:*') { return $d.Substring(7).ToLowerInvariant() }
      return $d.ToLowerInvariant()
    }
  }
  return ''
}

function Get-ChecksumFromUrl([string]$Url, [string]$Asset) {
  try { $body = Invoke-RestMethod -Uri $Url -TimeoutSec 60 -ErrorAction Stop } catch { return '' }
  foreach ($line in (([string]$body) -split "`r?`n")) {
    if (-not $line.Trim()) { continue }
    if ($Asset -and ($line -notlike "*$Asset*") -and ($line -split '\s+').Count -gt 1) { continue }
    $m = [regex]::Match($line, '[0-9a-fA-F]{64}')
    if ($m.Success) { return $m.Value.ToLowerInvariant() }
  }
  return ''
}

# ─── Archiv-Sicherheit ────────────────────────────────────────────────────

# Archive können Einträge mit ".." oder absoluten Pfaden enthalten und damit
# aus dem Zielverzeichnis ausbrechen. Vorher prüfen, nicht hinterher.
function Test-ArchiveSafe([string]$ZipPath) {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
    $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
      foreach ($e in $zip.Entries) {
        $n = $e.FullName
        if ($n -match '^([A-Za-z]:)?[\\/]' -or $n -match '(^|[\\/])\.\.([\\/]|$)') { return $false }
      }
    } finally { $zip.Dispose() }
    return $true
  } catch { return $false }
}

# ─── Installation ─────────────────────────────────────────────────────────

function Install-Tool($Row) {
  if ($Row.Url -notlike 'https://*') { Write-Fail "$($Row.Id): nur https-Quellen erlaubt: $($Row.Url)"; return 1 }
  $asset = ($Row.Url -split '/')[-1]

  [Console]::Error.WriteLine('')
  [Console]::Error.WriteLine("  $($Row.Id) $($Row.Version) ($($Row.Os)/$($Row.Arch)) — $($Row.Purpose)")
  Write-Note "Quelle:  $($Row.Url)"
  Write-Note "Lizenz:  $($Row.License)"

  # 1. Erwartete Prüfsumme
  $expected = ''; $sourceLabel = ''
  switch -Wildcard ($Row.DigestSource) {
    'gh-api'   { $expected = Get-GithubAssetDigest $Row.Url; $sourceLabel = 'github-release-api' }
    'https://*'{ $expected = Get-ChecksumFromUrl $Row.DigestSource $asset; $sourceLabel = 'checksum-datei' }
    'none'     { $sourceLabel = 'keine-veroeffentlicht' }
    default    { Write-Fail "$($Row.Id): unbekannte digest_source '$($Row.DigestSource)'"; return 1 }
  }

  # 2. lock.tsv als Rückfall, wenn von aussen nichts kommt
  $locked = (Get-LockRows | Where-Object { $_.Id -eq $Row.Id -and $_.Os -eq $Row.Os -and $_.Arch -eq $Row.Arch } |
             Select-Object -First 1 -ExpandProperty ArtifactSha -ErrorAction SilentlyContinue)
  if (-not $expected -and $locked) {
    $expected = $locked
    $sourceLabel = 'lock.tsv (Trust-on-First-Use)'
    Write-Note 'Prüfsumme aus lock.tsv (Projekt veröffentlicht keine).'
  }

  if (-not $expected) {
    if (-not $AllowUnpinned) {
      Write-Fail "$($Row.Id): keine Prüfsumme verfügbar ($($Row.DigestSource)). Übersprungen."
      Write-Fail "      Mit -AllowUnpinned wird der erste Download in lock.tsv festgeschrieben."
      return 1
    }
    Write-Warn2 "$($Row.Id): ohne veröffentlichte Prüfsumme. Der Hash des Downloads wird in lock.tsv festgeschrieben."
  } else {
    Write-Note "Erwartet: $expected ($sourceLabel)"
  }

  # 3. Herunterladen (isoliertes Temp-Verzeichnis)
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('hf-fetch-' + [guid]::NewGuid().ToString('N').Substring(0,8))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $dl = Join-Path $tmp $asset
  try {
    # TLS 1.2 erzwingen: aeltere Windows-Installationen verhandeln sonst TLS 1.0.
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $Row.Url -OutFile $dl -UseBasicParsing -TimeoutSec 900 -ErrorAction Stop
  } catch {
    Write-Fail "$($Row.Id): Download fehlgeschlagen: $($_.Exception.Message)"
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return 1
  }

  # 4. Prüfen
  $actual = Get-Sha256 $dl
  if (-not $actual) {
    Write-Fail "$($Row.Id): Prüfsumme nicht berechenbar."
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return 1
  }
  if ($expected -and ($actual -ne $expected.ToLowerInvariant())) {
    Write-Fail ''
    Write-Fail "$($Row.Id): PRÜFSUMME WEICHT AB."
    Write-Fail "  erwartet: $expected  ($sourceLabel)"
    Write-Fail "  erhalten: $actual"
    Write-Fail ''
    if (-not $Force) {
      Write-Fail '  Abbruch. Das ist entweder eine neue Upstream-Version oder eine manipulierte Datei.'
      Write-Fail '  Prüfe die Release-Seite des Projekts. Erst wenn die Abweichung erklärt ist: -Force.'
      Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
      return 2
    }
    Write-Warn2 '  -Force gesetzt: wird akzeptiert und in lock.tsv überschrieben.'
  } else {
    Write-Note "Geprüft: $actual"
  }

  # 5. Ablegen
  $binDir   = Join-Path $ToolsDir 'bin'
  $shareDir = Join-Path $ToolsDir 'share'
  foreach ($d in @($binDir, $shareDir)) { if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }

  $installed = ''
  try {
    switch ($Row.Extract) {
      'none' {
        $installed = Join-Path $binDir $Row.Entry
        Copy-Item -LiteralPath $dl -Destination $installed -Force -ErrorAction Stop
      }
      'gz' {
        $installed = Join-Path $binDir $Row.Entry
        $in = [System.IO.File]::OpenRead($dl)
        try {
          $gz  = New-Object System.IO.Compression.GZipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
          $out = [System.IO.File]::Create($installed)
          try { $gz.CopyTo($out) } finally { $out.Dispose(); $gz.Dispose() }
        } finally { $in.Dispose() }
      }
      'zip' {
        if (-not (Test-ArchiveSafe $dl)) {
          Write-Fail "$($Row.Id): Archiv enthält Einträge mit '..' oder absolutem Pfad — nicht entpackt."
          Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
          return 1
        }
        $stage = Join-Path $tmp 'stage'
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        Expand-Archive -LiteralPath $dl -DestinationPath $stage -Force -ErrorAction Stop
        if ($Row.Entry -eq '*') {
          $installed = Join-Path $shareDir $Row.Id
          if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Recurse -Force }
          Copy-Item -LiteralPath $stage -Destination $installed -Recurse -Force -ErrorAction Stop
        } else {
          # Archive packen die Binary in unterschiedliche Unterverzeichnisse,
          # deshalb wird gesucht statt geraten.
          $leaf = Split-Path -Leaf $Row.Entry
          $found = Get-ChildItem -LiteralPath $stage -Recurse -File -Filter $leaf -ErrorAction SilentlyContinue |
                   Select-Object -First 1
          if (-not $found) {
            Write-Fail "$($Row.Id): '$($Row.Entry)' im Archiv nicht gefunden. Katalog-Eintrag veraltet?"
            Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
            return 1
          }
          $installed = Join-Path $binDir $leaf
          Copy-Item -LiteralPath $found.FullName -Destination $installed -Force -ErrorAction Stop
        }
      }
      'targz' {
        # tar.exe liegt seit Windows 10 1803 bei.
        if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
          Write-Fail "$($Row.Id): tar.exe fehlt — .tar.gz nicht entpackbar."
          Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
          return 1
        }
        $listing = & tar.exe -tzf $dl 2>$null
        foreach ($e in @($listing)) {
          if ($e -match '^([A-Za-z]:)?[\\/]' -or $e -match '(^|[\\/])\.\.([\\/]|$)') {
            Write-Fail "$($Row.Id): Archiv enthält Einträge mit '..' oder absolutem Pfad — nicht entpackt."
            Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
            return 1
          }
        }
        $stage = Join-Path $tmp 'stage'
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        & tar.exe -xzf $dl -C $stage 2>$null | Out-Null
        $leaf = Split-Path -Leaf $Row.Entry
        $found = Get-ChildItem -LiteralPath $stage -Recurse -File -Filter $leaf -ErrorAction SilentlyContinue |
                 Select-Object -First 1
        if (-not $found) {
          Write-Fail "$($Row.Id): '$($Row.Entry)' im Archiv nicht gefunden."
          Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
          return 1
        }
        $installed = Join-Path $binDir $leaf
        Copy-Item -LiteralPath $found.FullName -Destination $installed -Force -ErrorAction Stop
      }
      default {
        Write-Fail "$($Row.Id): unbekannter extract-Typ '$($Row.Extract)'"
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
        return 1
      }
    }
  } catch {
    Write-Fail "$($Row.Id): Installation fehlgeschlagen: $($_.Exception.Message)"
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    return 1
  }

  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

  if (-not (Test-Path -LiteralPath $installed)) {
    Write-Fail "$($Row.Id): Installation fehlgeschlagen (Ziel fehlt: $installed)"
    return 1
  }

  $installedSha = if (Test-Path -LiteralPath $installed -PathType Container) {
    $t = Get-Sha256Tree $installed
    'tree:' + $(if ($t) { $t } else { 'UNAVAILABLE' })
  } else {
    $h = Get-Sha256 $installed
    if ($h) { $h } else { 'UNAVAILABLE' }
  }

  $relPath = $installed.Substring($ToolsDir.Length).TrimStart('\','/')
  Set-LockRow ([pscustomobject]@{
    Id = $Row.Id; Os = $Row.Os; Arch = $Row.Arch; Version = $Row.Version
    ArtifactSha = $actual; DigestSource = $sourceLabel; InstalledAt = (Get-NowUtc)
    Path = $relPath; InstalledSha = $installedSha
  })
  [Console]::Error.WriteLine("  OK $($Row.Id) -> $installed")
  return 0
}

# ─── Aktionen ─────────────────────────────────────────────────────────────

if ($List) {
  $rows = @(Get-CatalogRows)
  $lock = @(Get-LockRows)
  Write-Output "Katalog: $catalog"
  Write-Output "Plattform: $targetOs/$targetArch · Zielverzeichnis: $ToolsDir"
  Write-Output ''
  Write-Output ('{0,-22} {1,-10} {2,-12} {3,-10} {4}' -f 'ID','VERSION','STATUS','PRUEFSUMME','ZWECK')
  Write-Output ('-' * 94)
  foreach ($r in $rows) {
    $isInstalled = @($lock | Where-Object { $_.Id -eq $r.Id -and $_.Os -eq $r.Os -and $_.Arch -eq $r.Arch }).Count -gt 0
    # Woher die Prüfsumme kommt, entscheidet, ob -AllowUnpinned nötig ist.
    $pin = switch -Wildcard ($r.DigestSource) {
      'gh-api'    { 'github' }
      'https://*' { 'datei' }
      'none'      { 'keine' }
      default     { '?' }
    }
    Write-Output ('{0,-22} {1,-10} {2,-12} {3,-10} {4}' -f `
      $r.Id, $r.Version, $(if ($isInstalled) { 'installiert' } else { 'fehlt' }), $pin, $r.Purpose)
  }
  Write-Output ''
  Write-Output 'Installieren: fetch-tools.ps1 -Install <id>[,<id>...]  oder  -Install all'
  Write-Output 'Lizenzen und Quellen: references/tools.md'
  exit 0
}

if (@($Install).Count -gt 0) {
  $rows = @(Get-CatalogRows)
  $wanted = if (@($Install) -contains 'all') { @($rows | Select-Object -ExpandProperty Id -Unique) } else { @($Install) }
  $rc = 0; $any = $false
  foreach ($id in $wanted) {
    if (-not $id) { continue }
    if ($id -notmatch '^[A-Za-z0-9._-]+$') { Write-Fail "Ungültiger Werkzeugname: $id"; $rc = 1; continue }
    $matched = @($rows | Where-Object { $_.Id -eq $id })
    if ($matched.Count -eq 0) {
      Write-Fail "$id`: kein Katalog-Eintrag für $targetOs/$targetArch. '-List' zeigt, was verfügbar ist."
      $rc = 1; continue
    }
    $any = $true
    foreach ($r in $matched) {
      $one = Install-Tool $r
      if ($one -gt $rc) { $rc = $one }
    }
  }
  if (-not $any) { Write-Fail 'Nichts installiert.'; exit 1 }
  [Console]::Error.WriteLine('')
  Write-Note "Prüfsummen: $LockPath"
  Write-Note 'Erneut prüfen: fetch-tools.ps1 -Verify'
  exit $rc
}

if ($Verify) {
  $lock = @(Get-LockRows)
  if ($lock.Count -eq 0) { Write-Fail "Keine lock.tsv in $ToolsDir — es ist nichts installiert."; exit 1 }
  $bad = 0
  foreach ($r in $lock) {
    $full = Join-Path $ToolsDir $r.Path
    if (-not (Test-Path -LiteralPath $full)) { Write-Fail "$($r.Id): Datei fehlt: $full"; $bad++; continue }
    if (-not $r.InstalledSha -or $r.InstalledSha -eq 'UNAVAILABLE') {
      Write-Warn2 "$($r.Id): kein installed_sha256 in lock.tsv (älterer Eintrag) — neu installieren, um ihn zu setzen."
      continue
    }
    $actual = if ($r.InstalledSha -like 'tree:*') { 'tree:' + (Get-Sha256Tree $full) } else { Get-Sha256 $full }
    if ($actual -ne $r.InstalledSha) {
      Write-Fail "$($r.Id): Hash des Installierten weicht ab."
      Write-Fail "   lock.tsv: $($r.InstalledSha)"
      Write-Fail "   Datei:    $actual"
      $bad++
    } else {
      [Console]::Error.WriteLine("  OK $($r.Id) $($r.Version)")
    }
  }
  [Console]::Error.WriteLine('')
  Write-Note ("{0} Einträge geprüft, {1} abweichend." -f $lock.Count, $bad)
  exit $(if ($bad -gt 0) { 1 } else { 0 })
}
