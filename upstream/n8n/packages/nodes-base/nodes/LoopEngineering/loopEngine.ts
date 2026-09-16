import type {
	JsonValue,
	LoopBestResultV1,
	LoopCheckResultV1,
	LoopContextV1,
	LoopEvaluationV1,
	LoopReviewIssueV1,
	LoopReviewerResultV1,
	LoopRoundSummaryV1,
	LoopStateV1,
} from 'n8n-workflow';

type JsonRecord = Record<string, JsonValue>;

export interface LoopConfiguration {
	regionId: string;
	goal: string;
	constraints: string[];
	acceptanceCriteria: string[];
	maxRounds: number;
	reviewerThreshold: number;
	stagnationRounds: number;
	historyWindow: number;
}

export type LoopDecision =
	| { outcome: 'iterate'; state: LoopStateV1; context: LoopContextV1 }
	| { outcome: 'completed' | 'stopped'; state: LoopStateV1 };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function toJsonValue(value: unknown, path = 'value'): JsonValue {
	if (value === undefined || value === null) return null;
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map((entry, index) => toJsonValue(entry, `${path}[${index}]`));
	}
	if (isRecord(value)) {
		const result: JsonRecord = {};
		for (const [key, entry] of Object.entries(value)) {
			result[key] = toJsonValue(entry, `${path}.${key}`);
		}
		return result;
	}
	throw new Error(`${path} must contain JSON-compatible data`);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`${path} must be an object`);
	return value;
}

function requireString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${path} must be a non-empty string`);
	}
	return value.trim();
}

function optionalString(value: unknown, path: string): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	return requireString(value, path);
}

function requireBoolean(value: unknown, path: string): boolean {
	if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean`);
	return value;
}

function optionalScore(value: unknown, path: string): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
		throw new Error(`${path} must be a number from 0 to 100`);
	}
	return value;
}

function normalizeCheck(value: unknown, index: number): LoopCheckResultV1 {
	const path = `checks[${index}]`;
	const check = requireRecord(value, path);
	const kind = check.kind ?? 'deterministic';
	if (kind !== 'deterministic' && kind !== 'reviewer') {
		throw new Error(`${path}.kind must be deterministic or reviewer`);
	}
	const score = optionalScore(check.score, `${path}.score`);
	const message = optionalString(check.message, `${path}.message`);
	return {
		id: requireString(check.id, `${path}.id`),
		kind,
		required:
			check.required === undefined ? true : requireBoolean(check.required, `${path}.required`),
		passed: requireBoolean(check.passed, `${path}.passed`),
		...(score === undefined ? {} : { score }),
		...(message === undefined ? {} : { message }),
		...(check.evidence === undefined
			? {}
			: { evidence: toJsonValue(check.evidence, `${path}.evidence`) }),
	};
}

function normalizeIssue(value: unknown, index: number): LoopReviewIssueV1 {
	const path = `reviewer.issues[${index}]`;
	const issue = requireRecord(value, path);
	const severity = issue.severity ?? 'error';
	if (severity !== 'error' && severity !== 'warning') {
		throw new Error(`${path}.severity must be error or warning`);
	}
	const suggestion = optionalString(issue.suggestion, `${path}.suggestion`);
	return {
		id: requireString(issue.id, `${path}.id`),
		severity,
		message: requireString(issue.message, `${path}.message`),
		...(suggestion === undefined ? {} : { suggestion }),
	};
}

function normalizeReviewer(value: unknown): LoopReviewerResultV1 | undefined {
	if (value === undefined || value === null) return undefined;
	const reviewer = requireRecord(value, 'reviewer');
	const verdict = reviewer.verdict;
	if (verdict !== 'pass' && verdict !== 'revise' && verdict !== 'blocked') {
		throw new Error('reviewer.verdict must be pass, revise, or blocked');
	}
	if (!Array.isArray(reviewer.issues)) throw new Error('reviewer.issues must be an array');
	const score = optionalScore(reviewer.score, 'reviewer.score');
	if (score === undefined) throw new Error('reviewer.score is required');
	return {
		score,
		verdict,
		summary: requireString(reviewer.summary, 'reviewer.summary'),
		issues: reviewer.issues.map(normalizeIssue),
	};
}

