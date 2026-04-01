<#
.SYNOPSIS
    Parses Tabular Editor BPA console output to structured JSON.
.DESCRIPTION
    Reads BPA console output, extracts violations, enriches with rule metadata
    and fix templates, filters auto-generated date tables, and outputs JSON
    with violations and summary statistics.
.PARAMETER ConsoleOutputPath
    Path to the Tabular Editor console output text file.
.PARAMETER JsonPath
    Path where the JSON results will be saved.
.PARAMETER RulesPath
    Path to the BPA rules JSON file.
.PARAMETER ModelName
    Name of the Power BI model being analyzed.
.PARAMETER FixTemplatesPath
    Path to BPAFixTemplates.json for suggested fix messages.
#>
param(
    [string]$ConsoleOutputPath = ".\ci-tools\bpa-console-output.txt",
    [string]$JsonPath          = ".\ci-tools\bpa-results.json",
    [string]$RulesPath         = ".\ci-tools\BPARules-Custom.json",
    [string]$ModelName         = "Unknown",
    [string]$FixTemplatesPath  = ".\ci-tools\BPAFixTemplates.json"
)

# Never fail on violations — exit code is always 0 (violations are data, not errors)
$ErrorActionPreference = "Continue"

Write-Host "Parsing BPA console output..." -ForegroundColor Cyan

# Load BPA rules map
$rules   = Get-Content $RulesPath | ConvertFrom-Json
$ruleMap = @{}
$rules | ForEach-Object { $ruleMap[$_.Name] = $_ }

# Load fix templates map
$fixTemplateMap = @{}
if (Test-Path $FixTemplatesPath) {
    $fixTemplates = Get-Content $FixTemplatesPath | ConvertFrom-Json
    $fixTemplates | ForEach-Object { $fixTemplateMap[$_.ruleId] = $_ }
}

# Helpers
function Parse-ObjectName {
    param([string]$FullObjectName)
    if ($FullObjectName -match '^([^\[]+)\[([^\]]+)\]$') {
        return @{ table = $Matches[1].Trim(); object = $Matches[2].Trim() }
    }
    return @{ table = $FullObjectName.Trim(); object = '' }
}

function Get-FixSuggestion {
    param(
        [string]$RuleId,
        [string]$FullObjectName,
        [string]$TableName,
        [string]$ObjectName
    )
    $tpl = $fixTemplateMap[$RuleId]
    if (-not $tpl) {
        return @{ action = 'Manual review required'; steps = @('Review the violation in Tabular Editor') }
    }
    $tbl     = if ($TableName  -and $TableName.Trim())  { $TableName.Trim()  } else { $FullObjectName }
    $objName = if ($ObjectName -and $ObjectName.Trim()) { $ObjectName.Trim() } else { '' }

    $action = $tpl.template.Replace('{table}', $tbl).Replace('{object}', $objName)
    $steps  = @()
    if ($tpl.steps) {
        foreach ($s in $tpl.steps) {
            $steps += [string]$s.Replace('{table}', $tbl).Replace('{object}', $objName)
        }
    }
    $result = @{ action = $action; steps = $steps }
    if ($tpl.warning) { $result.warning = $tpl.warning }
    return $result
}

# Parse violations
$violations = @()
$autoDatePrefixes = @("LocalDateTable_", "DateTableTemplate_")

Get-Content $ConsoleOutputPath | ForEach-Object {
    $line = $_

    # Strip Azure DevOps logging prefix if present
    if ($line -match "^##vso\[task\.logissue[^\]]*\](.+)$") { $line = $Matches[1] }

    $objectType = $null; $tableName = $null; $objectName = $null
    $ruleName = $null; $fullObjectName = $null

    # Pattern 1: ObjectType 'Table'[Object] violates rule "RuleName"
    if ($line -match "^(\w+)\s+'([^']+)'\[([^\]]+)\]\s+violates rule\s+""(.+)""$") {
        $objectType     = $Matches[1]
        $tableName      = $Matches[2]
        $objectName     = $Matches[3]
        $ruleName       = $Matches[4]
        $fullObjectName = "$tableName[$objectName]"
    }
    # Pattern 2: ObjectType ObjectName violates rule "RuleName"
    elseif ($line -match "^(\w+)\s+([^\s]+)\s+violates rule\s+""(.+)""$") {
        $objectType     = $Matches[1]
        $fullObjectName = $Matches[2]
        $ruleName       = $Matches[3]
    }
    else { return }

    # Lookup rule metadata
    $rule = $ruleMap[$ruleName]
    if ($rule) {
        $ruleId      = $rule.ID
        $severity    = $rule.Severity
        $category    = $rule.Category
        $description = $rule.Description
    } else {
        $ruleId = "UNKNOWN"; $severity = 0; $category = "Unknown"; $description = ""
    }

    $parsed = Parse-ObjectName -FullObjectName $fullObjectName

    # Skip auto-generated Power BI date tables
    $isAutoDate = $autoDatePrefixes | Where-Object { $parsed.table -like "$_*" }
    if ($isAutoDate) { return }

    $violations += @{
        ruleId        = $ruleId
        ruleName      = $ruleName
        severity      = [int]$severity
        severityLabel = switch ([int]$severity) { 3{"ERROR"} 2{"WARNING"} 1{"INFO"} default{"UNKNOWN"} }
        category      = $category
        object        = $fullObjectName
        objectType    = $objectType
        description   = $description
        suggestedFix  = Get-FixSuggestion -RuleId $ruleId -FullObjectName $fullObjectName `
                            -TableName $parsed.table -ObjectName $parsed.object
    }
}

# Build summary statistics
$violationObjects = $violations | ForEach-Object { [PSCustomObject]$_ }

$bySeverity = $violationObjects | Group-Object severity | ForEach-Object {
    $label = switch ([int]$_.Name) { 3{"ERROR"} 2{"WARNING"} 1{"INFO"} default{"UNKNOWN"} }
    @{ severity = [int]$_.Name; label = $label; count = $_.Count }
} | Sort-Object severity -Descending

$byRule = $violationObjects | Group-Object ruleName | ForEach-Object {
    @{
        ruleName      = $_.Name
        ruleId        = $_.Group[0].ruleId
        severity      = $_.Group[0].severity
        severityLabel = $_.Group[0].severityLabel
        category      = $_.Group[0].category
        count         = $_.Count
    }
} | Sort-Object count -Descending

# Write JSON
@{
    timestamp       = Get-Date -Format "o"
    model           = $ModelName
    rulesFile       = "BPARules-Custom.json"
    totalViolations = $violations.Count
    summaryBySeverity = $bySeverity
    summaryByRule     = $byRule
    violations        = $violations
} | ConvertTo-Json -Depth 10 | Out-File $JsonPath -Encoding UTF8

# Console summary
Write-Host ""
Write-Host "Model           : $ModelName" -ForegroundColor White
Write-Host "Total violations: $($violations.Count)" -ForegroundColor $(if ($violations.Count -gt 0) {"Yellow"} else {"Green"})
$bySeverity | ForEach-Object {
    $color = switch ($_.severity) { 3{"Red"} 2{"Yellow"} 1{"Gray"} default{"White"} }
    Write-Host ("  {0,-10}: {1}" -f $_.label, $_.count) -ForegroundColor $color
}
Write-Host "Saved to: $JsonPath" -ForegroundColor Gray

# Violations are data, not errors — always exit 0
exit 0