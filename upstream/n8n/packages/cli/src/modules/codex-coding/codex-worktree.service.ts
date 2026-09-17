import { Logger } from '@n8n/backend-common';
import { Service } from '@n8n/di';
import { spawn } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { InstanceSettings } from 'n8n-core';
import { OperationalError, UserError } from 'n8n-workflow';

import {
	CodexCodingConfig,
	type CodexCodingCommandConfig,
	type CodexCodingRepositoryConfig,
} from './codex-coding.config';

export interface CommandEvidence {
	[key: string]: string | number | boolean | null;
	exitCode: number | null;
	durationMs: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export interface PreparedCodexWorkspace {
	repository: CodexCodingRepositoryConfig;
	baseCommit: string;
	branchName: string;
	worktreePath: string;
}

function sanitizePart(value: string, maxLength = 48): string {
	return value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, maxLength);
}

function redact(value: string): string {
	return value
		.replace(/\b(sk-[a-zA-Z0-9_-]{12,})\b/g, '[REDACTED]')
		.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, '$1[REDACTED]')
		.replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s]+/gi, '$1[REDACTED]');
}

function boundedAppend(current: string, next: string, maxBytes: number): string {
	if (Buffer.byteLength(current) >= maxBytes) return current;
	const remaining = maxBytes - Buffer.byteLength(current);
	return current + Buffer.from(next).subarray(0, remaining).toString();
}

function isInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

@Service()
export class CodexWorktreeService {
	constructor(
		private readonly config: CodexCodingConfig,
		private readonly instanceSettings: InstanceSettings,
		private readonly logger: Logger,
	) {
		this.logger = this.logger.scoped('codex-coding');
	}

	listRepositories() {
		return this.config.repositories.map((repository) => ({
			id: repository.id,
			label: repository.label,
			verificationProfiles: Object.keys(repository.verificationProfiles).map((id) => ({
				id,
				label: id,
			})),
		}));
	}

	getRepository(repositoryId: string): CodexCodingRepositoryConfig {
		const repository = this.config.repositories.find((candidate) => candidate.id === repositoryId);
		if (!repository) throw new UserError(`Repository is not allowlisted: ${repositoryId}`);
		return repository;
	}

	getVerificationProfile(repository: CodexCodingRepositoryConfig, profileId: string) {
		const profile = repository.verificationProfiles[profileId];
		if (!profile) {
			throw new UserError(`Verification profile is not configured for this repository: ${profileId}`);
		}
		return profile;
	}

	async prepare(options: {
		repositoryId: string;
		workflowExecutionId: string;
		nodeId: string;
	}): Promise<PreparedCodexWorkspace> {
		const repository = this.getRepository(options.repositoryId);
		let repositoryPath: string;
		try {
			repositoryPath = await realpath(repository.path);
		} catch {
			throw new UserError(`Allowlisted repository does not exist: ${repository.label}`);
		}
		const gitDirectory = await this.runCommand(
			{ file: 'git.exe', args: ['rev-parse', '--git-dir'], cwd: '.' },
			repositoryPath,
			30_000,
		);
		if (gitDirectory.exitCode !== 0) throw new UserError(`${repository.label} is not a Git repository`);

		const status = await this.runCommand(
			{ file: 'git.exe', args: ['status', '--porcelain', '--untracked-files=all'], cwd: '.' },
			repositoryPath,
			30_000,
		);
		if (status.exitCode !== 0) throw new OperationalError(status.stderr || 'Failed to inspect Git status');
		if (status.stdout.trim()) {
			throw new UserError(
				`${repository.label} has uncommitted or untracked files. Commit or remove them before starting a Codex coding run.`,
			);
		}

		const head = await this.runCommand(
			{ file: 'git.exe', args: ['rev-parse', '--verify', 'HEAD'], cwd: '.' },
			repositoryPath,
			30_000,
		);
		const baseCommit = head.stdout.trim();
		if (head.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(baseCommit)) {
			throw new UserError(`${repository.label} has no valid HEAD commit`);
		}

		const suffix = `${sanitizePart(options.workflowExecutionId, 28)}-${sanitizePart(options.nodeId, 12)}`;
		const branchName = `talent-ai/codex/${suffix}`;
		const root = path.resolve(
			this.config.worktreesRoot || path.join(this.instanceSettings.n8nFolder, 'codex-worktrees'),
		);
		const worktreePath = path.join(root, sanitizePart(repository.id), suffix);
		await mkdir(path.dirname(worktreePath), { recursive: true });
		const create = await this.runCommand(
			{
				file: 'git.exe',
				args: ['worktree', 'add', '-b', branchName, worktreePath, baseCommit],
				cwd: '.',
			},
			repositoryPath,
			120_000,
		);
		if (create.exitCode !== 0) {
			throw new OperationalError(create.stderr || 'Failed to create the Codex worktree');
		}

		for (const step of repository.prepareSteps) {
			const result = await this.runCommand(step, worktreePath, this.config.maxTimeoutMs);
			if (result.exitCode !== 0) {
				throw new OperationalError(
					`Preparation step failed: ${step.id ?? step.file}\n${result.stderr || result.stdout}`,
				);
			}
		}

		return { repository, baseCommit, branchName, worktreePath };
	}