export function normalizeLoopEvaluation(value: unknown): LoopEvaluationV1 {
	const evaluation = requireRecord(value, 'evaluation');
	if (!Array.isArray(evaluation.checks)) throw new Error('evaluation.checks must be an array');
	const reviewer = normalizeReviewer(evaluation.reviewer);
	return {
		version: 1,
		artifact: toJsonValue(evaluation.artifact, 'evaluation.artifact'),
		checks: evaluation.checks.map(normalizeCheck),
		...(reviewer === undefined ? {} : { reviewer }),
		...(evaluation.extraContext === undefined
			? {}
			: { extraContext: toJsonValue(evaluation.extraContext, 'evaluation.extraContext') }),
	};
}

export function createLoopState(configuration: LoopConfiguration): LoopStateV1 {
	return {
		version: 1,
		regionId: configuration.regionId,
		status: 'running',
		goal: configuration.goal,
		constraints: configuration.constraints,
		acceptanceCriteria: configuration.acceptanceCriteria,
		round: 1,
		maxRounds: configuration.maxRounds,
		reviewerThreshold: configuration.reviewerThreshold,
		stagnationRounds: configuration.stagnationRounds,
		historyWindow: configuration.historyWindow,
		history: [],
		stagnantRounds: 0,
		previousFailedRequiredCheckIds: [],
	};
}

function failedRequiredChecks(evaluation: LoopEvaluationV1): LoopCheckResultV1[] {
	return evaluation.checks.filter((check) => check.required && !check.passed);
}

function isBetterResult(candidate: LoopBestResultV1, current?: LoopBestResultV1): boolean {
	if (!current) return true;
	if (candidate.failedRequiredChecks !== current.failedRequiredChecks) {
		return candidate.failedRequiredChecks < current.failedRequiredChecks;
	}
	const candidateScore = candidate.score ?? -1;
	const currentScore = current.score ?? -1;
	if (candidateScore !== currentScore) return candidateScore > currentScore;
	return candidate.round > current.round;
}

function summarizeRound(
	round: number,
	evaluation: LoopEvaluationV1,
	failedChecks: LoopCheckResultV1[],
): LoopRoundSummaryV1 {
	const summary =
		evaluation.reviewer?.summary ??
		(failedChecks.length === 0
			? 'All required checks passed.'
			: `${failedChecks.length} required check(s) failed.`);
	return {
		round,
		...(evaluation.reviewer ? { score: evaluation.reviewer.score } : {}),
		failedRequiredCheckIds: failedChecks.map((check) => check.id),
		...(evaluation.reviewer ? { reviewerVerdict: evaluation.reviewer.verdict } : {}),
		summary,
	};
}

function nextFocus(evaluation: LoopEvaluationV1, failedChecks: LoopCheckResultV1[]): string[] {
	const candidates = [
		...failedChecks.map((check) => check.message ?? `Fix required check: ${check.id}`),
		...(evaluation.reviewer?.issues.map((issue) => issue.suggestion ?? issue.message) ?? []),
	];
	return [...new Set(candidates)].slice(0, 3);
}

