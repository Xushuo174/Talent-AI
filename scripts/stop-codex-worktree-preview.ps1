[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $WorktreePath
)

$ErrorActionPreference = 'Stop'
$allowedWorktreeRoot = 'C:\Users\XuperMan\.n8n\codex-worktrees\talent-ai'
$previewRootBase = 'C:\Users\XuperMan\.n8n-previews'

$resolvedWorktree = (Resolve-Path -LiteralPath $WorktreePath).Path.TrimEnd('\')
$resolvedRoot = (Resolve-Path -LiteralPath $allowedWorktreeRoot).Path.TrimEnd('\')
if (-not $resolvedWorktree.StartsWith($resolvedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
	throw "Worktree is outside the allowlisted root: $resolvedWorktree"
}

$stateDirectory = Join-Path $previewRootBase (Split-Path $resolvedWorktree -Leaf)
$metadataPath = Join-Path $stateDirectory 'preview.json'
if (-not (Test-Path -LiteralPath $metadataPath)) {
	@{ status = 'not_running'; worktreePath = $resolvedWorktree } | ConvertTo-Json -Compress
	exit 0
}

$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
$processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($metadata.pid)" -ErrorAction SilentlyContinue
if ($processInfo) {
	$expectedFragment = (Join-Path $resolvedWorktree 'upstream\n8n\packages\cli\bin\n8n')
	if (-not $processInfo.CommandLine.Contains($expectedFragment, [System.StringComparison]::OrdinalIgnoreCase)) {
		throw "PID $($metadata.pid) is not the expected worktree preview process"
	}
	taskkill.exe /PID $metadata.pid /T /F | Out-Null
	if ($LASTEXITCODE -ne 0) { throw "Failed to stop preview PID $($metadata.pid)" }
}

$metadata.status = 'stopped'
$metadata | Add-Member -NotePropertyName stoppedAt -NotePropertyValue (Get-Date).ToString('o') -Force
$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8NoBOM
$metadata | ConvertTo-Json -Compress
