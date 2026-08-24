[CmdletBinding()]
param(
    [string] $OutputPath = "discloud-deploy.zip",
    [switch] $IncludeEnv,
    [switch] $RunChecks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$projectRootWithSeparator = "$projectRoot$([IO.Path]::DirectorySeparatorChar)"
$distPath = [IO.Path]::GetFullPath((Join-Path $projectRoot "dist"))
$expectedDistPath = [IO.Path]::GetFullPath((Join-Path $projectRoot "dist"))
$outputFullPath = if ([IO.Path]::IsPathRooted($OutputPath)) {
    [IO.Path]::GetFullPath($OutputPath)
} else {
    [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputPath))
}

if ($distPath -cne $expectedDistPath -or -not $distPath.StartsWith($projectRootWithSeparator)) {
    throw "Refusing to clean an unexpected build directory: $distPath"
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm is required. Install it or enable it with Corepack before running this script."
}

function Invoke-PnpmCommand {
    param([string[]] $Arguments)

    & pnpm @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

function Add-ZipFile {
    param(
        $Archive,
        [string] $SourcePath,
        [string] $EntryName
    )

    $entry = $Archive.CreateEntry($EntryName.Replace("\", "/"), [IO.Compression.CompressionLevel]::Optimal)
    $inputStream = [IO.File]::OpenRead($SourcePath)
    $entryStream = $entry.Open()
    try {
        $inputStream.CopyTo($entryStream)
    } finally {
        $entryStream.Dispose()
        $inputStream.Dispose()
    }
}

Push-Location $projectRoot
try {
    if (Test-Path -LiteralPath $distPath) {
        Remove-Item -LiteralPath $distPath -Recurse -Force
    }

    if ($RunChecks) {
        Invoke-PnpmCommand -Arguments @("check")
    } else {
        Invoke-PnpmCommand -Arguments @("build")
    }

    $requiredFiles = @(
        "package.json",
        "pnpm-lock.yaml",
        "discloud.config"
    )

    foreach ($relativePath in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $projectRoot $relativePath) -PathType Leaf)) {
            throw "Required deployment file is missing: $relativePath"
        }
    }

    $mainFile = Join-Path $distPath "index.js"
    if (-not (Test-Path -LiteralPath $mainFile -PathType Leaf)) {
        throw "The build did not create dist/index.js."
    }

    $filesToArchive = @(
        Get-ChildItem -LiteralPath $distPath -File -Recurse |
            Sort-Object FullName |
            ForEach-Object {
                if (-not $_.FullName.StartsWith($projectRootWithSeparator, [StringComparison]::OrdinalIgnoreCase)) {
                    throw "Build output is outside the project directory: $($_.FullName)"
                }
                [PSCustomObject]@{
                    Source = $_.FullName
                    Entry = $_.FullName.Substring($projectRootWithSeparator.Length)
                }
            }
    )

    foreach ($relativePath in $requiredFiles) {
        $filesToArchive += [PSCustomObject]@{
            Source = Join-Path $projectRoot $relativePath
            Entry = $relativePath
        }
    }

    if ($IncludeEnv) {
        $envPath = Join-Path $projectRoot ".env"
        if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
            throw "-IncludeEnv was specified, but .env does not exist."
        }

        $filesToArchive += [PSCustomObject]@{
            Source = $envPath
            Entry = ".env"
        }
    }

    $outputDirectory = Split-Path -Parent $outputFullPath
    if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $outputDirectory | Out-Null
    }

    $temporaryOutput = "$outputFullPath.$([Guid]::NewGuid().ToString('N')).tmp"
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fileStream = $null
    $archive = $null
    try {
        $fileStream = [IO.File]::Open($temporaryOutput, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite)
        $archive = [IO.Compression.ZipArchive]::new($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)

        foreach ($file in $filesToArchive) {
            Add-ZipFile -Archive $archive -SourcePath $file.Source -EntryName $file.Entry
        }
    } finally {
        if ($null -ne $archive) {
            $archive.Dispose()
        }
        if ($null -ne $fileStream) {
            $fileStream.Dispose()
        }
    }

    try {
        $verificationArchive = [IO.Compression.ZipFile]::OpenRead($temporaryOutput)
        try {
            $entryNames = @($verificationArchive.Entries | ForEach-Object FullName)
            foreach ($requiredEntry in @("dist/index.js", "package.json", "pnpm-lock.yaml", "discloud.config")) {
                if ($requiredEntry -notin $entryNames) {
                    throw "Archive verification failed: $requiredEntry is missing."
                }
            }

            if (-not $IncludeEnv -and ".env" -in $entryNames) {
                throw "Archive verification failed: .env was included unexpectedly."
            }
        } finally {
            $verificationArchive.Dispose()
        }

        if (Test-Path -LiteralPath $outputFullPath) {
            [IO.File]::Delete($outputFullPath)
        }
        [IO.File]::Move($temporaryOutput, $outputFullPath)
    } finally {
        if (Test-Path -LiteralPath $temporaryOutput) {
            [IO.File]::Delete($temporaryOutput)
        }
    }

    $archiveSize = (Get-Item -LiteralPath $outputFullPath).Length
    Write-Host "Created $outputFullPath ($archiveSize bytes)."
    Write-Host "Included .env: $([bool]$IncludeEnv)"
} finally {
    Pop-Location
}
