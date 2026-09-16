import type { GraphNode, Connection } from '@vue-flow/core';
import { useToast } from '@n8n/composables/useToast';
import { useI18n } from '@n8n/i18n';
import { NodeConnectionTypes } from 'n8n-workflow';
import type { MaybeRefOrGetter } from 'vue';
import { computed, toValue } from 'vue';

import { AddNodeGroupCommand } from '@/app/models/history';
import { useCanvasOperations } from '@/app/composables/useCanvasOperations';
import { useSelectionValidation } from '@/app/composables/useSelectionValidation';
import { injectWorkflowDocumentStore } from '@/app/stores/workflowDocument.store';
import { useHistoryStore } from '@/app/stores/history.store';
import { STICKY_NODE_TYPE } from '@/app/constants/nodeTypes';
import { CanvasConnectionMode, isCanvasGroupNode } from '@/features/workflows/canvas/canvas.types';
import {
	createCanvasConnectionHandleString,
	mapLegacyConnectionsToCanvasConnections,
} from '@/features/workflows/canvas/canvas.utils';

const GOAL_LOOP_NODE_TYPE = 'n8n-nodes-base.goalLoop';
const LOOP_EVALUATION_NODE_TYPE = 'n8n-nodes-base.loopEvaluation';
const LOOP_NODE_X_OFFSET = 240;

type LoopRegionCandidate = {
	memberIds: string[];
	entryId: string;
	exitId: string;
	incoming?: Connection;
	outgoing?: Connection;
	controllerPosition: [number, number];
	evaluatorPosition: [number, number];
};

function mainInputHandle(index = 0) {
	return createCanvasConnectionHandleString({
		mode: CanvasConnectionMode.Input,
		type: NodeConnectionTypes.Main,
		index,
	});
}

function mainOutputHandle(index = 0) {
	return createCanvasConnectionHandleString({
		mode: CanvasConnectionMode.Output,
		type: NodeConnectionTypes.Main,
		index,
	});
}

