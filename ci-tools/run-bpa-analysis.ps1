param(
    [string]$ModelPath         = ".\VORTEX - DATASET - HR VUE.SemanticModel\definition",
    [string]$BpaRulesPath      = ".\ci-tools\BPARules-Custom.json",
    [string]$OutputPath        = ".\ci-tools",
    [string]$TabularEditorPath = $null
)

# Never Stop on external tool exit codes — we handle them manually
$ErrorActionPreference = "Continue"

# Resolve Tabular Editor path
if ([string]::IsNullOrEmpty($TabularEditorPath)) {
    $TabularEditorPath = $env:TABULAR_EDITOR_PATH
}
if ([string]::IsNullOrEmpty($TabularEditorPath) -or -not (Test-Path $TabularEditorPath)) {
    $commonPaths = @(
        "C:\Program Files (x86)\Tabular Editor\TabularEditor.exe",
        "C:\Program Files\Tabular Editor\TabularEditor.exe"
    )
    foreach ($p in $commonPaths) {
        if (Test-Path $p) { $TabularEditorPath = $p; break }
    }
}

# Validate inputs — these ARE real errors
if ([string]::IsNullOrEmpty($TabularEditorPath) -or -not (Test-Path $TabularEditorPath)) {
    Write-Error "Tabular Editor not found. Set TABULAR_EDITOR_PATH env var."
    exit 2
}
if (-not (Test-Path $BpaRulesPath)) {
    Write-Error "BPA rules file not found: $BpaRulesPath"
    exit 2
}
if (-not (Test-Path $ModelPath)) {
    Write-Error "Model path not found: $ModelPath"
    exit 2
}

$modelFullPath = (Resolve-Path $ModelPath).Path

# Extract model name
$modelName = "Unknown"
if ($ModelPath -match "([^\\\/]+)\.SemanticModel") { $modelName = $Matches[1] }

$consoleOutput = Join-Path $OutputPath "bpa-console-output.txt"
$jsonOutput    = Join-Path $OutputPath "bpa-results.json"
$parserScript  = Join-Path $OutputPath "parse-bpa-to-json.ps1"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host " Tabular Editor BPA Analysis" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Model : $modelFullPath" -ForegroundColor Gray
Write-Host "Rules : $BpaRulesPath" -ForegroundColor Gray

# Step 1: Run BPA
Write-Host "`n[1/2] Running BPA..." -ForegroundColor Yellow
& $TabularEditorPath $modelFullPath -A $BpaRulesPath -V 2>&1 | Out-File $consoleOutput -Encoding UTF8

$exitCode = $LASTEXITCODE
if ($exitCode -eq 0) {
    Write-Host "      BPA completed - no violations" -ForegroundColor Green
} elseif ($exitCode -eq 1) {
    Write-Host "      BPA completed - violations found (exit 1 is expected)" -ForegroundColor Yellow
} else {
    # Real crash — code 2+ means Tabular Editor failed to run
    Write-Error "Tabular Editor crashed with unexpected exit code: $exitCode"
    exit 2
}

# Step 2: Parse to JSON
Write-Host "[2/2] Parsing to JSON..." -ForegroundColor Yellow
if (-not (Test-Path $parserScript)) {
    Write-Error "Parser script not found: $parserScript"
    exit 2
}
& $parserScript `
    -ConsoleOutputPath $consoleOutput `
    -JsonPath          $jsonOutput `
    -RulesPath         $BpaRulesPath `
    -ModelName         $modelName

if ($LASTEXITCODE -ne 0) {
    Write-Error "parse-bpa-to-json.ps1 failed with exit code: $LASTEXITCODE"
    exit 2
}

# Cleanup temp file
if (Test-Path $consoleOutput) { Remove-Item $consoleOutput -Force }

Write-Host "BPA results saved to: $jsonOutput" -ForegroundColor Green
exit 0