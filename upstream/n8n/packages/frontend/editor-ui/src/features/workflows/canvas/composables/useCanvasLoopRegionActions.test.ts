import { createPinia, setActivePinia } from 'pinia';
import { computed } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	createWorkflowDocumentId,
	useWorkflowDocumentStore,
} from '@/app/stores/workflowDocument.store';
import { createCanvasGraphNode } from '@/features/workflows/canvas/__tests__/utils';

import { useCanvasLoopRegionActions } from './useCanvasLoopRegionActions';

const mocks = vi.hoisted(() => ({
	addNode: vi.fn(),
	createConnection: vi.fn(),
	deleteConnection: vi.fn(),
	requireNodeTypeDescription: vi.fn(() => ({ name: 'node-type' })),
	showMessage: vi.fn(),
	expandSelectionWithSubNodes: vi.fn((ids: string[]) => ids),
	isSelectionExtractable: vi.fn(),
	isSelectionGroupable: vi.fn(() => ({ valid: true })),
}));

vi.mock('@n8n/composables/useToast', () => ({
	useToast: () => ({ showMessage: mocks.showMessage }),
}));

let workflowDocumentStore: ReturnType<typeof useWorkflowDocumentStore>;

vi.mock('@/app/stores/workflowDocument.store', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/app/stores/workflowDocument.store')>();
	return {
		...actual,
		injectWorkflowDocumentStore: () => computed(() => workflowDocumentStore),
	};
});

vi.mock('@/app/composables/useCanvasOperations', () => ({
	useCanvasOperations: () => ({
		addNode: mocks.addNode,
		createConnection: mocks.createConnection,
		deleteConnection: mocks.deleteConnection,
		requireNodeTypeDescription: mocks.requireNodeTypeDescription,
	}),
}));

vi.mock('@/app/composables/useSelectionValidation', () => ({
	useSelectionValidation: () => ({
		expandSelectionWithSubNodes: mocks.expandSelectionWithSubNodes,
		isSelectionExtractable: mocks.isSelectionExtractable,
		isSelectionGroupable: mocks.isSelectionGroupable,
	}),
}));

function workflowNode(id: string, name: string, x: number) {
	return {
		id,
		name,
		type: 'n8n-nodes-base.noOp',
		typeVersion: 1,
		parameters: {},
		position: [x, 0] as [number, number],
	};
}

describe('useCanvasLoopRegionActions', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		workflowDocumentStore = useWorkflowDocumentStore(createWorkflowDocumentId('wf-test'));
		const first = workflowNode('a', 'A', 100);
		const second = workflowNode('b', 'B', 300);
		workflowDocumentStore.addNode(first);
		workflowDocumentStore.addNode(second);
		mocks.isSelectionExtractable.mockReturnValue({
			valid: true,
			subGraph: [first, second],
			subGraphData: { start: 'A', end: 'B' },
		});
		mocks.addNode.mockImplementation((node: { type: string; position: [number, number] }) =>
			node.type === 'n8n-nodes-base.goalLoop'
				? { ...workflowNode('goal', 'Goal Loop', node.position[0]), ...node }
				: { ...workflowNode('evaluation', 'Loop Evaluation', node.position[0]), ...node },
		);
		mocks.addNode.mockClear();
		mocks.createConnection.mockClear();
		mocks.deleteConnection.mockClear();
		mocks.showMessage.mockClear();
	});

	it('wraps a valid body with native controller, evaluator, and feedback connections', () => {
		const selection = computed(() => [
			createCanvasGraphNode({ id: 'a' }),
			createCanvasGraphNode({ id: 'b' }),
		]);
		const { canCreateLoopRegion, createLoopRegion } = useCanvasLoopRegionActions(selection);

		expect(canCreateLoopRegion.value).toBe(true);
		const group = createLoopRegion();

		expect(group).toMatchObject({
			kind: 'loop',
			nodeIds: ['goal', 'a', 'b', 'evaluation'],
			loop: {
				version: 1,
				controllerNodeId: 'goal',
				evaluatorNodeId: 'evaluation',
			},
		});
		expect(mocks.createConnection).toHaveBeenCalledTimes(3);
		expect(mocks.createConnection).toHaveBeenCalledWith(
			expect.objectContaining({ source: 'evaluation', target: 'goal' }),
			expect.objectContaining({ validateNodeGroups: false }),
		);
	});

	it('explains why an invalid selection cannot become a loop region', () => {
		mocks.isSelectionExtractable.mockReturnValue({
			valid: false,
			reason: 'multiple-output-branches',
			node: 'B',
		});
		const selection = computed(() => [createCanvasGraphNode({ id: 'b' })]);
		const { canCreateLoopRegion, createLoopRegion } = useCanvasLoopRegionActions(selection);

		expect(canCreateLoopRegion.value).toBe(true);
		expect(createLoopRegion()).toBeNull();
		expect(mocks.showMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
		expect(mocks.addNode).not.toHaveBeenCalled();
	});
});
