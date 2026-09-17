import { Logger } from '@n8n/backend-common';
import { Service } from '@n8n/di';
import { randomUUID } from 'node:crypto';
import type {
	CodexCodingInvocationContext,
	CodexCodingRequestV1,
	CodexCodingResultV1,
	CodexCodingStatus,
} from 'n8n-workflow';
import { OperationalError, UserError } from 'n8n-workflow';

import { CodexAppServerService } from './codex-app-server.service';
import { CodexCodingConfig } from './codex-coding.config';
import { CodexWorktreeService } from './codex-worktree.service';
import { CodexCodingRunRepository } from './database/codex-coding-run.repository';
import { CodexCodingTurnRepository } from './database/codex-coding-turn.repository';

function failureStatus(error: unknown): CodexCodingStatus {
	const message = error instanceof Error ? error.message.toLowerCase() : '';
	if (message.includes('timed out')) return 'timed_out';
	if (message.includes('cancelled') || message.includes('canceled')) return 'cancelled';
	if (
		message.includes('approval') ||
		message.includes('permission') ||
		message.includes('policy') ||
		message.includes('sandbox') ||
		message.includes('network access')
	) {
		return 'policy_blocked';
	}
	return 'runtime_failed';
}

function failureCode(status: CodexCodingStatus): string {
	return status.toUpperCase();
}

class SerialExecutor {
	private active = 0;

	private readonly queue: Array<() => void> = [];

	constructor(private readonly limit: number) {}

	async run<T>(task: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await task();
		} finally {
			this.release();
		}
	}

	private async acquire(): Promise<void> {
		if (this.active < this.limit) {
			this.active++;
			return;
		}
		await new Promise<void>((resolve) => this.queue.push(resolve));
		this.active++;
	}

	private release(): void {
		this.active--;
		this.queue.shift()?.();
	}
}

@Service()
export class CodexCodingService {
	private readonly executor: SerialExecutor;

	constructor(
		private readonly config: CodexCodingConfig,
		private readonly appServer: CodexAppServerService,
		private readonly worktrees: CodexWorktreeService,
		private readonly runs: CodexCodingRunRepository,
		private readonly turns: CodexCodingTurnRepository,
		private readonly logger: Logger,
	) {
		this.logger = this.logger.scoped('codex-coding');
		this.executor = new SerialExecutor(Math.max(1, this.config.maxConcurrency));
	}

	async listRepositories() {
		return this.worktrees.listRepositories();
	}

	async health() {
		return await this.appServer.health();
	}

	async getDiffPath(runId: string, artifactId: string, projectId: string) {
		const run = await this.runs.findByIdAndProject(runId, projectId);
		if (!run) return undefined;
		const turn = await this.turns.findArtifact(runId, artifactId);
		return turn ? this.worktrees.artifactPath(artifactId) : undefined;
	}

	async execute(request: CodexCodingRequestV1, invocation: CodexCodingInvocationContext) {
		if (request.version !== 1) throw new UserError('Unsupported Codex Coding request version');
		if (!request.task.trim()) throw new UserError('Codex Coding task cannot be empty');
		return await this.executor.run(async () => await this.executeExclusive(request, invocation));
	}

	async shutdown(): Promise<void> {
		await this.appServer.shutdown();
	}

