import { z } from 'zod';

export const AGENT_SKILL_INSTRUCTIONS_MAX_LENGTH = 65_536;
export const AGENT_SKILL_REFERENCE_MAX_COUNT = 128;
export const AGENT_SKILL_REFERENCE_CONTENT_MAX_BYTES = 65_536;
export const AGENT_SKILL_REFERENCES_TOTAL_MAX_BYTES = 262_144;
export const AGENT_SKILL_LINKED_FILE_MAX_COUNT = 128;
export const AGENT_SKILL_LINKED_FILE_CONTENT_MAX_BYTES = 524_288;
export const AGENT_SKILL_LINKED_FILES_TOTAL_MAX_BYTES = 2_097_152;
export const AGENT_SKILL_LINKED_FILE_GROUPS = [
	'references',
	'templates',
	'scripts',
	'assets',
	'examples',
	'other',
] as const;

const agentSkillStringArraySchema = z.array(z.string().trim().min(1));

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength;

const isSafeLinkedFilePath = (path: string) => {
	const normalized = path.replaceAll('\\', '/');
	const segments = normalized.split('/');
	return (
		path === normalized &&
		!normalized.startsWith('/') &&
		normalized !== 'SKILL.md' &&
		segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
	);
};

function linkedFileSchema(group: (typeof AGENT_SKILL_LINKED_FILE_GROUPS)[number]) {
	return z
		.object({
			path: z
				.string()
				.min(1)
				.max(512)
				.refine(
					(path) =>
						isSafeLinkedFilePath(path) &&
						(group === 'other'
							? !AGENT_SKILL_LINKED_FILE_GROUPS.some(
									(candidate) => candidate !== 'other' && path.startsWith(`${candidate}/`),
								)
							: path.startsWith(`${group}/`)) &&
						(group !== 'references' || /\.(md|markdown)$/i.test(path)),
					group === 'references'
						? 'Reference path must be a markdown file under references/'
						: group === 'other'
							? 'Linked file path must be safe and relative to the skill directory'
							: `Linked file path must be under ${group}/`,
				),
			content: z.string().min(1),
		})
		.strict()
		.superRefine((file, ctx) => {
			const maxBytes =
				group === 'references'
					? AGENT_SKILL_REFERENCE_CONTENT_MAX_BYTES
					: AGENT_SKILL_LINKED_FILE_CONTENT_MAX_BYTES;
			if (utf8ByteLength(file.content) > maxBytes) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Linked file content must be ${maxBytes} bytes or fewer`,
					path: ['content'],
				});
			}
		});
}

function linkedFileArraySchema(group: (typeof AGENT_SKILL_LINKED_FILE_GROUPS)[number]) {
	const maxCount =
		group === 'references' ? AGENT_SKILL_REFERENCE_MAX_COUNT : AGENT_SKILL_LINKED_FILE_MAX_COUNT;
	const maxBytes =
		group === 'references'
			? AGENT_SKILL_REFERENCES_TOTAL_MAX_BYTES
			: AGENT_SKILL_LINKED_FILES_TOTAL_MAX_BYTES;

	return z
		.array(linkedFileSchema(group))
		.max(maxCount)
		.superRefine((files, ctx) => {
			const paths = new Set<string>();
			let totalBytes = 0;
			for (const [index, file] of files.entries()) {
				totalBytes += utf8ByteLength(file.content);
				if (paths.has(file.path)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Duplicate linked file path "${file.path}"`,
						path: [index, 'path'],
					});
				}
				paths.add(file.path);
			}
			if (totalBytes > maxBytes) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Linked files must total ${maxBytes} bytes or fewer`,
				});
			}
		});
}

const agentSkillReferencesSchema = linkedFileArraySchema('references');
const agentSkillTemplatesSchema = linkedFileArraySchema('templates');
const agentSkillScriptsSchema = linkedFileArraySchema('scripts');
const agentSkillAssetsSchema = linkedFileArraySchema('assets');
const agentSkillExamplesSchema = linkedFileArraySchema('examples');
const agentSkillOtherFilesSchema = linkedFileArraySchema('other');

/**
 * Persisted, user-editable body of a skill. Membership lives in the agent
 * config as `{ type: 'skill', id }` refs.
 */
export const agentSkillShape = {
	name: z.string().min(1).max(128),
	description: z.string().min(1).max(512),
	instructions: z
		.string()
		.min(1)
		.refine((value) => utf8ByteLength(value) <= AGENT_SKILL_INSTRUCTIONS_MAX_LENGTH, {
			message: `Instructions must be ${AGENT_SKILL_INSTRUCTIONS_MAX_LENGTH} bytes or fewer`,
		}),
	allowedTools: agentSkillStringArraySchema.optional(),
	references: agentSkillReferencesSchema.optional(),
	templates: agentSkillTemplatesSchema.optional(),
	scripts: agentSkillScriptsSchema.optional(),
	assets: agentSkillAssetsSchema.optional(),
	examples: agentSkillExamplesSchema.optional(),
	other: agentSkillOtherFilesSchema.optional(),
};

export const agentSkillSchema = z.object(agentSkillShape).strict();
