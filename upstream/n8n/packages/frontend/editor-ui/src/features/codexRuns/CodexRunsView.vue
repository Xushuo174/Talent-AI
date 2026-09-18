<script setup lang="ts">
import type { CodexRunsOverview, CodexRunStatus } from '@n8n/api-types';
import {
	N8nCard,
	N8nHeading,
	N8nLoading2,
	N8nNotice,
	N8nOption,
	N8nSelect,
	N8nText,
} from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { useRootStore } from '@n8n/stores/useRootStore';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import { convertToDisplayDate } from '@/app/utils/formatters/dateFormatter';

import { fetchCodexRunsOverview } from './codexRuns.api';

const RECENT_RUN_LIMIT = 25;

const route = useRoute();
const rootStore = useRootStore();
const i18n = useI18n();

const overview = ref<CodexRunsOverview>();
const selectedStatus = ref<CodexRunStatus | ''>('');
const loading = ref(false);
const loadFailed = ref(false);

const projectId = computed(() => String(route.params.projectId ?? ''));

const statusOptions: Array<{ value: CodexRunStatus | ''; label: string }> = [
	{ value: '', label: i18n.baseText('codexRuns.filter.all') },
	{ value: 'preparing', label: i18n.baseText('codexRuns.status.preparing') },
	{ value: 'running', label: i18n.baseText('codexRuns.status.running') },
	{ value: 'completed', label: i18n.baseText('codexRuns.status.completed') },
	{
		value: 'verification_failed',
		label: i18n.baseText('codexRuns.status.verificationFailed'),
	},
	{ value: 'policy_blocked', label: i18n.baseText('codexRuns.status.policyBlocked') },
	{ value: 'timed_out', label: i18n.baseText('codexRuns.status.timedOut') },
	{ value: 'cancelled', label: i18n.baseText('codexRuns.status.cancelled') },
	{ value: 'runtime_failed', label: i18n.baseText('codexRuns.status.runtimeFailed') },
];

const summaryCards = computed(() => [
	{ label: i18n.baseText('codexRuns.stats.total'), value: overview.value?.stats.total ?? 0 },
	{
		label: i18n.baseText('codexRuns.stats.succeeded'),
		value: overview.value?.stats.succeeded ?? 0,
	},
	{ label: i18n.baseText('codexRuns.stats.failed'), value: overview.value?.stats.failed ?? 0 },
	{
		label: i18n.baseText('codexRuns.stats.averageDuration'),
		value: formatDuration(overview.value?.stats.averageDurationMs ?? 0),
	},
]);

const distribution = computed(() => {
	const counts = overview.value?.statusCounts ?? [];
	const total = overview.value?.stats.total ?? 0;
	return counts.map((item) => ({
		...item,
		percentage: total === 0 ? 0 : (item.count / total) * 100,
	}));
});

async function loadOverview() {
	if (!projectId.value) return;
	loading.value = true;
	loadFailed.value = false;
	try {
		overview.value = await fetchCodexRunsOverview(rootStore.restApiContext, projectId.value, {
			limit: RECENT_RUN_LIMIT,
			...(selectedStatus.value ? { status: selectedStatus.value } : {}),
		});
	} catch {
		loadFailed.value = true;
	} finally {
		loading.value = false;
	}
}

