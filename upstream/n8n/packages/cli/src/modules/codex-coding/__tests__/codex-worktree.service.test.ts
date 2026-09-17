import type { Logger } from '@n8n/backend-common';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { InstanceSettings } from 'n8n-core';
import { mockDeep } from 'vitest-mock-extended';

import { CodexCodingConfig } from '../codex-coding.config';
import { CodexWorktreeService } from '../codex-worktree.service';

describe('CodexWorktreeService', () => {
	let root: string;
	let repositoryPath: string;
	let service: CodexWorktreeService;

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), 'n8n-codex-worktree-'));
		repositoryPath = path.join(root, 'repository');
		execFileSync('git.exe', ['init', repositoryPath]);
		execFileSync('git.exe', ['-C', repositoryPath, 'config', 'user.email', 'test@example.com']);
		execFileSync('git.exe', ['-C', repositoryPath, 'config', 'user.name', 'Codex Test']);
		await writeFile(path.join(repositoryPath, 'README.md'), '# Test\n');
		execFileSync('git.exe', ['-C', repositoryPath, 'add', 'README.md']);
		execFileSync('git.exe', ['-C', repositoryPath, 'commit', '-m', 'baseline']);

		const config = new CodexCodingConfig();
		config.worktreesRoot = path.join(root, 'worktrees');
		config.repositories = [
			{
				id: 'test-repo',
				label: 'Test repository',
				path: repositoryPath,
				prepareSteps: [],
				verificationProfiles: { basic: [] },
			},
		];
		const instanceSettings = mockDeep<InstanceSettings>();
		Object.defineProperty(instanceSettings, 'n8nFolder', { value: path.join(root, 'n8n') });
		service = new CodexWorktreeService(config, instanceSettings, mockDeep<Logger>());
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('creates an isolated branch and keeps the main checkout unchanged', async () => {
		const initialBranch = execFileSync('git.exe', [
			'-C',
			repositoryPath,
			'branch',
			'--show-current',
		])
			.toString()
			.trim();

		const workspace = await service.prepare({
			repositoryId: 'test-repo',
			workflowExecutionId: 'execution-1',
			nodeId: 'node-1',
		});

		expect(workspace.branchName).toBe('talent-ai/codex/execution-1-node-1');
		expect(execFileSync('git.exe', ['-C', workspace.worktreePath, 'branch', '--show-current']).toString().trim()).toBe(
			workspace.branchName,
		);
		expect(execFileSync('git.exe', ['-C', repositoryPath, 'branch', '--show-current']).toString().trim()).toBe(
			initialBranch,
		);
		expect(execFileSync('git.exe', ['-C', repositoryPath, 'status', '--porcelain']).toString()).toBe('');
	});

	it('rejects a dirty allowlisted repository', async () => {
		await writeFile(path.join(repositoryPath, 'untracked.txt'), 'dirty');

		await expect(
			service.prepare({
				repositoryId: 'test-repo',
				workflowExecutionId: 'execution-2',
				nodeId: 'node-2',
			}),
		).rejects.toThrow('has uncommitted or untracked files');
	});

	it('includes new untracked files in the review artifact', async () => {
		const workspace = await service.prepare({
			repositoryId: 'test-repo',
			workflowExecutionId: 'execution-3',
			nodeId: 'node-3',
		});
		await writeFile(path.join(workspace.worktreePath, 'new-file.ts'), 'export const value = 1;\n');

		const result = await service.collectDiff(workspace.worktreePath, 'run-1', 'turn-1');

		expect(result.changedFiles).toContain('new-file.ts');
		expect(result.diffPreview).toContain('new-file.ts');
		expect(result.diffPreview).toContain('export const value = 1;');
	});

	it('rejects a configured command that leaves the worktree', async () => {
		await expect(
			service.runCommand({ file: 'git.exe', args: ['--version'], cwd: '..' }, repositoryPath, 1_000),
		).rejects.toThrow('leaves the worktree');
	});
});
