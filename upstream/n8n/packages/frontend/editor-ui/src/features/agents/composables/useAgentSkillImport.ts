import { parse as parseYaml } from 'yaml';
import {
	AGENT_SKILL_LINKED_FILE_CONTENT_MAX_BYTES,
	AGENT_SKILL_LINKED_FILE_MAX_COUNT,
	AGENT_SKILL_LINKED_FILES_TOTAL_MAX_BYTES,
	AGENT_SKILL_REFERENCE_CONTENT_MAX_BYTES,
	AGENT_SKILL_REFERENCE_MAX_COUNT,
	AGENT_SKILL_REFERENCES_TOTAL_MAX_BYTES,
} from '@n8n/api-types';
import type { BaseTextKey } from '@n8n/i18n';

import type { AgentSkill, AgentSkillFile, AgentSkillLinkedFileGroup } from '../types';
import { AGENT_SKILL_FILE_GROUPS } from '../utils/agentSkillFiles';

const SKILL_FILE_NAME = 'SKILL.md';
const FRONTMATTER_DELIMITER = '---';
const TEXT_EXTENSIONS = new Set([
	'',
	'.adoc',
	'.bib',
	'.c',
	'.cfg',
	'.conf',
	'.cpp',
	'.css',
	'.csv',
	'.go',
	'.h',
	'.hpp',
	'.htm',
	'.html',
	'.ini',
	'.ipynb',
	'.java',
	'.js',
	'.json',
	'.jsonl',
	'.jsx',
	'.kt',
	'.log',
	'.lua',
	'.md',
	'.markdown',
	'.mjs',
	'.php',
	'.properties',
	'.ps1',
	'.py',
	'.rb',
	'.rs',
	'.rst',
	'.scss',
	'.sh',
	'.sql',
	'.svg',
	'.tex',
	'.toml',
	'.ts',
	'.tsv',
	'.tsx',
	'.txt',
	'.vue',
	'.xml',
	'.yaml',
	'.yml',
]);
const IGNORED_PATH_SEGMENTS = new Set(['.git', '.github', 'node_modules', '__pycache__']);
const SENSITIVE_FILE_NAMES = new Set(['.env', '.npmrc', '.pypirc']);

export class AgentSkillImportError extends Error {
	constructor(readonly i18nKey: BaseTextKey) {
		super(i18nKey);
	}
}

type SkillFrontmatter = {
	name?: unknown;
	description?: unknown;
	allowed_tools?: unknown;
};

export interface AgentSkillImportResult {
	skill: AgentSkill;
	skippedFiles: string[];
}

export function useAgentSkillImport() {
	async function importSkillFiles(files: File[]): Promise<AgentSkillImportResult> {
		if (files.length === 0) {
			throw new AgentSkillImportError('agents.builder.skills.import.noFiles');
		}

		const fileEntries = files.map((file) => ({
			file,
			path: normalizePath(file.webkitRelativePath || file.name),
		}));
		const skillFile = findSkillFile(fileEntries);
		if (!skillFile) {
			throw new AgentSkillImportError('agents.builder.skills.import.missingSkillFile');
		}

		const skillDir = skillFile.path.slice(0, -SKILL_FILE_NAME.length).replace(/\/$/, '');
		const skillContent = await readFileText(skillFile.file);
		const parsed = parseSkillMarkdown(skillContent);
		const linkedFiles: Record<AgentSkillLinkedFileGroup, AgentSkillFile[]> = {
			references: [],
			templates: [],
			scripts: [],
			assets: [],
			examples: [],
			other: [],
		};
		const skippedFiles: string[] = [];
		const seenPaths = new Set<string>();
		let totalBytes = 0;

		for (const entry of fileEntries) {
			if (entry === skillFile) continue;
			const relativePath = pathRelativeToSkillDir(entry.path, skillDir);
			if (!relativePath || relativePath === SKILL_FILE_NAME) continue;
			if (shouldIgnorePath(relativePath) || !isSupportedTextPath(relativePath)) {
				skippedFiles.push(relativePath);
				continue;
			}

			const group = groupForPath(relativePath);
			if (group === 'references' && !isMarkdownPath(relativePath)) {
				skippedFiles.push(relativePath);
				continue;
			}
			if (seenPaths.has(relativePath)) {
				throw new AgentSkillImportError(
					'agents.builder.skills.import.duplicateLinkedFile' as BaseTextKey,
				);
			}
			if (seenPaths.size >= AGENT_SKILL_LINKED_FILE_MAX_COUNT) {
				throw new AgentSkillImportError(
					'agents.builder.skills.import.tooManyLinkedFiles' as BaseTextKey,
				);
			}
			if (
				group === 'references' &&
				linkedFiles.references.length >= AGENT_SKILL_REFERENCE_MAX_COUNT
			) {
				throw new AgentSkillImportError('agents.builder.skills.import.tooManyReferences');
			}

			const maxBytes =
				group === 'references'
					? AGENT_SKILL_REFERENCE_CONTENT_MAX_BYTES
					: AGENT_SKILL_LINKED_FILE_CONTENT_MAX_BYTES;
			if (entry.file.size > maxBytes) {
				throw new AgentSkillImportError(
					'agents.builder.skills.import.linkedFileTooLarge' as BaseTextKey,
				);
			}

			const content = await readFileText(entry.file);
			if (!content || content.includes('\0')) {
				skippedFiles.push(relativePath);
				continue;
			}
			const bytes = new TextEncoder().encode(content).byteLength;
			if (bytes > maxBytes) {
				throw new AgentSkillImportError(
					'agents.builder.skills.import.linkedFileTooLarge' as BaseTextKey,
				);
			}
			totalBytes += bytes;
			if (totalBytes > AGENT_SKILL_LINKED_FILES_TOTAL_MAX_BYTES) {
				throw new AgentSkillImportError(
					'agents.builder.skills.import.linkedFilesTooLarge' as BaseTextKey,
				);
			}
			if (
				group === 'references' &&
				linkedFiles.references.reduce((total, file) => total + utf8Bytes(file.content), 0) + bytes >
					AGENT_SKILL_REFERENCES_TOTAL_MAX_BYTES
			) {
				throw new AgentSkillImportError('agents.builder.skills.import.referencesTooLarge');
			}

			seenPaths.add(relativePath);
			linkedFiles[group].push({ path: relativePath, content });
		}

		return {
			skill: {
				...parsed,
				...Object.fromEntries(
					AGENT_SKILL_FILE_GROUPS.flatMap((group) =>
						linkedFiles[group].length > 0 ? [[group, linkedFiles[group]]] : [],
					),
				),
			},
			skippedFiles: skippedFiles.sort(),
		};
	}

	return { importSkillFiles };
}

