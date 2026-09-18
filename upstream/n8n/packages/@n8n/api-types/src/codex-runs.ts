export const CODEX_RUN_STATUSES = [
	'preparing',
	'running',
	'completed',
	'verification_failed',
	'policy_blocked',
	'timed_out',
	'cancelled',
	'runtime_failed',
] as const;

export type CodexRunStatus = (typeof CODEX_RUN_STATUSES)[number];

export interface CodexRunStatusCount {
	status: CodexRunStatus;
	count: number;
}

export interface CodexRunOverviewItem {
	id: string;
	workflowId: string;
	workflowExecutionId: string;
	repositoryId: string;
	branchName: string;
	status: CodexRunStatus;
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	turnCount: number;
}

export interface CodexRunsOverview {
	stats: {
		total: number;
		succeeded: number;
		failed: number;
		averageDurationMs: number;
	};
	statusCounts: CodexRunStatusCount[];
	recentRuns: CodexRunOverviewItem[];
}
