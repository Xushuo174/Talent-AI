<script setup lang="ts">
import { computed } from 'vue';
import { N8nButton, N8nIcon, N8nText } from '@n8n/design-system';
import { useI18n, type BaseTextKey } from '@n8n/i18n';

import type { AgentSkill, AgentSkillLinkedFileGroup } from '../types';
import { AGENT_SKILL_FILE_GROUPS, getAgentSkillFiles } from '../utils/agentSkillFiles';

const SKILL_FILE = 'SKILL.md';

const props = withDefaults(
	defineProps<{
		skill: AgentSkill;
		selectedPath: string;
		addReferenceDisabled?: boolean;
	}>(),
	{
		addReferenceDisabled: false,
	},
);

const emit = defineEmits<{
	select: [path: string];
	'add-reference': [];
	'remove-file': [group: AgentSkillLinkedFileGroup, path: string];
}>();

const i18n = useI18n();
const groups = computed(() =>
	AGENT_SKILL_FILE_GROUPS.flatMap((group) => {
		const files = getAgentSkillFiles(props.skill, group);
		return group === 'references' || files.length > 0 ? [{ group, files }] : [];
	}),
);

function isSelected(path: string) {
	return props.selectedPath === path;
}

function testIdForPath(path: string) {
	const prefix = path.startsWith('references/')
		? 'agent-skill-reference-nav-item'
		: 'agent-skill-file-nav-item';
	return `${prefix}-${path.replace(/[^A-Za-z0-9_-]+/g, '-')}`;
}

function groupTitle(group: AgentSkillLinkedFileGroup): string {
	return i18n.baseText(`agents.builder.skills.files.group.${group}` as BaseTextKey);
}
</script>

<template>
	<nav
		:class="$style.nav"
		:aria-label="i18n.baseText('agents.builder.skills.filesNav.label')"
		data-testid="agent-skill-file-nav"
	>
		<button
			type="button"
			:class="[$style.item, isSelected(SKILL_FILE) && $style.selected]"
			:aria-current="isSelected(SKILL_FILE) ? 'page' : undefined"
			data-testid="agent-skill-file-nav-item"
			@click="emit('select', SKILL_FILE)"
		>
			<N8nIcon icon="file-text" :size="16" :class="$style.icon" />
			<N8nText size="small" :bold="true" :class="$style.path">{{ SKILL_FILE }}</N8nText>
		</button>

		<div v-for="entry in groups" :key="entry.group" :class="$style.section">
			<div :class="$style.sectionHeader">
				<N8nText size="xsmall" color="text-light" :bold="true" :class="$style.sectionTitle">
					{{ groupTitle(entry.group) }}
				</N8nText>
				<N8nButton
					v-if="entry.group === 'references'"
					:class="$style.addReference"
					variant="ghost"
					size="xsmall"
					icon-only
					icon="plus"
					:disabled="props.addReferenceDisabled"
					:aria-label="i18n.baseText('agents.builder.skills.references.add' as BaseTextKey)"
					data-testid="agent-skill-add-reference"
					@click="emit('add-reference')"
				/>
			</div>
			<N8nText
				v-if="entry.group === 'references' && entry.files.length === 0"
				size="xsmall"
				color="text-light"
				:class="$style.sectionTitle"
			>
				{{ i18n.baseText('agents.builder.skills.references.empty') }}
			</N8nText>
			<div
				v-for="file in entry.files"
				:key="file.path"
				:class="[$style.fileRow, isSelected(file.path) && $style.selected]"
			>
				<button
					type="button"
					:class="[$style.item, $style.file]"
					:aria-current="isSelected(file.path) ? 'page' : undefined"
					:aria-label="file.path"
					:data-testid="testIdForPath(file.path)"
					@click="emit('select', file.path)"
				>
					<N8nIcon icon="file-text" :size="16" :class="$style.icon" />
					<N8nText size="small" :class="$style.path">{{ file.path }}</N8nText>
				</button>
				<N8nButton
					:class="$style.removeFile"
					variant="ghost"
					size="xsmall"
					icon-only
					icon="trash-2"
					:aria-label="i18n.baseText('agents.builder.skills.files.remove' as BaseTextKey)"
					:data-testid="`${testIdForPath(file.path)}-remove`"
					@click="emit('remove-file', entry.group, file.path)"
				/>
			</div>
		</div>
	</nav>
</template>

<style module lang="scss">
.nav {
	width: 240px;
	box-sizing: border-box;
	flex-shrink: 0;
	border-right: var(--border-width) var(--border-style) var(--color--foreground);
	padding: var(--spacing--sm);
	display: flex;
	flex-direction: column;
	gap: var(--spacing--sm);
	background: var(--color--background--light);
	overflow-y: auto;
}

.section {
	display: flex;
	flex-direction: column;
	gap: var(--spacing--3xs);
}

.sectionHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: var(--spacing--2xs);
}

.item {
	display: flex;
	align-items: center;
	gap: var(--spacing--2xs);
	width: 100%;
	min-width: 0;
	border: none;
	background: transparent;
	border-radius: var(--border-radius-base);
	color: var(--color--text);
	padding: var(--spacing--2xs);
	text-align: left;
	cursor: pointer;

	&:hover {
		background: var(--color--background--light-2);
	}
}

.icon {
	flex-shrink: 0;
}

.fileRow {
	display: flex;
	align-items: center;
	gap: var(--spacing--3xs);
	width: 100%;
	min-width: 0;
	border-radius: var(--border-radius-base);

	.removeFile {
		opacity: 0;
	}

	&:hover,
	&:focus-within {
		background: var(--color--background--light-2);

		.removeFile {
			opacity: 1;
		}
	}
}

.file {
	flex: 1;
	padding-left: var(--spacing--xs);

	&:hover {
		background: transparent;
	}
}

.sectionTitle {
	padding-inline: var(--spacing--2xs);
}

.addReference,
.removeFile {
	width: var(--spacing--lg);
	height: var(--spacing--lg);
}

.removeFile {
	margin-left: auto;
	margin-right: var(--spacing--2xs);
	flex-shrink: 0;
}

.selected {
	background: var(--color--background--light-2);
}

.path {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