function findSkillFile(entries: Array<{ file: File; path: string }>) {
	return entries
		.filter((entry) => entry.path === SKILL_FILE_NAME || entry.path.endsWith(`/${SKILL_FILE_NAME}`))
		.sort((left, right) => pathDepth(left.path) - pathDepth(right.path))[0];
}

function pathDepth(path: string): number {
	return path.split('/').length;
}

function pathRelativeToSkillDir(path: string, skillDir: string): string | null {
	if (!skillDir) return path;
	if (!path.startsWith(`${skillDir}/`)) return null;
	return path.slice(skillDir.length + 1);
}

function parseSkillMarkdown(content: string): AgentSkill {
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
		throw new AgentSkillImportError('agents.builder.skills.import.missingFrontmatter');
	}
	const endIndex = lines.findIndex(
		(line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER,
	);
	if (endIndex === -1) {
		throw new AgentSkillImportError('agents.builder.skills.import.invalidFrontmatter');
	}

	const data = parseYaml(lines.slice(1, endIndex).join('\n')) as SkillFrontmatter | null;
	if (!isRecord(data)) {
		throw new AgentSkillImportError('agents.builder.skills.import.invalidFrontmatter');
	}

	const name = readRequiredString(data.name, 'name');
	const description = readRequiredString(data.description, 'description');
	const instructions = lines
		.slice(endIndex + 1)
		.join('\n')
		.trim();
	if (!instructions) {
		throw new AgentSkillImportError('agents.builder.skills.validation.instructionsRequired');
	}

	return {
		name,
		description,
		instructions,
		...optionalStringArrayField('allowedTools', data.allowed_tools),
	};
}

function readRequiredString(value: unknown, field: 'name' | 'description'): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new AgentSkillImportError(
			field === 'name'
				? 'agents.builder.skills.import.missingName'
				: 'agents.builder.skills.import.missingDescription',
		);
	}
	return value.trim();
}

function optionalStringArrayField(field: 'allowedTools', value: unknown) {
	if (typeof value === 'string' && value.trim()) return { [field]: [value.trim()] };
	return optionalStringArrayProperty(field, value);
}

function optionalStringArrayProperty<T extends string>(
	field: T,
	value: unknown,
): Partial<Record<T, string[]>> {
	if (!Array.isArray(value)) return {};
	const strings = value.filter(
		(item): item is string => typeof item === 'string' && Boolean(item.trim()),
	);
	return strings.length > 0
		? ({ [field]: strings.map((item) => item.trim()) } as Partial<Record<T, string[]>>)
		: {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
	return path.replaceAll('\\', '/').replace(/^\/+/, '');
}

function groupForPath(path: string): AgentSkillLinkedFileGroup {
	const topLevelDirectory = path.split('/')[0];
	if (AGENT_SKILL_FILE_GROUPS.includes(topLevelDirectory as AgentSkillLinkedFileGroup)) {
		return topLevelDirectory as AgentSkillLinkedFileGroup;
	}
	return 'other';
}

function shouldIgnorePath(path: string): boolean {
	const segments = path.split('/');
	const fileName = segments.at(-1)?.toLowerCase() ?? '';
	return (
		segments.some((segment) => IGNORED_PATH_SEGMENTS.has(segment)) ||
		SENSITIVE_FILE_NAMES.has(fileName) ||
		fileName.startsWith('.env.')
	);
}

function isSupportedTextPath(path: string): boolean {
	const fileName = path.split('/').at(-1) ?? '';
	const dotIndex = fileName.lastIndexOf('.');
	const extension = dotIndex > 0 ? fileName.slice(dotIndex).toLowerCase() : '';
	return TEXT_EXTENSIONS.has(extension);
}

function isMarkdownPath(path: string): boolean {
	return /\.(md|markdown)$/i.test(path);
}

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

async function readFileText(file: File): Promise<string> {
	if (typeof file.text === 'function') return await file.text();
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
		reader.readAsText(file);
	});
}
