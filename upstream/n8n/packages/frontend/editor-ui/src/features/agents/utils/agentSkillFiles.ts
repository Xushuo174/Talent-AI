import { AGENT_SKILL_LINKED_FILE_GROUPS } from '@n8n/api-types';

import type { AgentSkill, AgentSkillFile, AgentSkillLinkedFileGroup } from '../types';

export const AGENT_SKILL_FILE_GROUPS = AGENT_SKILL_LINKED_FILE_GROUPS;

export function getAgentSkillFiles(
	skill: AgentSkill,
	group: AgentSkillLinkedFileGroup,
): AgentSkillFile[] {
	return skill[group] ?? [];
}

export function findAgentSkillFile(
	skill: AgentSkill,
	path: string,
): { group: AgentSkillLinkedFileGroup; file: AgentSkillFile } | undefined {
	for (const group of AGENT_SKILL_FILE_GROUPS) {
		const file = getAgentSkillFiles(skill, group).find((candidate) => candidate.path === path);
		if (file) return { group, file };
	}
	return undefined;
}

export function countAgentSkillFiles(skill: AgentSkill): number {
	return AGENT_SKILL_FILE_GROUPS.reduce(
		(total, group) => total + getAgentSkillFiles(skill, group).length,
		0,
	);
}
