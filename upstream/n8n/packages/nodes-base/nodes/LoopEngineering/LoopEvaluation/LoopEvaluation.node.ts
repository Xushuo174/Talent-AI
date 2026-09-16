import type {
	IExecuteFunctions,
	IDataObject,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { normalizeLoopEvaluation, readPath } from '../loopEngine';

export class LoopEvaluation implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Loop Evaluation',
		name: 'loopEvaluation',
		icon: 'fa:check-double',
		iconColor: 'green',
		group: ['organization'],
		version: 1,
		description: 'Validate test and reviewer results for a Goal Loop',
		defaults: { name: 'Loop Evaluation' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName:
					'Merge test and reviewer branches before this node. The node emits one versioned evaluation for Goal Loop.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Artifact Field',
				name: 'artifactField',
				type: 'string',
				default: 'artifact',
				description: 'Dot path to the artifact that the loop is improving',
			},
			{
				displayName: 'Checks Field',
				name: 'checksField',
				type: 'string',
				default: 'checks',
				description: 'Dot path to the array of deterministic and reviewer checks',
			},
			{
				displayName: 'Reviewer Field',
				name: 'reviewerField',
				type: 'string',
				default: 'reviewer',
				description: 'Dot path to the optional reviewer result',
			},
			{
				displayName: 'Extra Context Field',
				name: 'extraContextField',
				type: 'string',
				default: 'extraContext',
				description: 'Dot path to optional domain context for the next round',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		if (items.length !== 1) {
			throw new NodeOperationError(
				this.getNode(),
				'Loop Evaluation requires exactly one input item',
			);
		}

		const artifactField = this.getNodeParameter('artifactField', 0) as string;
		const checksField = this.getNodeParameter('checksField', 0) as string;
		const reviewerField = this.getNodeParameter('reviewerField', 0) as string;
		const extraContextField = this.getNodeParameter('extraContextField', 0) as string;
		const input = items[0].json;

		try {
			const evaluation = normalizeLoopEvaluation({
				artifact: readPath(input, artifactField),
				checks: readPath(input, checksField),
				reviewer: readPath(input, reviewerField),
				extraContext: readPath(input, extraContextField),
			});
			return [
				[
					{
						json: {
							...input,
							loopEvaluation: evaluation as unknown as IDataObject,
						},
						pairedItem: { item: 0 },
					},
				],
			];
		} catch (error: unknown) {
			const cause = error instanceof Error ? error : new Error('The loop evaluation is invalid');
			throw new NodeOperationError(this.getNode(), cause, {
				message: cause.message,
			});
		}
	}
}
