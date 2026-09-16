import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	LoopEngineeringTaskMetadata,
	LoopStateV1,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	buildLoopContext,
	createLoopState,
	evaluateLoopRound,
	normalizeLoopEvaluation,
} from '../loopEngine';

const STATE_KEY = 'goalLoopStateV1';

function splitLines(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function isLoopState(value: unknown): value is LoopStateV1 {
	return (
		typeof value === 'object' &&
		value !== null &&
		'version' in value &&
		value.version === 1 &&
		'regionId' in value &&
		typeof value.regionId === 'string'
	);
}

function metadataFor(state: LoopStateV1): LoopEngineeringTaskMetadata {
	const failedCheckIds =
		state.latestEvaluation?.checks
			.filter((check) => check.required && !check.passed)
			.map((check) => check.id) ?? [];
	return {
		regionId: state.regionId,
		round: state.round,
		maxRounds: state.maxRounds,
		status: state.status,
		...(state.latestEvaluation?.reviewer ? { score: state.latestEvaluation.reviewer.score } : {}),
		...(state.bestResult?.score === undefined ? {} : { bestScore: state.bestResult.score }),
		failedCheckIds,
		...(state.status === 'running' ? {} : { stopReason: state.status }),
	};
}

function outputItem(state: LoopStateV1, extra: IDataObject = {}): INodeExecutionData {
	return {
		json: {
			...extra,
			loopState: state as unknown as IDataObject,
			...(state.bestResult ? { artifact: state.bestResult.artifact } : {}),
		},
		pairedItem: { item: 0 },
	};
}

export class GoalLoop implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Goal Loop',
		name: 'goalLoop',
		icon: 'node:loop-over-items',
		iconColor: 'dark-green',
		group: ['organization'],
		version: 1,
		description: 'Iterate toward a goal using tests and reviewer feedback',
		defaults: { name: 'Goal Loop' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main, NodeConnectionTypes.Main, NodeConnectionTypes.Main],
		outputNames: ['iterate', 'completed', 'stopped'],
		properties: [
			{
				displayName:
					'Connect iterate to the loop body. Connect Loop Evaluation back to this node. Pre-loop nodes run only before the first call.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Goal',
				name: 'goal',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				required: true,
				description: 'The outcome that stays stable for every round',
			},
			{
				displayName: 'Constraints',
				name: 'constraints',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'One constraint per line',
			},
			{
				displayName: 'Acceptance Criteria',
				name: 'acceptanceCriteria',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				required: true,
				description: 'One acceptance criterion per line',
			},
			{
				displayName: 'Maximum Rounds',
				name: 'maxRounds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100 },
				default: 3,
			},
			{
				displayName: 'Reviewer Pass Score',
				name: 'reviewerThreshold',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 100 },
				default: 80,
			},
			{
				displayName: 'Stop After Stagnant Rounds',
				name: 'stagnationRounds',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 20 },
				default: 2,
			},
			{
				displayName: 'History Window',
				name: 'historyWindow',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 20 },
				default: 3,
				description: 'Number of recent round summaries to include in the next context',
			},
			{
				displayName: 'Additional Context',
				name: 'additionalContextTemplate',
				type: 'string',
				typeOptions: { rows: 4 },
				default: '',
				description:
					'Optional domain context. This cannot replace the goal, acceptance criteria, or failure evidence.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		if (items.length !== 1) {
			throw new NodeOperationError(this.getNode(), 'Goal Loop requires exactly one input item');
		}

		const nodeContext = this.getContext('node');
		const storedState = nodeContext[STATE_KEY] as unknown;
		const additionalContext = this.getNodeParameter('additionalContextTemplate', 0, '') as string;

		if (!isLoopState(storedState)) {
			const state = createLoopState({
				regionId: this.getNode().id,
				goal: (this.getNodeParameter('goal', 0) as string).trim(),
				constraints: splitLines(this.getNodeParameter('constraints', 0, '') as string),
				acceptanceCriteria: splitLines(this.getNodeParameter('acceptanceCriteria', 0) as string),
				maxRounds: this.getNodeParameter('maxRounds', 0) as number,
				reviewerThreshold: this.getNodeParameter('reviewerThreshold', 0) as number,
				stagnationRounds: this.getNodeParameter('stagnationRounds', 0) as number,
				historyWindow: this.getNodeParameter('historyWindow', 0) as number,
			});
			if (!state.goal) throw new NodeOperationError(this.getNode(), 'Goal cannot be empty');
			if (state.acceptanceCriteria.length === 0) {
				throw new NodeOperationError(this.getNode(), 'Add at least one acceptance criterion');
			}
			nodeContext[STATE_KEY] = state;
			this.setMetadata({ loopEngineering: metadataFor(state) });
			return [
				[
					outputItem(state, {
						...items[0].json,
						loopContext: buildLoopContext(state, additionalContext) as unknown as IDataObject,
					}),
				],
				[],
				[],
			];
		}

		try {
			const evaluation = normalizeLoopEvaluation(items[0].json.loopEvaluation);
			const decision = evaluateLoopRound(storedState, evaluation, additionalContext);
			nodeContext[STATE_KEY] = decision.state;
			const metadata = metadataFor(decision.state);
			if (decision.outcome === 'iterate') metadata.round = storedState.round;
			this.setMetadata({ loopEngineering: metadata });

			if (decision.outcome === 'iterate') {
				return [
					[
						outputItem(decision.state, {
							loopContext: decision.context as unknown as IDataObject,
						}),
					],
					[],
					[],
				];
			}

			const result = outputItem(decision.state, {
				loopEvaluation: evaluation as unknown as IDataObject,
				stopReason: decision.state.status,
			});
			return decision.outcome === 'completed' ? [[], [result], []] : [[], [], [result]];
		} catch (error: unknown) {
			const cause =
				error instanceof Error
					? error
					: new Error('Goal Loop requires a valid Loop Evaluation input');
			throw new NodeOperationError(this.getNode(), cause, {
				message: cause.message,
			});
		}
	}
}