	async runVerification(
		repository: CodexCodingRepositoryConfig,
		profileId: string,
		worktreePath: string,
	) {
		const profile = this.getVerificationProfile(repository, profileId);
		const checks = [];
		for (const [index, command] of profile.entries()) {
			const evidence = await this.runCommand(command, worktreePath, this.config.maxTimeoutMs);
			checks.push({
				id: command.id ?? `${profileId}-${index + 1}`,
				kind: 'deterministic' as const,
				required: true as const,
				passed: evidence.exitCode === 0 && !evidence.timedOut,
				message:
					evidence.exitCode === 0 && !evidence.timedOut
						? `${command.id ?? command.file} passed`
						: `${command.id ?? command.file} failed with exit code ${evidence.exitCode ?? 'none'}`,
				evidence,
			});
		}
		return checks;
	}

	async collectDiff(worktreePath: string, runId: string, turnId: string) {
		const [trackedNames, untrackedNames, stat, diff] = await Promise.all([
			this.runCommand(
				{ file: 'git.exe', args: ['diff', '--name-only', '-z', 'HEAD'], cwd: '.' },
				worktreePath,
				30_000,
			),
			this.runCommand(
				{ file: 'git.exe', args: ['ls-files', '--others', '--exclude-standard', '-z'], cwd: '.' },
				worktreePath,
				30_000,
			),
			this.runCommand(
				{ file: 'git.exe', args: ['diff', '--stat', 'HEAD'], cwd: '.' },
				worktreePath,
				30_000,
			),
			this.runCommand(
				{ file: 'git.exe', args: ['diff', '--no-ext-diff', '--binary', 'HEAD'], cwd: '.' },
				worktreePath,
				60_000,
			),
		]);
		const untrackedFiles = untrackedNames.stdout.split('\0').filter(Boolean);
		let fullDiff = diff.stdout;
		let fullStat = stat.stdout;
		for (const relativePath of untrackedFiles) {
			const absolutePath = path.resolve(worktreePath, relativePath);
			if (!isInside(path.resolve(worktreePath), absolutePath)) {
				throw new UserError(`Git reported a file outside the worktree: ${relativePath}`);
			}
			const [newFileDiff, newFileStat] = await Promise.all([
				this.runCommand(
					{
						file: 'git.exe',
						args: ['diff', '--no-index', '--binary', '--', '/dev/null', relativePath],
						cwd: '.',
					},
					worktreePath,
					60_000,
				),
				this.runCommand(
					{
						file: 'git.exe',
						args: ['diff', '--no-index', '--stat', '--', '/dev/null', relativePath],
						cwd: '.',
					},
					worktreePath,
					30_000,
				),
			]);
			if (newFileDiff.exitCode !== 0 && newFileDiff.exitCode !== 1) {
				throw new OperationalError(
					newFileDiff.stderr || `Failed to collect the diff for ${relativePath}`,
				);
			}
			fullDiff = boundedAppend(fullDiff, newFileDiff.stdout, this.config.maxOutputBytes);
			fullStat = boundedAppend(fullStat, newFileStat.stdout, this.config.maxOutputBytes);
		}
		const changedFiles = [
			...trackedNames.stdout.split('\0').filter(Boolean),
			...untrackedFiles,
		].filter((file, index, files) => files.indexOf(file) === index);
		const artifactId = `${runId}-${sanitizePart(turnId, 48)}.diff`;
		const artifactRoot = path.join(this.instanceSettings.n8nFolder, 'codex-coding-artifacts');
		await mkdir(artifactRoot, { recursive: true });
		await writeFile(path.join(artifactRoot, artifactId), fullDiff, 'utf8');
		return {
			changedFiles,
			diffStat: fullStat.trim(),
			diffPreview: fullDiff.slice(0, 20_000),
			diffArtifactId: artifactId,
		};
	}

	artifactPath(artifactId: string): string {
		if (!/^[a-zA-Z0-9_.-]+\.diff$/.test(artifactId)) {
			throw new UserError('Invalid diff artifact id');
		}
		return path.join(this.instanceSettings.n8nFolder, 'codex-coding-artifacts', artifactId);
	}

	async runCommand(
		command: CodexCodingCommandConfig,
		workspacePath: string,
		timeoutMs: number,
	): Promise<CommandEvidence> {
		const cwd = path.resolve(workspacePath, command.cwd);
		if (!isInside(path.resolve(workspacePath), cwd)) {
			throw new UserError(`Command working directory leaves the worktree: ${command.cwd}`);
		}
		const startedAt = Date.now();
		return await new Promise<CommandEvidence>((resolve, reject) => {
			let stdout = '';
			let stderr = '';
			let timedOut = false;
			let settled = false;
			const child = spawn(command.file, command.args, {
				cwd,
				shell: false,
				windowsHide: true,
				env: process.env,
			});
			const timer = setTimeout(() => {
				timedOut = true;
				child.kill();
			}, timeoutMs);
			child.stdout.on('data', (chunk: Buffer) => {
				stdout = boundedAppend(stdout, chunk.toString(), this.config.maxOutputBytes);
			});
			child.stderr.on('data', (chunk: Buffer) => {
				stderr = boundedAppend(stderr, chunk.toString(), this.config.maxOutputBytes);
			});
			child.once('error', (error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(new OperationalError(`Failed to start ${command.file}: ${error.message}`));
			});
			child.once('exit', (exitCode) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve({
					exitCode,
					durationMs: Date.now() - startedAt,
					stdout: redact(stdout),
					stderr: redact(stderr),
					timedOut,
				});
			});
		});
	}
}
