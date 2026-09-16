import type { LoopEvaluationV1 } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	buildLoopContext,
	createLoopState,
	evaluateLoopRound,
	normalizeLoopEvaluation,
} from './loopEngine';

function state(overrides: Partial<ReturnType<typeof createLoopState>> = {}) {
	return {
		...createLoopState({
			regionId: 'goal-loop',
			goal: 'Produce a complete test plan',
			constraints: ['Use JSON'],
			acceptanceCriteria: ['Include positive and negative cases'],
			maxRounds: 3,
			reviewerThreshold: 80,
			stagnationRounds: 2,
			historyWindow: 3,
		}),
		...overrides,
	};
}

function evaluation(overrides: Partial<LoopEvaluationV1> = {}): LoopEvaluationV1 {
	return {
		version: 1,
		artifact: { cases: ['positive'] },
		checks: [{ id: 'negative-case', kind: 'deterministic', required: true, passed: false }],
		reviewer: {
			score: 70,
			verdict: 'revise',
			summary: 'Add a negative case.',
			issues: [
				{
					id: 'missing-negative',
					severity: 'error',
					message: 'The plan has no negative case.',
					suggestion: 'Add an invalid password case.',
				},
			],
		},
		...overrides,
	};
}

describe('Loop Engineering engine', () => {
	it('builds the first context without review history', () => {
		const context = buildLoopContext(state(), 'Keep IDs stable.');

		expect(context).toMatchObject({
			round: 1,
			goal: 'Produce a complete test plan',
			latestFailures: [],
			recentHistory: [],
			additionalContext: 'Keep IDs stable.',
		});
	});

	it('retries when a required check fails despite a high reviewer score', () => {
		const result = evaluateLoopRound(
			state(),
			evaluation({
				reviewer: {
					score: 99,
					verdict: 'pass',
					summary: 'Looks good.',
					issues: [],
				},
			}),
		);

		expect(result.outcome).toBe('iterate');
		expect(result.state.round).toBe(2);
		expect(result.state.status).toBe('running');
	});

	it('retries when the reviewer score is below the threshold', () => {
		const result = evaluateLoopRound(
			state(),
			evaluation({
				checks: [{ id: 'schema', kind: 'deterministic', required: true, passed: true }],
			}),
		);

		expect(result.outcome).toBe('iterate');
	});

	it('reports the score change from the preceding round', () => {
		const first = evaluateLoopRound(
			state(),
			evaluation({
				reviewer: {
					score: 70,
					verdict: 'revise',
					summary: 'First review.',
					issues: [],
				},
			}),
		);
		if (first.outcome !== 'iterate') throw new Error('Expected first retry');
		const second = evaluateLoopRound(
			first.state,
			evaluation({
				reviewer: {
					score: 76,
					verdict: 'revise',
					summary: 'Improved.',
					issues: [],
				},
			}),
		);

		expect(second.outcome).toBe('iterate');
		if (second.outcome === 'iterate') expect(second.context.scoreDelta).toBe(6);
	});

	it('completes when required checks and reviewer pass', () => {
		const result = evaluateLoopRound(
			state(),
			evaluation({
				checks: [{ id: 'schema', kind: 'deterministic', required: true, passed: true }],
				reviewer: {
					score: 90,
					verdict: 'pass',
					summary: 'Ready.',
					issues: [],
				},
			}),
		);

		expect(result.outcome).toBe('completed');
		expect(result.state.status).toBe('passed');
	});

	it('stops when the reviewer is blocked', () => {
		const result = evaluateLoopRound(
			state(),
			evaluation({
				reviewer: {
					score: 0,
					verdict: 'blocked',
					summary: 'The source data is unavailable.',
					issues: [],
				},
			}),
		);

		expect(result.outcome).toBe('stopped');
		expect(result.state.status).toBe('blocked');
	});

	it('stops at the maximum round and keeps the best artifact', () => {
		const first = evaluateLoopRound(state({ maxRounds: 2 }), evaluation());
		if (first.outcome !== 'iterate') throw new Error('Expected a retry');
		const second = evaluateLoopRound(
			first.state,
			evaluation({ artifact: { cases: ['positive', 'edge'] } }),
		);

		expect(second.outcome).toBe('stopped');
		expect(second.state.status).toBe('max_rounds');
		expect(second.state.bestResult?.round).toBe(2);
	});

	it('stops after the configured number of stagnant rounds', () => {
		const first = evaluateLoopRound(state(), evaluation());
		if (first.outcome !== 'iterate') throw new Error('Expected first retry');
		const second = evaluateLoopRound(first.state, evaluation());
		if (second.outcome !== 'iterate') throw new Error('Expected second retry');
		const third = evaluateLoopRound(second.state, evaluation());

		expect(third.outcome).toBe('stopped');
		expect(third.state.status).toBe('stagnated');
	});

	it('normalizes input and rejects an invalid reviewer score', () => {
		expect(
			normalizeLoopEvaluation({
				artifact: { ok: true },
				checks: [{ id: 'schema', passed: true }],
			}),
		).toMatchObject({
			version: 1,
			checks: [{ id: 'schema', kind: 'deterministic', required: true, passed: true }],
		});

		expect(() =>
			normalizeLoopEvaluation({
				artifact: {},
				checks: [],
				reviewer: { score: 101, verdict: 'pass', summary: 'Invalid', issues: [] },
			}),
		).toThrow('reviewer.score must be a number from 0 to 100');

		expect(() =>
			normalizeLoopEvaluation({
				artifact: {},
				checks: [],
				reviewer: { verdict: 'pass', summary: 'Missing score', issues: [] },
			}),
		).toThrow('reviewer.score is required');
	});
});
