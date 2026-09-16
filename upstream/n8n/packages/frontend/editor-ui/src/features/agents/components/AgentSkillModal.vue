<script setup lang="ts">
import { computed, ref } from 'vue';
import {
	AGENT_SKILL_INSTRUCTIONS_MAX_LENGTH,
	AGENT_SKILL_LINKED_FILE_CONTENT_MAX_BYTES,
	AGENT_SKILL_LINKED_FILE_MAX_COUNT,
	AGENT_SKILL_LINKED_FILES_TOTAL_MAX_BYTES,
	AGENT_SKILL_REFERENCE_MAX_COUNT,
} from '@n8n/api-types';
import { N8nButton, N8nCallout, N8nHeading, N8nIcon } from '@n8n/design-system';
import { useI18n, type BaseTextKey } from '@n8n/i18n';

import Modal from '@/app/components/Modal.vue';
import { useToast } from '@n8n/composables/useToast';
import { useUIStore } from '@/app/stores/ui.store';
import { useAgentTelemetry } from '../composables/useAgentTelemetry';
import type { AgentSkill, AgentSkillLinkedFileGroup } from '../types';
import { normalizeAgentSkillForSave } from '../utils/agentSkill';
import {
	AGENT_SKILL_FILE_GROUPS,
	findAgentSkillFile,
	getAgentSkillFiles,
} from '../utils/agentSkillFiles';
import AgentSkillFileNav from './AgentSkillFileNav.vue';
import AgentSkillViewer, { type AgentSkillAllowedToolOption } from './AgentSkillViewer.vue';

const SKILL_FILE = 'SKILL.md';

export type AgentSkillModalData = {
	projectId: string;
	agentId: string;
	skill?: AgentSkill;
	skillId?: string;
	availableTools?: AgentSkillAllowedToolOption[];
	/**
	 * Names of the agent's other skills, so a duplicate name blocks save while
	 * the modal is still open — skill names must be unique per agent.
	 */
	existingSkillNames?: string[];
	onConfirm: (payload: { id?: string; skill: AgentSkill }) => void;
	onRemove?: (id: string) => void;
};

const props = defineProps<{
	modalName: string;
	data: AgentSkillModalData;
}>();

const i18n = useI18n();
const uiStore = useUIStore();
const agentTelemetry = useAgentTelemetry();
const { showMessage } = useToast();

const skill = ref<AgentSkill>(
	normalizeSkill({
		name: props.data.skill?.name ?? '',
		description: props.data.skill?.description ?? '',
		instructions: props.data.skill?.instructions ?? '',
		...(props.data.skill?.allowedTools ? { allowedTools: props.data.skill.allowedTools } : {}),
		...Object.fromEntries(
			AGENT_SKILL_FILE_GROUPS.flatMap((group) =>
				props.data.skill?.[group] ? [[group, props.data.skill[group]]] : [],
			),
		),
	}),
);
const submitted = ref(false);
const formIsValid = ref(false);
const selectedPath = ref(SKILL_FILE);

const isEditing = computed(() => !!props.data.skillId);
const canAddReference = computed(
	() => (skill.value.references ?? []).length < AGENT_SKILL_REFERENCE_MAX_COUNT,
);
// A skill saved through this modal always has instructions (required below), so
// empty instructions on an existing ref mean its stored content is gone — the
// backend validation issue this modal opened from. Detected from the opening
// data rather than threaded validation state, so it stays correct even if this
// modal is ever opened from a surface that doesn't know about validation issues.
const openedWithMissingContent = computed(
	() => isEditing.value && !(props.data.skill?.instructions ?? '').trim(),
);

