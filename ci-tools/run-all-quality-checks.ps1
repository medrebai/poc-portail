param(
    [string]$ModelPath     = ".\VORTEX - DATASET - HR VUE.SemanticModel\definition",
    [string]$ReportPath    = ".\VORTEX - DATASET - HR VUE.Report",
    [string]$OutputPath    = ".\ci-tools",
    [string]$InspectorPath = "C:\Tools\win-x64\CLI\PBIRInspectorCLI.exe"
)

$ErrorActionPreference = "Stop"
$sw = [System.Diagnostics.Stopwatch]::StartNew()

# ============================================
# Pipeline context (from Azure DevOps)
# ============================================
$pipelineRunId  = $env:BUILD_BUILDID
$pullRequestId  = $env:SYSTEM_PULLREQUEST_PULLREQUESTID
$branch         = $env:BUILD_SOURCEBRANCH
$projectId      = $env:PROJECT_NAME

# Fallback for local testing
if (-not $pipelineRunId) { $pipelineRunId = "local-$(Get-Date -Format 'yyyyMMdd-HHmmss')" }
if (-not $projectId)     { $projectId = "unknown" }

Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "   STARTING FULL QUALITY PIPELINE"         -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta
Write-Host "  Pipeline Run ID : $pipelineRunId"        -ForegroundColor DarkGray
Write-Host "  Pull Request ID : $pullRequestId"        -ForegroundColor DarkGray
Write-Host "  Branch          : $branch"               -ForegroundColor DarkGray
Write-Host "  Project ID      : $projectId"            -ForegroundColor DarkGray
Write-Host "==========================================" -ForegroundColor Magenta

# Check python availability for TMDL extraction
$pythonAvailable = $false
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd) {
    $pythonAvailable = $true
    Write-Host "Python : $($pythonCmd.Source)" -ForegroundColor DarkGray
} else {
    Write-Warning "Python not found in PATH - TMDL extraction will be skipped."
}

# Step 1: BPA
Write-Host "`n[1/5] Semantic Model Analysis (BPA)..." -ForegroundColor Cyan
try {
    & ".\ci-tools\run-bpa-analysis.ps1" `
        -ModelPath  $ModelPath `
        -OutputPath $OutputPath
    if ($LASTEXITCODE -notin @(0, 1)) {
        Write-Warning "BPA exited with unexpected code: $LASTEXITCODE"
    }
} catch {
    Write-Warning "BPA failed: $_"
}

# Step 2: PBI Inspector
Write-Host "`n[2/5] Visual Layer Analysis (PBI Inspector)..." -ForegroundColor Cyan
try {
    & ".\ci-tools\run-pbi-inspector.ps1" `
        -ReportPath    $ReportPath `
        -OutputPath    $OutputPath `
        -InspectorPath $InspectorPath
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "PBI Inspector exited with code: $LASTEXITCODE"
    }
} catch {
    Write-Warning "PBI Inspector failed: $_"
}

# Step 3: TMDL Extraction
Write-Host "`n[3/5] TMDL Extraction..." -ForegroundColor Cyan
if ($pythonAvailable) {
    try {
        python ".\ci-tools\parse-tmdl.py" `
            --model $ModelPath `
            --json  "$OutputPath\model-catalog.json"
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "TMDL extraction exited with code: $LASTEXITCODE"
        }
    } catch {
        Write-Warning "TMDL extraction failed: $_"
    }
} else {
    Write-Warning "[3/5] Skipped - Python not available."
}

# ============================================
# Step 4: Inject Pipeline Context into All Files
# ============================================
Write-Host "`n[4/5] Injecting pipeline context into artifacts..." -ForegroundColor Cyan

$bpaFile       = Join-Path $OutputPath "bpa-results.json"
$inspectorFile = Join-Path $OutputPath "pbi-inspector-results.json"
$catalogFile   = Join-Path $OutputPath "model-catalog.json"
$summaryFile   = Join-Path $OutputPath "quality-summary.json"

# Helper function to inject pipeline context into a JSON file
function Add-PipelineContext {
    param(
        [string]$FilePath,
        [string]$PipelineRunId,
        [string]$PullRequestId,
        [string]$ProjectId,
        [string]$Branch
    )
    
    if (-not (Test-Path $FilePath)) {
        Write-Warning "  [SKIP] File not found: $(Split-Path $FilePath -Leaf)"
        return $null
    }
    
    try {
        $data = Get-Content $FilePath -Raw -Encoding UTF8 | ConvertFrom-Json
        
        # Add pipeline context as top-level properties
        $data | Add-Member -NotePropertyName "pipelineRunId" -NotePropertyValue $PipelineRunId -Force
        $data | Add-Member -NotePropertyName "pullRequestId" -NotePropertyValue $PullRequestId -Force
        $data | Add-Member -NotePropertyName "projectId" -NotePropertyValue $ProjectId -Force
        $data | Add-Member -NotePropertyName "branch" -NotePropertyValue $Branch -Force
        
        # Write back to file (use -Depth 100 for deeply nested model-catalog)
        $data | ConvertTo-Json -Depth 100 | Out-File $FilePath -Encoding UTF8
        
        Write-Host "  [OK] $(Split-Path $FilePath -Leaf)" -ForegroundColor Green
        return $data
    } catch {
        Write-Warning "  [FAIL] Could not inject context into $(Split-Path $FilePath -Leaf): $_"
        return $null
    }
}

