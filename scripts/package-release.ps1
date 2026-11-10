param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,
    [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$versionSource = Get-Content -LiteralPath (Join-Path $root "app/js/core/version.js") -Raw -Encoding UTF8
$versionPattern = 'export const APP_VERSION = "((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))";'
if ($versionSource -notmatch $versionPattern) {
    throw "Cannot read APP_VERSION from app/js/core/version.js"
}
if ($Tag -cnotmatch '^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$') {
    throw "Invalid release tag '$Tag'. Use vX.Y.Z or X.Y.Z, for example v1.2.3."
}
$version = $Matches[1]
# Stamp only the packaged copy; the source checkout remains unchanged.
$packagedVersionSource = [regex]::Replace($versionSource, $versionPattern, "export const APP_VERSION = `"$version`";")

# Only tracked runtime files are eligible, even when building from a developer's checkout.
$gitRoot = $root.Replace('\', '/')
$files = @(& git -c "safe.directory=$gitRoot" -C $root ls-files -- app/ lib/ server.js start.bat start-hidden.vbs create-shortcut.vbs)
if ($LASTEXITCODE -ne 0) { throw "git ls-files failed" }
foreach ($required in @("app/index.html", "app/js/package.json", "app/js/core/version.js", "lib/launcher.cjs", "server.js", "start.bat", "start-hidden.vbs", "create-shortcut.vbs")) {
    if ($files -cnotcontains $required) { throw "Missing required tracked file: $required" }
}

if (-not [IO.Path]::IsPathRooted($OutputDirectory)) {
    $OutputDirectory = Join-Path $root $OutputDirectory
}
[IO.Directory]::CreateDirectory($OutputDirectory) | Out-Null
$archivePath = Join-Path $OutputDirectory "TeamPlanner-v$version.zip"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
# CreateNew prevents accidental replacement of an existing local package.
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
try {
    $zip = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($file in $files) {
            if ($file -ceq "app/js/core/version.js") {
                $versionEntry = $zip.CreateEntry("TeamPlanner/$file")
                $versionWriter = New-Object IO.StreamWriter($versionEntry.Open(), (New-Object Text.UTF8Encoding($false)))
                try { $versionWriter.Write($packagedVersionSource) } finally { $versionWriter.Dispose() }
                continue
            }
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, (Join-Path $root $file), "TeamPlanner/$file", [IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
        $entry = $zip.CreateEntry("TeamPlanner/README.txt")
        $writer = New-Object IO.StreamWriter($entry.Open(), (New-Object Text.UTF8Encoding($true)))
        try {
            $writer.Write(@"
Team Planner $version — Windows

1. Распакуйте папку TeamPlanner из архива.
2. Установите Node.js LTS (не ниже 22.12.0): https://nodejs.org
3. Запустите start.bat. Устанавливать npm-пакеты не нужно.
4. Для завершения закройте все вкладки планировщика.

Данные и настройки создаются при первом запуске в data/ и settings/.
Перед обновлением экспортируйте все данные через меню приложения.
Закройте приложение и дождитесь остановки сервера. Распакуйте новую
версию в отдельную папку и перенесите data/ и settings/ из старой.
Папку runtime/ переносить не нужно. Запустите новый start.bat.

Справочник: https://github.com/yalosyash/team-planner/blob/main/docs/product/README.md
"@)
        } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
Write-Output $archivePath
