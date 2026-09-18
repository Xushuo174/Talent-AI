[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)]
	[string] $WorktreePath,

	[int] $Port = 5680,

	[int] $RunnerPort = 5681,

	[string] $ProjectId = 'szye68Ld7LyS6fIe'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$mainRepository = 'E:\CodexProject\Talent-AI'
$allowedWorktreeRoot = 'C:\Users\XuperMan\.n8n\codex-worktrees\talent-ai'
$previewRootBase = 'C:\Users\XuperMan\.n8n-previews'
$mainN8nRoot = Join-Path $mainRepository 'upstream\n8n'
$sourceDatabase = 'C:\Users\XuperMan\.n8n\database.sqlite'
$sourceConfig = 'C:\Users\XuperMan\.n8n\config'
$pnpmScript = Join-Path $env:APPDATA 'npm\node_modules\pnpm\bin\pnpm.mjs'

function Resolve-ContainedPath {
	param([string] $Path, [string] $Root)

	$resolvedPath = (Resolve-Path -LiteralPath $Path).Path.TrimEnd('\')
	$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path.TrimEnd('\')
	if (-not $resolvedPath.StartsWith($resolvedRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
		throw "Worktree is outside the allowlisted root: $resolvedPath"
	}
	return $resolvedPath
}

function Assert-PortFree {
	param([int] $PortNumber)

	if (Get-NetTCPConnection -LocalPort $PortNumber -State Listen -ErrorAction SilentlyContinue) {
		throw "Port $PortNumber is already in use"
	}
}

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
	if ($untracked) {
		throw "Preview currently accepts tracked-file changes only. Untracked files: $untracked"
	}

	$patchPath = Join-Path $StateDirectory 'reviewed.patch'
	& git.exe -C $RepositoryPath diff --binary --no-ext-diff HEAD --output=$patchPath
	if ($LASTEXITCODE -ne 0) { throw 'Failed to create the review patch' }
	return (Invoke-Git @('hash-object', $patchPath)).Trim()
}

function Sync-BaselineBuilds {
	param([string] $DestinationN8nRoot, [string] $BaseCommit, [string] $StateDirectory)

	$markerPath = Join-Path $StateDirectory 'baseline-dist.txt'
	if ((Test-Path -LiteralPath $markerPath) -and
		((Get-Content -LiteralPath $markerPath -Raw).Trim() -eq $BaseCommit) -and
		(Test-Path -LiteralPath (Join-Path $DestinationN8nRoot 'packages\workflow\dist'))) {
		return
	}

	$packageFiles = & git.exe -C $mainN8nRoot ls-files '**/package.json'
	if ($LASTEXITCODE -ne 0) { throw 'Failed to enumerate built n8n packages' }
	foreach ($packageFile in $packageFiles) {
		$relativePackage = Split-Path $packageFile -Parent
		$sourceDist = Join-Path (Join-Path $mainN8nRoot $relativePackage) 'dist'
		if (-not (Test-Path -LiteralPath $sourceDist)) { continue }

		$targetDist = Join-Path (Join-Path $DestinationN8nRoot $relativePackage) 'dist'
		New-Item -ItemType Directory -Force -Path $targetDist | Out-Null
		& robocopy.exe $sourceDist $targetDist /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
		if ($LASTEXITCODE -ge 8) {
			throw "Failed to sync baseline build output for $relativePackage"
		}
	}

	Set-Content -LiteralPath $markerPath -Value $BaseCommit -Encoding utf8NoBOM
}

function Sync-NativeRuntime {
	param([string] $DestinationN8nRoot)

	$sourceBuild = Join-Path $mainN8nRoot 'packages\cli\node_modules\sqlite3\build'
	$targetBuild = Join-Path $DestinationN8nRoot 'packages\cli\node_modules\sqlite3\build'
	if (-not (Test-Path -LiteralPath (Join-Path $sourceBuild 'Release\node_sqlite3.node'))) {
		throw 'The main n8n checkout does not contain the SQLite native runtime'
	}
	New-Item -ItemType Directory -Force -Path $targetBuild | Out-Null
	& robocopy.exe $sourceBuild $targetBuild /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
	if ($LASTEXITCODE -ge 8) { throw 'Failed to sync the SQLite native runtime' }
}

$resolvedWorktree = Resolve-ContainedPath -Path $WorktreePath -Root $allowedWorktreeRoot
$worktreeN8nRoot = Join-Path $resolvedWorktree 'upstream\n8n'
if (-not (Test-Path -LiteralPath (Join-Path $worktreeN8nRoot 'packages\cli\bin\n8n'))) {
	throw 'The selected worktree does not contain the n8n CLI'
}
if (-not (Test-Path -LiteralPath $pnpmScript)) { throw "pnpm runtime was not found: $pnpmScript" }
if (-not (Test-Path -LiteralPath $sourceDatabase)) { throw "Main n8n database was not found: $sourceDatabase" }
if (-not (Test-Path -LiteralPath $sourceConfig)) { throw "Main n8n config was not found: $sourceConfig" }

$worktreeName = Split-Path $resolvedWorktree -Leaf
$stateDirectory = Join-Path $previewRootBase $worktreeName
$previewUserRoot = Join-Path $stateDirectory 'user'
$previewN8nUserDirectory = Join-Path $previewUserRoot '.n8n'
$metadataPath = Join-Path $stateDirectory 'preview.json'
$buildLog = Join-Path $stateDirectory 'build.log'
$stdoutLog = Join-Path $stateDirectory 'n8n.stdout.log'
$stderrLog = Join-Path $stateDirectory 'n8n.stderr.log'
New-Item -ItemType Directory -Force -Path $previewN8nUserDirectory | Out-Null

if (Test-Path -LiteralPath $metadataPath) {
	$existing = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
	$existingProcess = Get-Process -Id $existing.pid -ErrorAction SilentlyContinue
	if ($existingProcess) {
		try {
			Invoke-WebRequest -UseBasicParsing -Uri $existing.healthUrl -TimeoutSec 3 | Out-Null
			$existing | ConvertTo-Json -Compress
			exit 0
		} catch {
			throw "A preview process is still running but is not healthy (PID $($existing.pid))"
		}
	}
}

Assert-PortFree -PortNumber $Port
Assert-PortFree -PortNumber $RunnerPort

$baseCommit = (Invoke-Git @('-C', $resolvedWorktree, 'rev-parse', 'HEAD')).Trim()
$mainCommit = (Invoke-Git @('-C', $mainRepository, 'rev-parse', 'HEAD')).Trim()
if ($mainCommit -ne $baseCommit) {
	& git.exe -C $mainRepository merge-base --is-ancestor $baseCommit $mainCommit | Out-Null
	if ($LASTEXITCODE -ne 0) {
		throw "Main HEAD is not a descendant of the worktree base"
	}
	$mainSourceChanges = Invoke-Git @('-C', $mainRepository, 'diff', '--name-only', "$baseCommit..$mainCommit", '--', 'upstream/n8n')
	if ($mainSourceChanges) {
		throw "n8n source changed after this worktree was created. Start a new Codex run before previewing it.`n$mainSourceChanges"
	}
}

$status = Invoke-Git @('-C', $resolvedWorktree, 'status', '--porcelain')
if (-not $status) { throw 'The worktree has no source changes to preview' }

$changeHash = Get-ChangeHash -RepositoryPath $resolvedWorktree -StateDirectory $stateDirectory
Sync-BaselineBuilds -DestinationN8nRoot $worktreeN8nRoot -BaseCommit $baseCommit -StateDirectory $stateDirectory
Sync-NativeRuntime -DestinationN8nRoot $worktreeN8nRoot

$buildMarker = Join-Path $stateDirectory 'preview-build-hash.txt'
$hasReviewedBuild = (Test-Path -LiteralPath $buildMarker) -and
	((Get-Content -LiteralPath $buildMarker -Raw).Trim() -eq $changeHash) -and
	(Test-Path -LiteralPath (Join-Path $worktreeN8nRoot 'packages\frontend\editor-ui\dist\index.html'))
if (-not $hasReviewedBuild) {
	Remove-Item -LiteralPath $buildLog -Force -ErrorAction SilentlyContinue
	Push-Location $worktreeN8nRoot
	try {
		& node.exe $pnpmScript --filter '@n8n/i18n' build *>> $buildLog
		if ($LASTEXITCODE -ne 0) { throw "@n8n/i18n build failed. See $buildLog" }
		& node.exe $pnpmScript --filter 'n8n-editor-ui' build *>> $buildLog
		if ($LASTEXITCODE -ne 0) { throw "n8n-editor-ui build failed. See $buildLog" }
	} finally {
		Pop-Location
	}
	Set-Content -LiteralPath $buildMarker -Value $changeHash -Encoding utf8NoBOM
}

Copy-Item -LiteralPath $sourceConfig -Destination (Join-Path $previewN8nUserDirectory 'config') -Force
$previewDatabase = Join-Path $previewN8nUserDirectory 'database.sqlite'
Remove-Item -LiteralPath $previewDatabase -Force -ErrorAction SilentlyContinue
$backupScript = Join-Path $stateDirectory 'backup_database.py'
@'
import sqlite3
import sys

source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
try:
    source.backup(target)
    table = target.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='workflow_entity'"
    ).fetchone()
    if table:
        target.execute("UPDATE workflow_entity SET active = 0")
        target.commit()
finally:
    target.close()
    source.close()
'@ | Set-Content -LiteralPath $backupScript -Encoding utf8NoBOM
& python.exe $backupScript $sourceDatabase $previewDatabase
if ($LASTEXITCODE -ne 0) { throw 'Failed to create the isolated preview database' }

$env:N8N_PORT = [string] $Port
$env:N8N_RUNNERS_BROKER_PORT = [string] $RunnerPort
$env:N8N_USER_FOLDER = $previewUserRoot
$env:N8N_SECURE_COOKIE = 'false'
$env:N8N_DIAGNOSTICS_ENABLED = 'false'
$env:N8N_VERSION_NOTIFICATIONS_ENABLED = 'false'
$env:N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS = 'false'
$env:WEBHOOK_URL = "http://localhost:$Port/"
$env:N8N_EDITOR_BASE_URL = "http://localhost:$Port/"

Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
$n8nEntry = Join-Path $worktreeN8nRoot 'packages\cli\bin\n8n'
$process = Start-Process -FilePath 'node.exe' -ArgumentList @($n8nEntry) -WorkingDirectory $worktreeN8nRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru

$healthUrl = "http://localhost:$Port/healthz"
$deadline = (Get-Date).AddSeconds(90)
$healthy = $false
while ((Get-Date) -lt $deadline) {
	if ($process.HasExited) { break }
	try {
		$response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
		if ($response.StatusCode -eq 200) {
			$healthy = $true
			break
		}
	} catch {
		Start-Sleep -Milliseconds 750
	}
}

if (-not $healthy) {
	if (-not $process.HasExited) { taskkill.exe /PID $process.Id /T /F | Out-Null }
	$tail = if (Test-Path -LiteralPath $stderrLog) { (Get-Content -LiteralPath $stderrLog -Tail 30) -join [Environment]::NewLine } else { '' }
	throw "Preview n8n did not become healthy. See $stderrLog`n$tail"
}

$previewPath = if ($ProjectId) { "http://localhost:$Port/codex-runs/$ProjectId" } else { "http://localhost:$Port/" }
$metadata = [ordered]@{
	status = 'ready'
	pid = $process.Id
	previewUrl = $previewPath
	healthUrl = $healthUrl
	port = $Port
	runnerPort = $RunnerPort
	worktreePath = $resolvedWorktree
	baseCommit = $baseCommit
	changeHash = $changeHash
	buildLog = $buildLog
	stdoutLog = $stdoutLog
	stderrLog = $stderrLog
	startedAt = (Get-Date).ToString('o')
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8NoBOM
$metadata | ConvertTo-Json -Compress
