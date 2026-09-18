[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $WorktreePath,

	[Parameter(Mandatory = $true)]
	[string] $BaseCommit,

	[Parameter(Mandatory = $true)]
	[string] $BranchName,

	[Parameter(Mandatory = $true)]
	[string] $RunId,

	[switch] $ApprovalConfirmed
)

$ErrorActionPreference = 'Stop'
$mainRepository = 'E:\CodexProject\Talent-AI'
$allowedWorktreeRoot = 'C:\Users\XuperMan\.n8n\codex-worktrees\talent-ai'
$previewRootBase = 'C:\Users\XuperMan\.n8n-previews'

function Invoke-Git {
	param([string[]] $Arguments)

	$output = & git.exe @Arguments 2>&1
	if ($LASTEXITCODE -ne 0) {
		throw ($output -join [Environment]::NewLine)
	}
	return ($output -join [Environment]::NewLine).Trim()
}

function Get-ChangeHash {
	param([string] $RepositoryPath, [string] $StateDirectory)

	$untracked = Invoke-Git @('-C', $RepositoryPath, 'ls-files', '--others', '--exclude-standard')
	if ($untracked) { throw "Untracked files appeared after preview: $untracked" }
	$patchPath = Join-Path $StateDirectory 'promote.patch'
	& git.exe -C $RepositoryPath diff --binary --no-ext-diff HEAD --output=$patchPath
	if ($LASTEXITCODE -ne 0) { throw 'Failed to create the promotion patch' }
	return (Invoke-Git @('hash-object', $patchPath)).Trim()
}

if (-not $ApprovalConfirmed) { throw 'Human approval is required before promotion' }
if ($BranchName -notlike 'talent-ai/codex/*') { throw "Unexpected Codex branch: $BranchName" }

$resolvedWorktree = (Resolve-Path -LiteralPath $WorktreePath).Path.TrimEnd('\')
$resolvedRoot = (Resolve-Path -LiteralPath $allowedWorktreeRoot).Path.TrimEnd('\')
if (-not $resolvedWorktree.StartsWith($resolvedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
	throw "Worktree is outside the allowlisted root: $resolvedWorktree"
}

$actualBranch = Invoke-Git @('-C', $resolvedWorktree, 'branch', '--show-current')
if ($actualBranch -ne $BranchName) { throw "Branch mismatch: expected $BranchName, got $actualBranch" }
$actualBase = Invoke-Git @('-C', $resolvedWorktree, 'rev-parse', 'HEAD')
if ($actualBase -ne $BaseCommit) {
	& git.exe -C $mainRepository merge-base --is-ancestor $actualBase HEAD | Out-Null
	$alreadyMerged = $LASTEXITCODE -eq 0
	if ($alreadyMerged) {
		@{ status = 'already_merged'; branchName = $BranchName; commit = $actualBase } | ConvertTo-Json -Compress
		exit 0
	}
	throw "Worktree HEAD no longer matches the reviewed base commit"
}

$stateDirectory = Join-Path $previewRootBase (Split-Path $resolvedWorktree -Leaf)
$metadataPath = Join-Path $stateDirectory 'preview.json'
if (-not (Test-Path -LiteralPath $metadataPath)) { throw 'No successful human-preview build was found' }
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.status -ne 'ready') { throw "Preview is not ready; current status is $($metadata.status)" }
$currentHash = Get-ChangeHash -RepositoryPath $resolvedWorktree -StateDirectory $stateDirectory
if ($currentHash -ne $metadata.changeHash) { throw 'Worktree changes no longer match the version shown in the preview' }

$mainStatus = Invoke-Git @('-C', $mainRepository, 'status', '--porcelain')
if ($mainStatus) { throw "Main repository is not clean:`n$mainStatus" }
$mainHead = Invoke-Git @('-C', $mainRepository, 'rev-parse', 'HEAD')
if ($mainHead -ne $BaseCommit) {
	& git.exe -C $mainRepository merge-base --is-ancestor $BaseCommit $mainHead | Out-Null
	if ($LASTEXITCODE -ne 0) { throw 'Main HEAD is not a descendant of the reviewed base commit' }
	$mainSourceChanges = Invoke-Git @('-C', $mainRepository, 'diff', '--name-only', "$BaseCommit..$mainHead", '--', 'upstream/n8n')
	if ($mainSourceChanges) {
		throw "n8n source changed after the preview. Start a new Codex run and review that version.`n$mainSourceChanges"
	}
	$mainChangedText = Invoke-Git @('-C', $mainRepository, 'diff', '--name-only', "$BaseCommit..$mainHead")
	$worktreeChangedText = Invoke-Git @('-C', $resolvedWorktree, 'diff', '--name-only', 'HEAD')
	$mainChangedPaths = @($mainChangedText -split "`r?`n")
	$worktreeChangedPaths = @($worktreeChangedText -split "`r?`n")
	$overlap = @($worktreeChangedPaths | Where-Object { $_ -and $mainChangedPaths -contains $_ })
	if ($overlap.Count -gt 0) { throw "Main and worktree both changed: $($overlap -join ', ')" }
}

& (Join-Path $mainRepository 'scripts\stop-codex-worktree-preview.ps1') -WorktreePath $resolvedWorktree | Out-Null

Invoke-Git @('-C', $resolvedWorktree, 'add', '-A') | Out-Null
Invoke-Git @('-C', $resolvedWorktree, 'commit', '-m', "feat(codex): promote approved run $RunId") | Out-Null
$featureCommit = Invoke-Git @('-C', $resolvedWorktree, 'rev-parse', 'HEAD')
Invoke-Git @('-C', $mainRepository, 'merge', '--no-ff', $BranchName, '-m', "merge: approve Codex run $RunId") | Out-Null
$mergeCommit = Invoke-Git @('-C', $mainRepository, 'rev-parse', 'HEAD')

$worktreeI18nDist = Join-Path $resolvedWorktree 'upstream\n8n\packages\frontend\@n8n\i18n\dist'
$mainI18nDist = Join-Path $mainRepository 'upstream\n8n\packages\frontend\@n8n\i18n\dist'
$worktreeEditorDist = Join-Path $resolvedWorktree 'upstream\n8n\packages\frontend\editor-ui\dist'
$mainEditorDist = Join-Path $mainRepository 'upstream\n8n\packages\frontend\editor-ui\dist'
foreach ($pair in @(@($worktreeI18nDist, $mainI18nDist), @($worktreeEditorDist, $mainEditorDist))) {
	& robocopy.exe $pair[0] $pair[1] /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
	if ($LASTEXITCODE -ge 8) { throw "Merged source, but failed to copy reviewed build output from $($pair[0])" }
}

[ordered]@{
	status = 'merged'
	runId = $RunId
	branchName = $BranchName
	featureCommit = $featureCommit
	mergeCommit = $mergeCommit
	restartRequired = $true
} | ConvertTo-Json -Compress