export function useCanvasLoopRegionActions(
	selectedNodes: MaybeRefOrGetter<GraphNode[]>,
	options?: { readOnly?: MaybeRefOrGetter<boolean> },
) {
	const i18n = useI18n();
	const toast = useToast();
	const workflowDocumentStore = injectWorkflowDocumentStore();
	const historyStore = useHistoryStore();
	const canvasOperations = useCanvasOperations();
	const { expandSelectionWithSubNodes, isSelectionExtractable, isSelectionGroupable } =
		useSelectionValidation();

	const isReadOnly = computed(() => toValue(options?.readOnly) ?? false);
	const selectedNodeIds = computed(() =>
		toValue(selectedNodes)
			.filter((node) => !isCanvasGroupNode(node))
			.map((node) => node.id),
	);
	const canCreateLoopRegion = computed(() => !isReadOnly.value && selectedNodeIds.value.length > 0);

	function resolveCandidate(): LoopRegionCandidate | null {
		const store = workflowDocumentStore.value;
		const resolvedIds = selectedNodeIds.value.filter((id) => store.getNodeById(id));
		if (resolvedIds.length === 0) return null;

		const memberIds = expandSelectionWithSubNodes(resolvedIds);
		const extraction = isSelectionExtractable(memberIds);
		const grouping = isSelectionGroupable(memberIds);
		if (!extraction.valid || !grouping.valid) return null;

		const connectableNodes = extraction.subGraph.filter((node) => node.type !== STICKY_NODE_TYPE);
		const entryName = extraction.subGraphData.start ?? connectableNodes[0]?.name;
		const exitName = extraction.subGraphData.end ?? connectableNodes.at(-1)?.name;
		const entry = entryName ? store.getNodeByName(entryName) : undefined;
		const exit = exitName ? store.getNodeByName(exitName) : undefined;
		if (!entry || !exit) return null;

		const memberSet = new Set(memberIds);
		const connections = mapLegacyConnectionsToCanvasConnections(
			store.connectionsBySourceNode,
			store.allNodes,
		);
		const incoming = connections.filter(
			(connection) => !memberSet.has(connection.source) && connection.target === entry.id,
		);
		const outgoing = connections.filter(
			(connection) => connection.source === exit.id && !memberSet.has(connection.target),
		);
		if (incoming.length > 1 || outgoing.length > 1) return null;

		const bodyNodes = memberIds.flatMap((id) => store.getNodeById(id) ?? []);
		const minX = Math.min(...bodyNodes.map((node) => node.position[0]));
		const maxX = Math.max(...bodyNodes.map((node) => node.position[0]));
		const centerY = Math.round(
			bodyNodes.reduce((total, node) => total + node.position[1], 0) / bodyNodes.length,
		);

		return {
			memberIds,
			entryId: entry.id,
			exitId: exit.id,
			incoming: incoming[0],
			outgoing: outgoing[0],
			controllerPosition: [minX - LOOP_NODE_X_OFFSET, centerY],
			evaluatorPosition: [maxX + LOOP_NODE_X_OFFSET, centerY],
		};
	}

	function addConnection(connection: Connection) {
		canvasOperations.createConnection(connection, {
			trackHistory: true,
			validateNodeGroups: false,
		});
	}

	function createLoopRegion() {
		if (!canCreateLoopRegion.value) return null;
		const candidate = resolveCandidate();
		if (!candidate) {
			toast.showMessage({
				type: 'error',
				title: i18n.baseText('canvas.nodeGroup.loop.createError.title'),
				message: i18n.baseText('canvas.nodeGroup.loop.createError.message'),
			});
			return null;
		}

		historyStore.startRecordingUndo();
		try {
			const controller = canvasOperations.addNode(
				{
					type: GOAL_LOOP_NODE_TYPE,
					typeVersion: 1,
					position: candidate.controllerPosition,
					parameters: {},
				},
				canvasOperations.requireNodeTypeDescription(GOAL_LOOP_NODE_TYPE, 1),
				{ trackHistory: true, isAutoAdd: true, openNDV: false },
			);
			const evaluator = canvasOperations.addNode(
				{
					type: LOOP_EVALUATION_NODE_TYPE,
					typeVersion: 1,
					position: candidate.evaluatorPosition,
					parameters: {},
				},
				canvasOperations.requireNodeTypeDescription(LOOP_EVALUATION_NODE_TYPE, 1),
				{ trackHistory: true, isAutoAdd: true, openNDV: false },
			);

			if (candidate.incoming) {
				canvasOperations.deleteConnection(candidate.incoming, {
					trackHistory: true,
					trackBulk: false,
					validateNodeGroups: false,
				});
				addConnection({
					...candidate.incoming,
					target: controller.id,
					targetHandle: mainInputHandle(),
				});
			}

			if (candidate.outgoing) {
				canvasOperations.deleteConnection(candidate.outgoing, {
					trackHistory: true,
					trackBulk: false,
					validateNodeGroups: false,
				});
				addConnection({
					...candidate.outgoing,
					source: controller.id,
					sourceHandle: mainOutputHandle(1),
				});
			}

			addConnection({
				source: controller.id,
				sourceHandle: mainOutputHandle(0),
				target: candidate.entryId,
				targetHandle: mainInputHandle(),
			});
			addConnection({
				source: candidate.exitId,
				sourceHandle: candidate.outgoing?.sourceHandle ?? mainOutputHandle(),
				target: evaluator.id,
				targetHandle: mainInputHandle(),
			});
			addConnection({
				source: evaluator.id,
				sourceHandle: mainOutputHandle(),
				target: controller.id,
				targetHandle: mainInputHandle(),
			});

			const name = workflowDocumentStore.value.getNextDefaultName(
				i18n.baseText('canvas.nodeGroup.loop.defaultTitle'),
			);
			const group = workflowDocumentStore.value.createGroup(
				[controller.id, ...candidate.memberIds, evaluator.id],
				name,
				{
					kind: 'loop',
					loop: {
						version: 1,
						controllerNodeId: controller.id,
						evaluatorNodeId: evaluator.id,
					},
				},
			);
			historyStore.pushCommandToUndo(new AddNodeGroupCommand(group, Date.now()));
			return group;
		} finally {
			historyStore.stopRecordingUndo();
		}
	}

	return { canCreateLoopRegion, createLoopRegion };
}
