// Runs the native Loop Engineering demo through the pinned n8n scheduler.
// The Code body uses a local VM adapter, so no task runner or model credential is needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const packages = path.join(root, 'upstream/n8n/packages');
const { Workflow, NodeHelpers } = require(path.join(packages, 'workflow'));
const {
	WorkflowExecute,
} = require(path.join(packages, 'core/dist/execution-engine/workflow-execute'));
const {
	ExecutionLifecycleHooks,
} = require(path.join(packages, 'core/dist/execution-engine/execution-lifecycle-hooks'));
const { ManualTrigger } = require(
	path.join(packages, 'nodes-base/dist/nodes/ManualTrigger/ManualTrigger.node'),
);
const { NoOp } = require(path.join(packages, 'nodes-base/dist/nodes/NoOp/NoOp.node'));
const { GoalLoop } = require(
	path.join(packages, 'nodes-base/dist/nodes/LoopEngineering/GoalLoop/GoalLoop.node'),
);
const { LoopEvaluation } = require(
	path.join(packages, 'nodes-base/dist/nodes/LoopEngineering/LoopEvaluation/LoopEvaluation.node'),
);

const clone = (value) => JSON.parse(JSON.stringify(value));

const codeAdapter = {
	description: {
		displayName: 'Code',
		name: 'code',
		group: ['transform'],
		version: 2,
		description: 'Local check adapter',
		defaults: { name: 'Code' },
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{ displayName: 'Mode', name: 'mode', type: 'string', default: 'runOnceForAllItems' },
			{ displayName: 'Code', name: 'jsCode', type: 'string', default: '' },
		],
	},
	async execute() {
		const proxy = this.getWorkflowDataProxy(0);
		const items = this.getInputData();
		const result = vm.runInNewContext(
			`(function(){\n${this.getNodeParameter('jsCode', 0)}\n})()`,
			{
				$json: proxy.$json,
				$input: { first: () => clone(items[0]), all: () => clone(items) },
			},
			{ timeout: 1_000 },
		);
		return [clone(result)];
	},
};

async function main() {
	const spec = JSON.parse(
		fs.readFileSync(
			path.join(root, 'workflows/loop-engineering/04-native-loop.json'),
			'utf8',
		),
	);
	const types = {
		'n8n-nodes-base.code': codeAdapter,
		'n8n-nodes-base.goalLoop': new GoalLoop(),
		'n8n-nodes-base.loopEvaluation': new LoopEvaluation(),
		'n8n-nodes-base.manualTrigger': new ManualTrigger(),
		'n8n-nodes-base.noOp': new NoOp(),
	};
	const nodeTypes = {
		getByName: (name) => types[name],
		getByNameAndVersion: (name, version) =>
			NodeHelpers.getVersionedNodeType(types[name], version),
		getKnownTypes: () => ({}),
	};
	const workflow = new Workflow({ ...spec, id: 'native-loop-check', active: false, nodeTypes });
	const hooks = new ExecutionLifecycleHooks('manual', 'native-loop-check', spec);
	const additionalData = {
		hooks,
		currentNodeExecutionIndex: 0,
		executionId: 'native-loop-check',
		executionTimeoutTimestamp: Date.now() + 15_000,
		webhookWaitingBaseUrl: 'http://localhost:5678/webhook-waiting',
		formWaitingBaseUrl: 'http://localhost:5678/form-waiting',
		credentialsHelper: {},
		variables: {},
		executeWorkflow: async () => {
			throw new Error('Subworkflows are not used.');
		},
	};

	const result = await new WorkflowExecute(additionalData, 'manual').run({
		workflow,
		startNode: workflow.getNode('Manual Trigger'),
	});
	if (result.data.resultData.error) throw new Error(JSON.stringify(result.data.resultData.error));

	const runData = result.data.resultData.runData;
	assert.equal(runData['Pre-Loop Input'].length, 1);
	assert.equal(runData['Writer and Test Fixture'].length, 2);
	assert.equal(runData['Loop Evaluation'].length, 2);
	assert.equal(runData['Goal Loop'].length, 3);
	assert.equal(runData.Completed.length, 1);
	assert.equal(runData.Stopped, undefined);
	assert.deepEqual(
		runData['Goal Loop'].map((run) => run.metadata?.loopEngineering?.round),
		[1, 1, 2],
	);
	assert.deepEqual(
		runData['Goal Loop'].map((run) => run.metadata?.loopEngineering?.status),
		['running', 'running', 'passed'],
	);

	const firstContext = runData['Goal Loop'][0].data.main[0][0].json.loopContext;
	const secondContext = runData['Goal Loop'][1].data.main[0][0].json.loopContext;
	const completed = runData.Completed[0].data.main[0][0].json;
	assert.equal(firstContext.round, 1);
	assert.equal(secondContext.round, 2);
	assert.deepEqual(
		secondContext.latestFailures.map((check) => check.id),
		['required-result-field'],
	);
	assert.deepEqual(secondContext.nextFocus, [
		'TC01 is missing expectedResult.',
		'Add a rejected request with a 21-character password.',
	]);
	assert.equal(completed.loopState.status, 'passed');
	assert.equal(completed.loopState.round, 2);
	assert.equal(completed.artifact.cases.length, 2);

	console.log('PASS: native Goal Loop completed in round 2.');
	console.log('PASS: Pre-Loop ran once and retry context contains bounded evidence.');
	console.log('PASS: execution metadata records the round timeline.');
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
