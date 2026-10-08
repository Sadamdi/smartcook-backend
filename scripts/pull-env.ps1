# Copies the server's .env to this laptop so the laptop is a working backup.
#
#   .\scripts\pull-env.ps1
#
# The SERVER is the source of truth (it is what actually runs). The old local
# file is kept as .env.pre-sync.local (gitignored). Nothing is ever pushed to
# the server by this script. Needs the Paramiko helpers (SC_SSH_DIR, default
# %LOCALAPPDATA%\Temp\sc-ssh).
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sshDir = if ($env:SC_SSH_DIR) { $env:SC_SSH_DIR } else { Join-Path $env:LOCALAPPDATA 'Temp\sc-ssh' }
if (-not (Test-Path (Join-Path $sshDir 'sc_ssh.py'))) { throw "Helper Paramiko tidak ada di $sshDir" }

$cmd = New-TemporaryFile
[IO.File]::WriteAllText($cmd.FullName, 'cat /root/smartcook-backend/.env', [Text.UTF8Encoding]::new($false))
$raw = python (Join-Path $sshDir 'sc_ssh.py') $cmd.FullName
Remove-Item $cmd
$text = ($raw | Where-Object { $_ -notmatch '^__EXIT_STATUS__=' }) -join "`n"
$text = $text.TrimEnd() + "`n"

$vars = ([regex]::Matches($text, '(?m)^[A-Za-z_][A-Za-z0-9_]*=')).Count
if ($vars -lt 10 -or $text -notmatch '(?m)^MONGODB_URI=' -or $text -notmatch '(?m)^JWT_SECRET=') {
    throw "Hasil dari server tidak terlihat seperti .env yang utuh ($vars variabel). Tidak ada yang ditimpa."
}

$target = Join-Path $root '.env'
if (Test-Path $target) {
    $same = (Get-FileHash $target).Hash -eq ([BitConverter]::ToString(
        [Security.Cryptography.SHA256]::Create().ComputeHash([Text.UTF8Encoding]::new($false).GetBytes($text))
    ) -replace '-', '')
    if ($same) { Write-Host ".env sudah identik dengan server ($vars variabel)."; return }
    Copy-Item $target (Join-Path $root '.env.pre-sync.local') -Force
}
[IO.File]::WriteAllText($target, $text, [Text.UTF8Encoding]::new($false))
Write-Host ".env diperbarui dari server ($vars variabel). Versi lama: .env.pre-sync.local"
