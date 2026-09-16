const fs = require('node:fs');
const path = require('node:path');

const ids = {
	trigger: '11111111-1111-4111-8111-111111111111',
	input: '22222222-2222-4222-8222-222222222222',
	goal: '33333333-3333-4333-8333-333333333333',
	body: '44444444-4444-4444-8444-444444444444',
	evaluation: '55555555-5555-4555-8555-555555555555',
	completed: '66666666-6666-4666-8666-666666666666',
	stopped: '77777777-7777-4777-8777-777777777777',
	group: '88888888-8888-4888-8888-888888888888',
};

const bodyCode = `const context = $json.loopContext;
const fixed = context.round >= 2;
const artifact = {
  title: 'POST /register test plan',
  cases: fixed
    ? [
        { id: 'TC01', request: { email: 'user@example.com', password: 'abcdefgh' }, expectedResult: 'accepted' },
        { id: 'TC02', request: { email: 'user@example.com', password: '123456789012345678901' }, expectedResult: 'rejected' },
      ]
    : [
        { id: 'TC01', request: { email: 'user@example.com', password: 'abcdefgh' } },
      ],
};

return [{
  json: {
    artifact,
    checks: [
      {
        id: 'required-result-field',
        kind: 'deterministic',
        required: true,
        passed: fixed,
        message: fixed ? 'Every case has an expected result.' : 'TC01 is missing expectedResult.',
        evidence: { caseId: 'TC01', field: 'expectedResult' },
      },
    ],
    reviewer: {
      score: fixed ? 92 : 72,
      verdict: fixed ? 'pass' : 'revise',
      summary: fixed ? 'The required field and semantic boundary case are present.' : 'Add the missing result and a 21-character rejection case.',
      issues: fixed ? [] : [
        {
          id: 'missing-boundary-case',
          severity: 'error',
          message: 'The plan does not cover the invalid 21-character password boundary.',
          suggestion: 'Add a rejected request with a 21-character password.',
        },
      ],
    },
    extraContext: { source: 'deterministic native-loop demo' },
  },
}];`;

const workflow = {
	name: '04-Native Loop Engineering',
	nodes: [
		{
			id: ids.trigger,
			name: 'Manual Trigger',
			type: 'n8n-nodes-base.manualTrigger',
			typeVersion: 1,
			parameters: {},
			position: [0, 0],
		},
		{
			id: ids.input,
			name: 'Pre-Loop Input',
			type: 'n8n-nodes-base.code',
			typeVersion: 2,
			parameters: {
				mode: 'runOnceForAllItems',
				jsCode:
					"return [{ json: { api: { method: 'POST', path: '/register' }, note: 'This node must run once.' } }];",
			},
			position: [220, 0],
		},
		{
			id: ids.goal,
			name: 'Goal Loop',
			type: 'n8n-nodes-base.goalLoop',
			typeVersion: 1,
			parameters: {
				goal: 'Improve the registration API test plan until all required checks and the review pass.',
				constraints:
					'Do not invent undocumented HTTP status codes.\nKeep correct cases from the previous round.',
				acceptanceCriteria:
					'Every test case has an expectedResult field.\nCover the rejected 21-character password boundary.\nReviewer score is at least 80.',
				maxRounds: 3,
				reviewerThreshold: 80,
				stagnationRounds: 2,
				historyWindow: 3,
				additionalContextTemplate: 'API: POST /register',
			},
			position: [500, 0],
		},
		{
			id: ids.body,
			name: 'Writer and Test Fixture',
			type: 'n8n-nodes-base.code',
			typeVersion: 2,
			parameters: { mode: 'runOnceForAllItems', jsCode: bodyCode },
			position: [760, 0],
		},
		{
			id: ids.evaluation,
			name: 'Loop Evaluation',
			type: 'n8n-nodes-base.loopEvaluation',
			typeVersion: 1,
			parameters: {
				artifactField: 'artifact',
				checksField: 'checks',
				reviewerField: 'reviewer',
				extraContextField: 'extraContext',
			},
			position: [1020, 0],
		},
		{
			id: ids.completed,
			name: 'Completed',
			type: 'n8n-nodes-base.noOp',
			typeVersion: 1,
			parameters: {},
			position: [780, -220],
		},
		{
			id: ids.stopped,
			name: 'Stopped',
			type: 'n8n-nodes-base.noOp',
			typeVersion: 1,
			parameters: {},
			position: [780, 220],
		},
	],
	connections: {
		'Manual Trigger': {
			main: [[{ node: 'Pre-Loop Input', type: 'main', index: 0 }]],
		},
		'Pre-Loop Input': {
			main: [[{ node: 'Goal Loop', type: 'main', index: 0 }]],
		},
		'Goal Loop': {
			main: [
				[{ node: 'Writer and Test Fixture', type: 'main', index: 0 }],
				[{ node: 'Completed', type: 'main', index: 0 }],
				[{ node: 'Stopped', type: 'main', index: 0 }],
			],
		},
		'Writer and Test Fixture': {
			main: [[{ node: 'Loop Evaluation', type: 'main', index: 0 }]],
		},
		'Loop Evaluation': {
			main: [[{ node: 'Goal Loop', type: 'main', index: 0 }]],
		},
	},
	nodeGroups: [
		{
			id: ids.group,
			name: 'Native Test Plan Loop',
			description: 'Goal, evidence, review, bounded retry, and exit are managed by the platform.',
			nodeIds: [ids.goal, ids.body, ids.evaluation],
			kind: 'loop',
			loop: {
				version: 1,
				controllerNodeId: ids.goal,
				evaluatorNodeId: ids.evaluation,
			},
		},
	],
	settings: { executionOrder: 'v1', saveManualExecutions: true },
	active: false,
	pinData: {},
	tags: [],
};

const output = path.join(__dirname, '..', 'workflows', 'loop-engineering', '04-native-loop.json');
fs.writeFileSync(output, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${output}`);