function formatDuration(durationMs: number | null): string {
	if (durationMs === null) return i18n.baseText('codexRuns.duration.running');
	if (durationMs < 1000) return `${durationMs}ms`;
	if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
	const minutes = Math.floor(durationMs / 60_000);
	const seconds = Math.floor((durationMs % 60_000) / 1000);
	return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatDate(value: string): string {
	const { date, time } = convertToDisplayDate(value);
	return `${date} ${time}`;
}

function statusLabel(status: CodexRunStatus): string {
	return statusOptions.find((option) => option.value === status)?.label ?? status;
}

function statusClass(status: CodexRunStatus): string {
	if (status === 'completed') return 'success';
	if (status === 'preparing' || status === 'running') return 'active';
	return 'failed';
}

watch([projectId, selectedStatus], loadOverview);
onMounted(loadOverview);
</script>

<template>
	<main :class="$style.container" data-test-id="codex-runs-view">
		<header :class="$style.header">
			<div>
				<N8nHeading tag="h1" size="2xlarge">{{ i18n.baseText('codexRuns.title') }}</N8nHeading>
				<N8nText color="text-light">{{ i18n.baseText('codexRuns.description') }}</N8nText>
			</div>
			<N8nSelect
				v-model="selectedStatus"
				:class="$style.statusFilter"
				:placeholder="i18n.baseText('codexRuns.filter.label')"
				data-test-id="codex-runs-status-filter"
			>
				<N8nOption
					v-for="option in statusOptions"
					:key="option.value || 'all'"
					:label="option.label"
					:value="option.value"
				/>
			</N8nSelect>
		</header>

		<N8nNotice v-if="loadFailed" type="warning" :class="$style.notice">
			{{ i18n.baseText('codexRuns.loadError') }}
		</N8nNotice>
		<N8nLoading2 v-else-if="loading && !overview" :rows="6" :shrink-last="false" />
		<template v-else>
			<section :class="$style.cards" :aria-label="i18n.baseText('codexRuns.stats.label')">
				<N8nCard v-for="card in summaryCards" :key="card.label" :class="$style.summaryCard">
					<N8nText size="small" color="text-light">{{ card.label }}</N8nText>
					<N8nHeading tag="p" size="xlarge">{{ card.value }}</N8nHeading>
				</N8nCard>
			</section>

			<section :class="$style.section">
				<N8nHeading tag="h2" size="large">{{ i18n.baseText('codexRuns.distribution') }}</N8nHeading>
				<div v-if="distribution.length" :class="$style.distribution">
					<div v-for="item in distribution" :key="item.status" :class="$style.distributionRow">
						<div :class="$style.distributionLabel">
							<N8nText size="small">{{ statusLabel(item.status) }}</N8nText>
							<N8nText size="small" color="text-light">{{ item.count }}</N8nText>
						</div>
						<div :class="$style.track">
							<div
								:class="[$style.bar, $style[statusClass(item.status)]]"
								:style="{ width: `${item.percentage}%` }"
							/>
						</div>
					</div>
				</div>
				<N8nText v-else color="text-light">{{ i18n.baseText('codexRuns.empty') }}</N8nText>
			</section>

			<section :class="$style.section">
				<N8nHeading tag="h2" size="large">{{ i18n.baseText('codexRuns.recent') }}</N8nHeading>
				<div v-if="overview?.recentRuns.length" :class="$style.runList">
					<N8nCard v-for="run in overview.recentRuns" :key="run.id" :class="$style.runCard">
						<div :class="$style.runHeader">
							<div>
								<N8nText bold>{{ run.repositoryId }}</N8nText>
								<N8nText size="small" color="text-light">{{ run.branchName }}</N8nText>
							</div>
							<span :class="[$style.status, $style[statusClass(run.status)]]">
								{{ statusLabel(run.status) }}
							</span>
						</div>
						<div :class="$style.runMeta">
							<N8nText size="small" color="text-light">{{ formatDate(run.startedAt) }}</N8nText>
							<N8nText size="small" color="text-light">{{ formatDuration(run.durationMs) }}</N8nText>
							<N8nText size="small" color="text-light">
								{{ i18n.baseText('codexRuns.turns', { interpolate: { count: run.turnCount } }) }}
							</N8nText>
						</div>
					</N8nCard>
				</div>
				<N8nText v-else color="text-light">{{ i18n.baseText('codexRuns.empty') }}</N8nText>
			</section>
		</template>
	</main>
</template>

<style lang="scss" module>
.container {
	width: 100%;
	max-width: 1100px;
	margin: 0 auto;
	padding: var(--spacing--xl);
	overflow: auto;
}

.header,
.runHeader,
.distributionLabel,
.runMeta {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.header {
	gap: var(--spacing--lg);
	margin-bottom: var(--spacing--lg);
}

.statusFilter {
	width: 220px;
	flex-shrink: 0;
}

.notice {
	margin-bottom: var(--spacing--lg);
}

.cards {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: var(--spacing--sm);
}

.summaryCard :global(.n8n-card__content),
.runCard :global(.n8n-card__content) {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
}

.section {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--sm);
	margin-top: var(--spacing--xl);
}

.distribution,
.runList {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--2xs);
}

.distributionRow {
	display: grid;
	grid-template-columns: 190px 1fr;
	align-items: center;
	gap: var(--spacing--sm);
}

.track {
	height: var(--spacing--2xs);
	background: var(--color--background--light-2);
	border-radius: var(--border-radius--base);
	overflow: hidden;
}

.bar {
	height: 100%;
	min-width: var(--spacing--5xs);
}

.success {
	background: var(--color--success);
}

.failed {
	background: var(--color--danger);
}

.active {
	background: var(--color--warning);
}

.runHeader > div {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--5xs);
	min-width: 0;
}

.status {
	padding: var(--spacing--5xs) var(--spacing--2xs);
	border-radius: var(--border-radius--base);
	color: var(--color--text--shade-2);
	font-size: var(--font-size--xs);
}

.runMeta {
	justify-content: flex-start;
	gap: var(--spacing--lg);
}

@media (max-width: 900px) {
	.cards {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.header {
		align-items: flex-start;
		flex-direction: column;
	}
}
</style>
