import type { LoopContextV1, LoopEvaluationV1 } from './loop-engineering';
import type { JsonValue } from './interfaces';

export type CodexCodingStatus =
	| 'completed'
	| 'verification_failed'
	| 'policy_blocked'
	| 'timed_out'
	| 'cancelled'
	| 'runtime_failed';

export interface CodexCodingRequestV1 {
	version: 1;
	repositoryId: string;
	task: string;
	goal?: string;
	loopContext?: LoopContextV1;
	verificationProfile: string;
	model?: string;
	reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
	timeoutMs?: number;
}

export interface CodexCodingInvocationContext {
	workflowExecutionId: string;
	workflowId: string;
	workflowName: string;
	nodeId: string;
	nodeName: string;
	runIndex: number;
	itemIndex: number;
	projectId?: string;
	abortSignal?: AbortSignal;
}

export interface CodexCodingCheckV1 {
	id: string;
	kind: 'deterministic';
	required: true;
	passed: boolean;
	message: string;
	evidence?: JsonValue;
}

export interface CodexCodingResultV1 {
	version: 1;
	runId: string;
	status: CodexCodingStatus;
	workflowExecutionId: string;
	threadId: string;
	turnId: string;
	round: number;
	repositoryId: string;
	baseCommit: string;
	branchName: string;
	worktreePath: string;
	summary: string;
	changedFiles: string[];
	diffStat: string;
	diffPreview: string;
	diffArtifactId?: string;
	checks: CodexCodingCheckV1[];
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
	};
	error?: {
		code: string;
		message: string;
	};
}

export interface CodexCodingRepositoryOption {
	id: string;
	label: string;
	verificationProfiles: Array<{ id: string; label: string }>;
}

export interface CodexCodingProxy {
	execute(
		request: CodexCodingRequestV1,
		invocation: CodexCodingInvocationContext,
	): Promise<CodexCodingResultV1>;
	listRepositories(): Promise<CodexCodingRepositoryOption[]>;
}

export interface CodexCodingTaskMetadata {
	runId: string;
	threadId: string;
	turnId: string;
	round: number;
	status: CodexCodingStatus;
	branchName: string;
	baseCommit: string;
	changedFiles: string[];
	diffStat: string;
	diffArtifactId?: string;
	checks: Array<{ id: string; passed: boolean; message: string }>;
}

export function codexCodingResultToLoopEvaluation(result: CodexCodingResultV1): LoopEvaluationV1 {
	const blocked = ['policy_blocked', 'timed_out', 'cancelled', 'runtime_failed'].includes(
		result.status,
	);
	return {
		version: 1,
		artifact: {
			runId: result.runId,
			branchName: result.branchName,
			baseCommit: result.baseCommit,
			worktreePath: result.worktreePath,
			changedFiles: result.changedFiles,
			diffStat: result.diffStat,
			diffPreview: result.diffPreview,
			summary: result.summary,
			...(result.diffArtifactId ? { diffArtifactId: result.diffArtifactId } : {}),
		},
		checks: result.checks,
		...(blocked
			? {
					reviewer: {
						score: 0,
						verdict: 'blocked' as const,
						summary: result.error?.message ?? `Codex run ended with ${result.status}`,
						issues: [
							{
								id: result.error?.code ?? result.status,
								severity: 'error' as const,
								message: result.error?.message ?? result.status,
							},
						],
					},
				}
			: {}),
		extraContext: {
			codexRunId: result.runId,
			threadId: result.threadId,
			turnId: result.turnId,
			round: result.round,
			summary: result.summary,
		},
	};
}
