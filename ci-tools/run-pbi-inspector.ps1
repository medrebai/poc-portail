param(
    [string]$ReportPath    = ".\VORTEX - DATASET - HR VUE.Report",
    [string]$RulesPath     = ".\ci-tools\pbi-inspector-rules.json",
    [string]$OutputPath    = ".\ci-tools",
    [string]$InspectorPath = "C:\Tools\win-x64\CLI\PBIRInspectorCLI.exe"
)

# Never Stop on external tool exit codes — we handle them manually
$ErrorActionPreference = "Continue"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host " PBI Inspector Analysis (Visuals)" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# Validate inputs — these ARE real errors
if (-not (Test-Path $InspectorPath)) {
    Write-Error "PBI Inspector CLI not found: $InspectorPath"
    exit 2
}
if (-not (Test-Path $ReportPath)) {
    Write-Error "Report folder not found: $ReportPath"
    exit 2
}

Write-Host "Report : $ReportPath" -ForegroundColor Gray
Write-Host "Rules  : $RulesPath" -ForegroundColor Gray

$finalJsonPath = Join-Path $OutputPath "pbi-inspector-results.json"
if (Test-Path $finalJsonPath) { Remove-Item $finalJsonPath -Force }

# Run CLI
$cliOutput = & $InspectorPath `
    -fabricitem $ReportPath `
    -rules      $RulesPath `
    -formats    "JSON" `
    -output     $OutputPath `
    -verbose    true 2>&1

$exitCode = $LASTEXITCODE
if ($exitCode -notin @(0, 1)) {
    # Real crash — not a rules failure
    Write-Error "PBI Inspector crashed with unexpected exit code: $exitCode"
    Write-Error "CLI output: $cliOutput"
    exit 2
}
Write-Host "PBI Inspector completed (exit $exitCode)" -ForegroundColor Gray

# Wait for output file (max 15s)
$generatedFile = $null
$timeout = 15
$elapsed = 0
while ($elapsed -lt $timeout) {
    $generatedFile = Get-ChildItem -Path $OutputPath -Filter "TestRun_*.json" |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($generatedFile) { break }
    Start-Sleep -Milliseconds 500
    $elapsed += 0.5
}

if (-not $generatedFile) {
    Write-Error "PBI Inspector did not generate a JSON file within $timeout seconds."
    exit 2
}

Write-Host "Raw output: $($generatedFile.Name)" -ForegroundColor Gray

# Parse, strip noisy fields, pretty-print
try {
    $rawContent = Get-Content $generatedFile.FullName -Raw -Encoding UTF8
    $jsonObj    = $rawContent | ConvertFrom-Json

    $jsonObj.Results | ForEach-Object {
        $_.PSObject.Properties.Remove('Message')
        $_.PSObject.Properties.Remove('RuleItemType')
    }

    $jsonObj | ConvertTo-Json -Depth 10 | Out-File $finalJsonPath -Encoding UTF8 -Force
    Write-Host "JSON cleaned and saved." -ForegroundColor Green
} catch {
    Write-Warning "JSON formatting failed: $_ - saving raw file as fallback"
    Move-Item $generatedFile.FullName $finalJsonPath -Force
} finally {
    if (Test-Path $generatedFile.FullName) { Remove-Item $generatedFile.FullName -Force }
}

# Summary
$results = (Get-Content $finalJsonPath | ConvertFrom-Json).Results
$failed  = ($results | Where-Object { $_.Pass -eq $false }).Count
$passed  = ($results | Where-Object { $_.Pass -eq $true  }).Count

Write-Host "Results  : $($results.Count) rules - $passed passed / $failed failed" -ForegroundColor $(if ($failed -gt 0) { "Yellow" } else { "Green" })
Write-Host "Saved to : $finalJsonPath" -ForegroundColor Gray
Write-Host "======================================" -ForegroundColor Cyan
exit 0