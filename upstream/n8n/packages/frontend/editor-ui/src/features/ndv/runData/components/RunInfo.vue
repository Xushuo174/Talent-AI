<script setup lang="ts">
import type { ITaskData } from 'n8n-workflow';
import { convertToDisplayDateComponents } from '@/app/utils/formatters/dateFormatter';
import { computed } from 'vue';
import { useI18n } from '@n8n/i18n';
import { N8nBadge, N8nButton, N8nInfoTip, N8nPopover, N8nText } from '@n8n/design-system';
import { injectWorkflowDocumentStore } from '@/app/stores/workflowDocument.store';
import { useRootStore } from '@n8n/stores/useRootStore';
const i18n = useI18n();
const rootStore = useRootStore();
const workflowDocumentStore = injectWorkflowDocumentStore();

const props = defineProps<{
	taskData: ITaskData | null;
	hasStaleData?: boolean;
	hasPinData?: boolean;
}>();

const runTaskData = computed(() => {
	return props.taskData;
});

const theme = computed(() => {
	return props.taskData?.error ? 'danger' : 'success';
});

const runMetadata = computed(() => {
	if (!runTaskData.value) {
		return null;
	}
	const { date, time } = convertToDisplayDateComponents(runTaskData.value.startTime);
	return {
		executionTime: runTaskData.value.executionTime,
		startTime: `${date} at ${time}`,
	};
});

const codexRun = computed(() => runTaskData.value?.metadata?.codexCoding);

function openDiff() {
	const metadata = codexRun.value;
	const projectId = workflowDocumentStore.value.homeProject?.id;
	if (!metadata?.diffArtifactId || !projectId) return;
	const path = `/codex-coding/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(metadata.runId)}/diff/${encodeURIComponent(metadata.diffArtifactId)}`;
	window.open(`${rootStore.restUrl}${path}`, '_blank', 'noopener');
}
</script>

<template>
	<N8nInfoTip
		v-if="hasStaleData"
		theme="warning-light"
		type="tooltip"
		tooltip-placement="right"
		data-test-id="node-run-info-stale"
	>
		<span
			v-n8n-html="
				i18n.baseText(
					hasPinData
						? 'ndv.output.staleDataWarning.pinData'
						: 'ndv.output.staleDataWarning.regular',
				)
			"
		></span>
	</N8nInfoTip>
	<div v-else-if="runMetadata" :class="$style.tooltipRow">
		<N8nPopover v-if="codexRun" side="bottom" align="start" width="360px">
			<template #trigger>
				<N8nBadge class="nodrag" theme="primary" data-test-id="codex-run-card-trigger">
					{{ i18n.baseText('ndv.codexRun.title') }} · {{ codexRun.status }}
				</N8nBadge>
			</template>
			<template #content>
				<div :class="$style.codexCard" data-test-id="codex-run-card">
					<N8nText bold size="medium">{{ i18n.baseText('ndv.codexRun.title') }}</N8nText>
					<N8nText size="small">Thread: {{ codexRun.threadId }}</N8nText>
					<N8nText size="small">Turn: {{ codexRun.turnId || '—' }}</N8nText>
					<N8nText size="small">Round: {{ codexRun.round }}</N8nText>
					<N8nText size="small">Branch: {{ codexRun.branchName }}</N8nText>
					<N8nText size="small">Base: {{ codexRun.baseCommit.slice(0, 12) }}</N8nText>
					<N8nText size="small">{{ codexRun.diffStat || i18n.baseText('ndv.codexRun.noDiff') }}</N8nText>
					<ul :class="$style.checks">
						<li v-for="check in codexRun.checks" :key="check.id">
							{{ check.passed ? '✓' : '✕' }} {{ check.message }}
						</li>
					</ul>
					<N8nButton
						v-if="codexRun.diffArtifactId && workflowDocumentStore.homeProject?.id"
						size="small"
						type="secondary"
						data-test-id="codex-run-view-diff"
						@click="openDiff"
					>
						{{ i18n.baseText('ndv.codexRun.viewDiff') }}
					</N8nButton>
				</div>
			</template>
		</N8nPopover>
		<N8nInfoTip
			v-if="taskData?.executionStatus !== 'canceled'"
			type="note"
			:theme="theme"
			:data-test-id="`node-run-status-${theme}`"
			size="large"
		/>
		<N8nInfoTip
			type="tooltip"
			theme="info"
			:data-test-id="`node-run-info`"
			tooltip-placement="right"
		>
			<div>
				<N8nText :bold="true" size="small"
					>{{
						runTaskData?.error
							? i18n.baseText('runData.executionStatus.failed')
							: runTaskData?.executionStatus === 'canceled'
								? i18n.baseText('runData.executionStatus.canceled')
								: i18n.baseText('runData.executionStatus.success')
					}} </N8nText
				><br />
				<N8nText :bold="true" size="small">{{ i18n.baseText('runData.startTime') + ':' }}</N8nText>
				{{ runMetadata.startTime }}<br />
				<N8nText :bold="true" size="small">{{
					i18n.baseText('runData.executionTime') + ':'
				}}</N8nText>
				{{ runMetadata.executionTime }} {{ i18n.baseText('runData.ms') }}
			</div>
		</N8nInfoTip>
	</div>
</template>

<style lang="scss" module>
.tooltipRow {
	display: flex;
	column-gap: var(--spacing--4xs);
	align-items: center;
}

.codexCard {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--4xs);
	word-break: break-word;
}

.checks {
	margin: 0;
	padding-left: var(--spacing--l);
}
</style>
