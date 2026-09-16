import type { JsonValue } from './interfaces';

export const GOAL_LOOP_NODE_TYPE = 'n8n-nodes-base.goalLoop';
export const LOOP_EVALUATION_NODE_TYPE = 'n8n-nodes-base.loopEvaluation';

export type LoopStatus = 'running' | 'passed' | 'blocked' | 'max_rounds' | 'stagnated';

export type LoopStopReason = Exclude<LoopStatus, 'running'>;

export interface LoopCheckResultV1 {
	id: string;
	kind: 'deterministic' | 'reviewer';
	required: boolean;
	passed: boolean;
	score?: number;
	message?: string;
	evidence?: JsonValue;
}

export interface LoopReviewIssueV1 {
	id: string;
	severity: 'error' | 'warning';
	message: string;
	suggestion?: string;
}

export interface LoopReviewerResultV1 {
	score: number;
	verdict: 'pass' | 'revise' | 'blocked';
	summary: string;
	issues: LoopReviewIssueV1[];
}

export interface LoopEvaluationV1 {
	version: 1;
	artifact: JsonValue;
	checks: LoopCheckResultV1[];
	reviewer?: LoopReviewerResultV1;
	extraContext?: JsonValue;
}

export interface LoopRoundSummaryV1 {
	round: number;
	score?: number;
	failedRequiredCheckIds: string[];
	reviewerVerdict?: LoopReviewerResultV1['verdict'];
	summary: string;
}

export interface LoopBestResultV1 {
	round: number;
	artifact: JsonValue;
	score?: number;
	failedRequiredChecks: number;
}

export interface LoopStateV1 {
	version: 1;
	regionId: string;
	status: LoopStatus;
	goal: string;
	constraints: string[];
	acceptanceCriteria: string[];
	round: number;
	maxRounds: number;
	reviewerThreshold: number;
	stagnationRounds: number;
	historyWindow: number;
	currentArtifact?: JsonValue;
	bestResult?: LoopBestResultV1;
	latestEvaluation?: LoopEvaluationV1;
	history: LoopRoundSummaryV1[];
	stagnantRounds: number;
	previousFailedRequiredCheckIds: string[];
	previousScore?: number;
}

export interface LoopContextV1 {
	version: 1;
	regionId: string;
	goal: string;
	constraints: string[];
	acceptanceCriteria: string[];
	round: number;
	maxRounds: number;
	currentArtifact?: JsonValue;
	latestFailures: LoopCheckResultV1[];
	latestReview?: LoopReviewerResultV1;
	bestResult?: LoopBestResultV1;
	scoreDelta?: number;
	recentHistory: LoopRoundSummaryV1[];
	nextFocus: string[];
	extraContext?: JsonValue;
	additionalContext?: string;
}

export interface LoopEngineeringTaskMetadata {
	regionId: string;
	round: number;
	maxRounds: number;
	status: LoopStatus;
	score?: number;
	bestScore?: number;
	failedCheckIds: string[];
	stopReason?: LoopStopReason;
}