const validationErrors = computed<Partial<Record<keyof AgentSkill, string>>>(() => {
	const errors: Partial<Record<keyof AgentSkill, string>> = {};
	const name = skill.value.name.trim();
	const description = skill.value.description.trim();
	const instructions = skill.value.instructions.trim();

	if (!name) {
		errors.name = i18n.baseText('agents.builder.skills.validation.nameRequired');
	} else if (name.length > 128) {
		errors.name = i18n.baseText('agents.builder.skills.validation.nameMaxLength');
	}

	if (!description) {
		errors.description = i18n.baseText('agents.builder.skills.validation.descriptionRequired');
	} else if (description.length > 512) {
		errors.description = i18n.baseText('agents.builder.skills.validation.descriptionMaxLength');
	}

	if (!instructions) {
		errors.instructions = i18n.baseText('agents.builder.skills.validation.instructionsRequired');
	} else if (
		new TextEncoder().encode(skill.value.instructions).byteLength >
		AGENT_SKILL_INSTRUCTIONS_MAX_LENGTH
	) {
		errors.instructions = i18n.baseText('agents.builder.skills.validation.instructionsMaxLength', {
			interpolate: { max: String(AGENT_SKILL_INSTRUCTIONS_MAX_LENGTH) },
		});
	}
	if (skill.value.references?.some((reference) => !reference.content.trim())) {
		errors.references = i18n.baseText('agents.builder.skills.references.invalidSummary');
	}
	for (const group of AGENT_SKILL_FILE_GROUPS) {
		if (
			getAgentSkillFiles(skill.value, group).some(
				(file) =>
					!file.content.trim() ||
					new TextEncoder().encode(file.content).byteLength >
						AGENT_SKILL_LINKED_FILE_CONTENT_MAX_BYTES,
			)
		) {
			errors[group] = i18n.baseText('agents.builder.skills.files.invalidSummary' as BaseTextKey);
		}
	}
	const allFiles = AGENT_SKILL_FILE_GROUPS.flatMap((group) =>
		getAgentSkillFiles(skill.value, group),
	);
	if (
		allFiles.length > AGENT_SKILL_LINKED_FILE_MAX_COUNT ||
		allFiles.reduce((total, file) => total + new TextEncoder().encode(file.content).byteLength, 0) >
			AGENT_SKILL_LINKED_FILES_TOTAL_MAX_BYTES
	) {
		errors.other = i18n.baseText('agents.builder.skills.files.invalidSummary' as BaseTextKey);
	}

	return errors;
});

const visibleErrors = computed(() =>
	submitted.value || openedWithMissingContent.value ? validationErrors.value : {},
);
const canSave = computed(() => formIsValid.value);

function onSkillUpdate(updates: Partial<AgentSkill>) {
	skill.value = normalizeSkill({ ...skill.value, ...updates });
	if (selectedPath.value !== SKILL_FILE && !findAgentSkillFile(skill.value, selectedPath.value)) {
		selectedPath.value = SKILL_FILE;
	}
}

function normalizeSkill(skill: AgentSkill): AgentSkill {
	return normalizeAgentSkillForSave(
		skill,
		props.data.availableTools?.map((tool) => tool.name),
	);
}

function onAddReference() {
	if (!canAddReference.value) return;

	const path = nextReferencePath(skill.value.references ?? []);
	skill.value = {
		...skill.value,
		references: [...(skill.value.references ?? []), { path, content: '' }],
	};
	selectedPath.value = path;
}

function onRemoveFile(group: AgentSkillLinkedFileGroup, path: string) {
	skill.value = {
		...skill.value,
		[group]: getAgentSkillFiles(skill.value, group).filter((file) => file.path !== path),
	};
	if (selectedPath.value === path) {
		selectedPath.value = SKILL_FILE;
	}
}

function nextReferencePath(references: NonNullable<AgentSkill['references']>): string {
	const existingPaths = new Set(references.map((reference) => reference.path));
	let index = 1;
	let path = 'references/reference.md';
	while (existingPaths.has(path)) {
		index += 1;
		path = `references/reference-${index}.md`;
	}
	return path;
}

function onValidUpdate(valid: boolean) {
	formIsValid.value = valid;
}