export function buildLoopContext(state: LoopStateV1, additionalContext?: string): LoopContextV1 {
	const evaluation = state.latestEvaluation;
	const currentScore = evaluation?.reviewer?.score;
	const scoreDelta =
		currentScore === undefined || state.previousScore === undefined
			? undefined
			: currentScore - state.previousScore;
	const failedChecks = evaluation ? failedRequiredChecks(evaluation) : [];
	return {
		version: 1,
		regionId: state.regionId,
		goal: state.goal,
		constraints: state.constraints,
		acceptanceCriteria: state.acceptanceCriteria,
		round: state.round,
		maxRounds: state.maxRounds,
		...(state.currentArtifact === undefined ? {} : { currentArtifact: state.currentArtifact }),
		latestFailures: failedChecks,
		...(evaluation?.reviewer ? { latestReview: evaluation.reviewer } : {}),
		...(state.bestResult ? { bestResult: state.bestResult } : {}),
		...(scoreDelta === undefined ? {} : { scoreDelta }),
		recentHistory: state.history.slice(-state.historyWindow),
		nextFocus: evaluation ? nextFocus(evaluation, failedChecks) : [],
		...(evaluation?.extraContext === undefined ? {} : { extraContext: evaluation.extraContext }),
		...(additionalContext?.trim() ? { additionalContext: additionalContext.trim() } : {}),
	};
}

function sameIds(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	const rightSet = new Set(right);
	return left.every((id) => rightSet.has(id));
}

export function evaluateLoopRound(
	state: LoopStateV1,
	evaluation: LoopEvaluationV1,
	additionalContext?: string,
): LoopDecision {
	const failedChecks = failedRequiredChecks(evaluation);
	const failedIds = failedChecks.map((check) => check.id);
	const score = evaluation.reviewer?.score;
	const candidate: LoopBestResultV1 = {
		round: state.round,
		artifact: evaluation.artifact,
		...(score === undefined ? {} : { score }),
		failedRequiredChecks: failedChecks.length,
	};
	const history = [...state.history, summarizeRound(state.round, evaluation, failedChecks)];
	const reviewerPassed =
		evaluation.reviewer === undefined ||
		(evaluation.reviewer.verdict === 'pass' &&
			score !== undefined &&
			score >= state.reviewerThreshold);
	const passed = failedChecks.length === 0 && reviewerPassed;
	const blocked = evaluation.reviewer?.verdict === 'blocked';
	const scoreImprovement =
		score === undefined || state.previousScore === undefined ? 0 : score - state.previousScore;
	const failuresImproved =
		state.history.length === 0 || failedIds.length < state.previousFailedRequiredCheckIds.length;
	const sameFailures = sameIds(failedIds, state.previousFailedRequiredCheckIds);
	const stagnant =
		state.history.length > 0 && !failuresImproved && scoreImprovement < 1 && sameFailures;
	const stagnantRounds = stagnant ? state.stagnantRounds + 1 : 0;
	const bestResult = isBetterResult(candidate, state.bestResult) ? candidate : state.bestResult;

	const nextState: LoopStateV1 = {
		...state,
		currentArtifact: evaluation.artifact,
		bestResult,
		latestEvaluation: evaluation,
		history,
		stagnantRounds,
		previousFailedRequiredCheckIds: failedIds,
		...(score === undefined ? {} : { previousScore: score }),
	};

	if (blocked) return { outcome: 'stopped', state: { ...nextState, status: 'blocked' } };
	if (passed) return { outcome: 'completed', state: { ...nextState, status: 'passed' } };
	if (stagnantRounds >= state.stagnationRounds) {
		return { outcome: 'stopped', state: { ...nextState, status: 'stagnated' } };
	}
	if (state.round >= state.maxRounds) {
		return { outcome: 'stopped', state: { ...nextState, status: 'max_rounds' } };
	}

	const retryState: LoopStateV1 = { ...nextState, round: state.round + 1 };
	const context = buildLoopContext(retryState, additionalContext);
	if (state.previousScore !== undefined && score !== undefined) {
		context.scoreDelta = score - state.previousScore;
	}
	return {
		outcome: 'iterate',
		state: retryState,
		context,
	};
}

export function readPath(record: Record<string, unknown>, path: string): unknown {
	let current: unknown = record;
	for (const segment of path.split('.').filter(Boolean)) {
		if (!isRecord(current)) return undefined;
		current = current[segment];
	}
	return current;
}
