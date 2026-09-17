import type {
	CodexCodingRequestV1,
	CodexCodingRepositoryOption,
	CodexCodingTaskMetadata,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	LoopContextV1,
} from 'n8n-workflow';
import {
	codexCodingResultToLoopEvaluation,
	NodeConnectionTypes,
	NodeOperationError,
} from 'n8n-workflow';

function selectedValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'object' && value !== null && 'value' in value) {
		const selected = value.value;
		return typeof selected === 'string' ? selected : '';
	}
	return '';
}

function isLoopContext(value: unknown): value is LoopContextV1 {
	return (
		typeof value === 'object' &&
		value !== null &&
		'version' in value &&
		value.version === 1 &&
		'round' in value &&
		typeof value.round === 'number'
	);
}

function metadataFor(result: Awaited<ReturnType<IExecuteFunctions['executeCodexCodingAgent']>>) {
	const metadata: CodexCodingTaskMetadata = {
		runId: result.runId,
		threadId: result.threadId,
		turnId: result.turnId,
		round: result.round,
		status: result.status,
		branchName: result.branchName,
		baseCommit: result.baseCommit,
		changedFiles: result.changedFiles,
		diffStat: result.diffStat,
		checks: result.checks.map(({ id, passed, message }) => ({ id, passed, message })),
		...(result.diffArtifactId ? { diffArtifactId: result.diffArtifactId } : {}),
	};
	return metadata;
}

export class CodexCodingAgent implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Codex Coding Agent',
		name: 'codexCodingAgent',
		icon: 'file:codex.svg',
		group: ['organization'],
		version: 1,
		description: 'Modify an allowlisted repository in an isolated Git worktree',
		defaults: { name: 'Codex Coding Agent' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Repository',
				name: 'repositoryId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'listRepositories', searchable: true },
					},
				],
				description: 'A repository from the server allowlist',
			},
			{
				displayName: 'Task',
				name: 'task',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '={{ JSON.stringify($json.loopContext ?? $json) }}',
				required: true,
				description: 'The implementation task for this turn',
			},
			{
				displayName: 'Goal',
				name: 'goal',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '={{ $json.loopContext?.goal ?? "" }}',
				description: 'A stable goal set when the Codex thread is created',
			},
			{
				displayName: 'Verification Profile',
				name: 'verificationProfile',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'listVerificationProfiles', searchable: true },
					},
				],
				description: 'A server-managed set of deterministic checks',
			},
			{
				displayName: 'Model',
				name: 'model',
				type: 'string',
				default: '',
				placeholder: 'Use Codex default',
			},
			{
				displayName: 'Reasoning Effort',
				name: 'reasoningEffort',
				type: 'options',
				options: [
					{ name: 'Low', value: 'low' },
					{ name: 'Medium', value: 'medium' },
					{ name: 'High', value: 'high' },
					{ name: 'Extra High', value: 'xhigh' },
				],
				default: 'high',
			},
			{
				displayName: 'Timeout (Minutes)',
				name: 'timeoutMinutes',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 120 },
				default: 20,
				description: 'The server can enforce a lower maximum',
			},
		],
	};

	methods = {
		listSearch: {
			async listRepositories(this: ILoadOptionsFunctions, filter?: string) {
				const repositories = (await this.listCodexCodingRepositories?.()) ?? [];
				const normalized = filter?.toLowerCase();
				return {
					results: repositories
						.filter((repository) => !normalized || repository.label.toLowerCase().includes(normalized))
						.map((repository) => ({ name: repository.label, value: repository.id })),
				};
			},
			async listVerificationProfiles(this: ILoadOptionsFunctions, filter?: string) {
				const repositoryId = selectedValue(this.getCurrentNodeParameter('repositoryId'));
				const repositories: CodexCodingRepositoryOption[] =
					(await this.listCodexCodingRepositories?.()) ?? [];
				const normalized = filter?.toLowerCase();
				const profiles = repositories.find((repository) => repository.id === repositoryId)
					?.verificationProfiles;
				return {
					results: (profiles ?? [])
						.filter((profile) => !normalized || profile.label.toLowerCase().includes(normalized))
						.map((profile) => ({ name: profile.label, value: profile.id })),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		if (items.length !== 1) {
			throw new NodeOperationError(
				this.getNode(),
				'Codex Coding Agent requires exactly one input item',
			);
		}

		const repositoryId = selectedValue(this.getNodeParameter('repositoryId', 0));
		const verificationProfile = selectedValue(
			this.getNodeParameter('verificationProfile', 0),
		);
		const task = (this.getNodeParameter('task', 0) as string).trim();
		if (!repositoryId || !verificationProfile || !task) {
			throw new NodeOperationError(
				this.getNode(),
				'Repository, task, and verification profile are required',
			);
		}

		const loopContext = items[0].json.loopContext;
		const model = (this.getNodeParameter('model', 0, '') as string).trim();
		const goal = (this.getNodeParameter('goal', 0, '') as string).trim();
		const request: CodexCodingRequestV1 = {
			version: 1,
			repositoryId,
			task,
			verificationProfile,
			reasoningEffort: this.getNodeParameter('reasoningEffort', 0) as
				| 'low'
				| 'medium'
				| 'high'
				| 'xhigh',
			timeoutMs: (this.getNodeParameter('timeoutMinutes', 0) as number) * 60_000,
			...(model ? { model } : {}),
			...(goal ? { goal } : {}),
			...(isLoopContext(loopContext) ? { loopContext } : {}),
		};

		const result = await this.executeCodexCodingAgent(request, 0);
		this.setMetadata({ codexCoding: metadataFor(result) });
		const loopEvaluation = codexCodingResultToLoopEvaluation(result);
		return [
			[
				{
					json: {
						...items[0].json,
						codexCoding: result as unknown as IDataObject,
						artifact: loopEvaluation.artifact as IDataObject,
						checks: loopEvaluation.checks as unknown as IDataObject[],
						...(loopEvaluation.reviewer
							? { reviewer: loopEvaluation.reviewer as unknown as IDataObject }
							: {}),
						extraContext: loopEvaluation.extraContext as IDataObject,
						loopEvaluation: loopEvaluation as unknown as IDataObject,
					},
					pairedItem: { item: 0 },
				},
			],
		];
	}
}