function onImportSkill(payload: {
	source: 'skill_file' | 'folder';
	status: 'success' | 'error';
	referenceCount?: number;
	error?: string;
}) {
	agentTelemetry.trackImportedSkill({
		agentId: props.data.agentId,
		...payload,
	});
}

function closeModal() {
	uiStore.closeModal(props.modalName);
}

function onSave() {
	submitted.value = true;
	if (!canSave.value) {
		const message = Object.values(validationErrors.value).find(Boolean);
		showMessage({
			title: i18n.baseText('agents.builder.skills.saveError'),
			...(message ? { message } : {}),
			type: 'error',
		});
		return;
	}

	const payload = normalizeSkill({
		name: skill.value.name.trim(),
		description: skill.value.description.trim(),
		instructions: skill.value.instructions,
		...(skill.value.allowedTools ? { allowedTools: skill.value.allowedTools } : {}),
		...Object.fromEntries(
			AGENT_SKILL_FILE_GROUPS.flatMap((group) =>
				skill.value[group] ? [[group, skill.value[group]]] : [],
			),
		),
	});

	props.data.onConfirm({ id: props.data.skillId, skill: payload });
	closeModal();
}

function onRemove() {
	if (!props.data.skillId) return;
	props.data.onRemove?.(props.data.skillId);
	closeModal();
}
</script>

<template>
	<Modal
		:name="props.modalName"
		width="1100px"
		:custom-class="$style.modal"
		data-testid="agent-skill-modal"
	>
		<template #header>
			<N8nHeading tag="h2" size="large">
				{{ i18n.baseText('agents.builder.skills.create.title') }}
			</N8nHeading>
		</template>

		<template #content>
			<N8nCallout
				v-if="openedWithMissingContent"
				theme="warning"
				data-testid="agent-skill-missing-content-callout"
			>
				{{ i18n.baseText('agents.builder.skills.missingContent.callout' as BaseTextKey) }}
			</N8nCallout>
			<div :class="$style.content">
				<AgentSkillFileNav
					:skill="skill"
					:selected-path="selectedPath"
					:add-reference-disabled="!canAddReference"
					@add-reference="onAddReference"
					@remove-file="onRemoveFile"
					@select="selectedPath = $event"
				/>
				<AgentSkillViewer
					:skill="skill"
					:available-tools="props.data.availableTools ?? []"
					:existing-skill-names="props.data.existingSkillNames ?? []"
					:selected-path="selectedPath"
					:errors="visibleErrors"
					:scrollable="false"
					:show-validation-warnings="submitted || openedWithMissingContent"
					@import:skill="onImportSkill"
					@select:path="selectedPath = $event"
					@update:skill="onSkillUpdate"
					@update:valid="onValidUpdate"
				/>
			</div>
		</template>

		<template #footer>
			<div :class="$style.footer">
				<N8nButton
					v-if="isEditing && data.onRemove"
					variant="subtle"
					data-testid="agent-skill-remove"
					@click="onRemove"
				>
					<template #icon><N8nIcon icon="trash-2" :size="16" /></template>
					{{ i18n.baseText('agents.builder.skills.remove') }}
				</N8nButton>
				<div :class="$style.footerActions">
					<N8nButton variant="subtle" @click="closeModal">
						{{ i18n.baseText('agents.builder.skills.create.cancel') }}
					</N8nButton>
					<N8nButton variant="solid" data-testid="agent-skill-create-save" @click="onSave">
						{{ i18n.baseText('agents.builder.skills.create.save') }}
					</N8nButton>
				</div>
			</div>
		</template>
	</Modal>
</template>

<style module>
.content {
	height: 620px;
	min-height: 0;
	margin: 0 calc(-1 * var(--spacing--lg)) calc(-1 * var(--spacing--lg));
	display: flex;
}

.modal {
	:global(.modal-content) {
		overflow: hidden;
	}
}

.footer {
	display: flex;
	justify-content: space-between;
	gap: var(--spacing--2xs);
}

.footerActions {
	display: flex;
	gap: var(--spacing--2xs);
	margin-left: auto;
}
</style>