	private async executeExclusive(
		request: CodexCodingRequestV1,
		invocation: CodexCodingInvocationContext,
	): Promise<CodexCodingResultV1> {
		let run = await this.runs.findForInvocation(
			invocation.workflowExecutionId,
			invocation.nodeId,
		);

		if (!run) {
			const workspace = await this.worktrees.prepare({
				repositoryId: request.repositoryId,
				workflowExecutionId: invocation.workflowExecutionId,
				nodeId: invocation.nodeId,
			});
			const started = await this.appServer.startThread({
				cwd: workspace.worktreePath,
				...(request.model ? { model: request.model } : {}),
			});
			run = this.runs.create({
				id: randomUUID(),
				projectId: invocation.projectId ?? null,
				workflowId: invocation.workflowId,
				workflowExecutionId: invocation.workflowExecutionId,
				nodeId: invocation.nodeId,
				repositoryId: request.repositoryId,
				baseCommit: workspace.baseCommit,
				branchName: workspace.branchName,
				worktreePath: workspace.worktreePath,
				codexThreadId: started.threadId,
				codexSessionId: started.sessionId ?? null,
				status: 'running',
				lastTurnId: null,
				error: null,
			});
			await this.runs.save(run);
			if (request.goal) await this.appServer.setGoal(started.threadId, request.goal);
		} else {
			if (run.repositoryId !== request.repositoryId) {
				throw new UserError('A Codex Coding node cannot change repositories during one execution');
			}
			if (!run.codexThreadId) throw new OperationalError('The Codex run has no thread id');
			await this.appServer.resumeThread(
				run.codexThreadId,
				run.worktreePath,
				request.model,
			);
		}

		const threadId = run.codexThreadId;
		if (!threadId) throw new OperationalError('The Codex run has no thread id');
		const round = request.loopContext?.round ?? invocation.runIndex + 1;
		const timeoutMs = Math.min(
			Math.max(1_000, request.timeoutMs ?? 1_200_000),
			this.config.maxTimeoutMs,
		);

		let turnId = '';
		let summary = '';
		let usage: CodexCodingResultV1['usage'];
		let status: CodexCodingStatus = 'runtime_failed';
		let error: CodexCodingResultV1['error'];
		let checks: CodexCodingResultV1['checks'] = [];

		try {
			const turn = await this.appServer.runTurn({
				threadId,
				cwd: run.worktreePath,
				task: this.buildTask(request, round),
				...(request.model ? { model: request.model } : {}),
				...(request.reasoningEffort ? { effort: request.reasoningEffort } : {}),
				timeoutMs,
				...(invocation.abortSignal ? { signal: invocation.abortSignal } : {}),
			});
			turnId = turn.turnId;
			summary = turn.summary;
			usage = {
				...(turn.inputTokens === undefined ? {} : { inputTokens: turn.inputTokens }),
				...(turn.outputTokens === undefined ? {} : { outputTokens: turn.outputTokens }),
			};
			if (turn.status !== 'completed') {
				throw new OperationalError(turn.error ?? `Codex turn ended with ${turn.status}`);
			}
			checks = await this.worktrees.runVerification(
				this.worktrees.getRepository(request.repositoryId),
				request.verificationProfile,
				run.worktreePath,
			);
			status = checks.every((check) => check.passed) ? 'completed' : 'verification_failed';
		} catch (caughtError) {
			status = failureStatus(caughtError);
			const message = caughtError instanceof Error ? caughtError.message : 'Codex runtime failed';
			error = { code: failureCode(status), message };
			this.logger.warn('Codex coding turn failed', { error: caughtError, runId: run.id, round });
		}

		const diff = await this.worktrees.collectDiff(run.worktreePath, run.id, turnId || `round-${round}`);
		if (status === 'completed' && diff.changedFiles.length === 0) {
			checks.unshift({
				id: 'codex-source-changes',
				kind: 'deterministic',
				required: true,
				passed: false,
				message: 'Codex did not change any repository files',
			});
			status = 'verification_failed';
		}

		run.status = status;
		run.lastTurnId = turnId || null;
		run.error = error?.message ?? null;
		await this.runs.save(run);
		await this.turns.save(
			this.turns.create({
				id: randomUUID(),
				runId: run.id,
				turnId: turnId || null,
				round,
				status,
				summary: summary || null,
				usage: usage ? JSON.stringify(usage) : null,
				checks: JSON.stringify(checks),
				error: error?.message ?? null,
				diffArtifactId: diff.diffArtifactId,
			}),
		);

		return {
			version: 1,
			runId: run.id,
			status,
			workflowExecutionId: invocation.workflowExecutionId,
			threadId,
			turnId,
			round,
			repositoryId: request.repositoryId,
			baseCommit: run.baseCommit,
			branchName: run.branchName,
			worktreePath: run.worktreePath,
			summary,
			changedFiles: diff.changedFiles,
			diffStat: diff.diffStat,
			diffPreview: diff.diffPreview,
			diffArtifactId: diff.diffArtifactId,
			checks,
			...(usage ? { usage } : {}),
			...(error ? { error } : {}),
		};
	}

	private buildTask(request: CodexCodingRequestV1, round: number): string {
		const parts = [
			`This is implementation round ${round}.`,
			'Work only inside the current worktree.',
			'Do not use the network. Do not wait for approval.',
			request.task.trim(),
		];
		if (request.loopContext) {
			parts.push('The platform supplied this verified loop context:');
			parts.push(JSON.stringify(request.loopContext));
		}
		return parts.join('\n\n');
	}
}