# Inject into bpa-results.json
$bpaData = Add-PipelineContext `
    -FilePath $bpaFile `
    -PipelineRunId $pipelineRunId `
    -PullRequestId $pullRequestId `
    -ProjectId $projectId `
    -Branch $branch

if (-not $bpaData) {
    $bpaData = [PSCustomObject]@{ 
        pipelineRunId   = $pipelineRunId
        pullRequestId   = $pullRequestId
        projectId       = $projectId
        branch          = $branch
        totalViolations = 0
        summaryBySeverity = @()
        summaryByRule   = @()
        violations      = @() 
    }
}

# Inject into pbi-inspector-results.json
$inspectorData = Add-PipelineContext `
    -FilePath $inspectorFile `
    -PipelineRunId $pipelineRunId `
    -PullRequestId $pullRequestId `
    -ProjectId $projectId `
    -Branch $branch

if (-not $inspectorData) {
    $inspectorData = [PSCustomObject]@{ 
        pipelineRunId = $pipelineRunId
        pullRequestId = $pullRequestId
        projectId     = $projectId
        branch        = $branch
        Results       = @() 
    }
}

# Inject into model-catalog.json
$catalogData = Add-PipelineContext `
    -FilePath $catalogFile `
    -PipelineRunId $pipelineRunId `
    -PullRequestId $pullRequestId `
    -ProjectId $projectId `
    -Branch $branch

if (-not $catalogData) {
    $catalogData = [PSCustomObject]@{
        pipelineRunId = $pipelineRunId
        pullRequestId = $pullRequestId
        projectId     = $projectId
        branch        = $branch
    }
}

# ============================================
# Step 5: Merge into quality-summary.json
# ============================================
Write-Host "`n[5/5] Merging results into quality-summary.json..." -ForegroundColor Cyan

$inspectorFailed = 0
$inspectorPassed = 0
if ($inspectorData.Results) {
    $inspectorFailed = ($inspectorData.Results | Where-Object { $_.Pass -eq $false }).Count
    $inspectorPassed = ($inspectorData.Results | Where-Object { $_.Pass -eq $true  }).Count
}

$bpaErrors   = 0
$bpaWarnings = 0
if ($bpaData.summaryBySeverity) {
    $errObj  = $bpaData.summaryBySeverity | Where-Object { $_.label -eq "ERROR" }
    $warnObj = $bpaData.summaryBySeverity | Where-Object { $_.label -eq "WARNING" }
    $bpaErrors   = if ($errObj)  { $errObj.count  } else { 0 }
    $bpaWarnings = if ($warnObj) { $warnObj.count } else { 0 }
}

@{
    # Pipeline context (top-level for easy access)
    pipelineRunId   = $pipelineRunId
    pullRequestId   = $pullRequestId
    projectId       = $projectId
    branch          = $branch
    timestamp       = Get-Date -Format "o"
    durationSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 2)
    
    # Summary stats (for PostgreSQL storage)
    summary = @{
        bpa = @{
            totalViolations = $bpaData.totalViolations
            errors          = $bpaErrors
            warnings        = $bpaWarnings
        }
        inspector = @{
            totalRules = ($inspectorFailed + $inspectorPassed)
            failed     = $inspectorFailed
            passed     = $inspectorPassed
        }
    }
    
    # Full embedded data (reference copy - individual files are source of truth)
    modelAnalysis  = $bpaData
    visualAnalysis = $inspectorData
    modelCatalog   = $catalogData
} | ConvertTo-Json -Depth 100 | Out-File $summaryFile -Encoding UTF8

$sw.Stop()

# ============================================
# Summary Output
# ============================================
Write-Host "`n==========================================" -ForegroundColor Magenta
Write-Host "   PIPELINE FINISHED in $($sw.Elapsed.ToString('mm\:ss'))" -ForegroundColor Magenta
Write-Host "==========================================" -ForegroundColor Magenta

$outputs = @("bpa-results.json", "pbi-inspector-results.json", "model-catalog.json", "quality-summary.json")
foreach ($file in $outputs) {
    $fullPath = Join-Path $OutputPath $file
    if (Test-Path $fullPath) {
        $size = [math]::Round((Get-Item $fullPath).Length / 1KB, 1)
        Write-Host "  [OK]      $file ($size KB)" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $file" -ForegroundColor Red
    }
}

Write-Host "`n  Pipeline Context Injected:" -ForegroundColor Cyan
Write-Host "    pipelineRunId : $pipelineRunId"
Write-Host "    pullRequestId : $pullRequestId"
Write-Host "    projectId     : $projectId"
Write-Host "    branch        : $branch"
Write-Host "==========================================" -ForegroundColor Magenta