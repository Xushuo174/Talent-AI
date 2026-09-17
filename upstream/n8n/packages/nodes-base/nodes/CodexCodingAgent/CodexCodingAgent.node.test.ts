import type {
	CodexCodingResultV1,
	IExecuteFunctions,
	NodeParameterValueType,
} from 'n8n-workflow';
import { mockDeep, type MockProxy } from 'vitest-mock-extended';

import { CodexCodingAgent } from './CodexCodingAgent.node';

describe('CodexCodingAgent', () => {
	let executeFunctions: MockProxy<IExecuteFunctions>;
	let node: CodexCodingAgent;

	const result: CodexCodingResultV1 = {
		version: 1,
		runId: 'run-1',
		status: 'verification_failed',
		workflowExecutionId: 'execution-1',
		threadId: 'thread-1',
		turnId: 'turn-1',
		round: 2,
		repositoryId: 'talent-ai',
		baseCommit: 'a'.repeat(40),
		branchName: 'talent-ai/codex/execution-1-node-1',
		worktreePath: 'C:/worktrees/run-1',
		summary: 'Added the feature and tests.',
		changedFiles: ['packages/nodes-base/nodes/CodexCodingAgent/CodexCodingAgent.node.ts'],
		diffStat: '1 file changed, 4 insertions(+)',
		diffPreview: 'diff --git ...',
		diffArtifactId: 'run-1-turn-1.diff',
		checks: [
			{
				id: 'unit-tests',
				kind: 'deterministic',
				required: true,
				passed: false,
				message: 'Unit tests failed',
			},
		],
	};

	beforeEach(() => {
		node = new CodexCodingAgent();
		executeFunctions = mockDeep<IExecuteFunctions>();
		executeFunctions.getNode.mockReturnValue({
			id: 'node-1',
			name: 'Codex Coding Agent',
			type: 'n8n-nodes-base.codexCodingAgent',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		});
		executeFunctions.getInputData.mockReturnValue([
			{
				json: {
					loopContext: {
						version: 1,
						regionId: 'loop-1',
						goal: 'Improve the node',
						constraints: [],
						acceptanceCriteria: ['Tests pass'],
						round: 2,
						maxRounds: 3,
						latestFailures: [],
						recentHistory: [],
						nextFocus: [],
					},
				},
			},
		]);
		executeFunctions.getNodeParameter.mockImplementation((name) => {
			const parameters: Record<string, NodeParameterValueType> = {
				repositoryId: { mode: 'list', value: 'talent-ai' },
				task: 'Implement the requested change',
				goal: 'Improve the node',
				verificationProfile: { mode: 'list', value: 'codex-node-targeted' },
				model: '',
				reasoningEffort: 'high',
				timeoutMinutes: 20,
			};
			return parameters[name];
		});
		executeFunctions.executeCodexCodingAgent.mockResolvedValue(result);
	});

	it('passes the Loop context to the runtime and emits a Loop Evaluation', async () => {
		const output = await node.execute.call(executeFunctions);

		expect(executeFunctions.executeCodexCodingAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				version: 1,
				repositoryId: 'talent-ai',
				verificationProfile: 'codex-node-targeted',
				reasoningEffort: 'high',
				timeoutMs: 1_200_000,
				loopContext: expect.objectContaining({ round: 2 }),
			}),
			0,
		);
		expect(output[0][0].json.loopEvaluation).toMatchObject({
			version: 1,
			checks: [{ id: 'unit-tests', passed: false }],
			artifact: { runId: 'run-1', branchName: result.branchName },
		});
		expect(executeFunctions.setMetadata).toHaveBeenCalledWith({
			codexCoding: expect.objectContaining({
				runId: 'run-1',
				threadId: 'thread-1',
				turnId: 'turn-1',
				status: 'verification_failed',
			}),
		});
	});

	it('maps policy failures to a blocked reviewer result', async () => {
		executeFunctions.executeCodexCodingAgent.mockResolvedValue({
			...result,
			status: 'policy_blocked',
			error: { code: 'POLICY_BLOCKED', message: 'Network access was denied' },
		});

		const output = await node.execute.call(executeFunctions);

		expect(output[0][0].json.loopEvaluation).toMatchObject({
			reviewer: {
				score: 0,
				verdict: 'blocked',
				summary: 'Network access was denied',
			},
		});
	});

	it('rejects multiple input items before starting Codex', async () => {
		executeFunctions.getInputData.mockReturnValue([{ json: {} }, { json: {} }]);

		await expect(node.execute.call(executeFunctions)).rejects.toThrow(
			'Codex Coding Agent requires exactly one input item',
		);
		expect(executeFunctions.executeCodexCodingAgent).not.toHaveBeenCalled();
	});
});
