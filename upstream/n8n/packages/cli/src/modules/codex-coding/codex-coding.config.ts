import { Config, Env } from '@n8n/config';
import { z } from 'zod';

const commandSchema = z.object({
	id: z.string().optional(),
	file: z.string().min(1),
	args: z.array(z.string()).default([]),
	cwd: z.string().default('.'),
});

const repositorySchema = z.object({
	id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
	label: z.string().min(1),
	path: z.string().min(1),
	prepareSteps: z.array(commandSchema).default([]),
	verificationProfiles: z.record(z.string(), z.array(commandSchema)),
});

const repositoriesSchema = z.string().pipe(
	z.preprocess((input: unknown) => {
		try {
			return JSON.parse(String(input));
		} catch {
			return [];
		}
	}, z.array(repositorySchema)),
);

export type CodexCodingCommandConfig = z.infer<typeof commandSchema>;
export type CodexCodingRepositoryConfig = z.infer<typeof repositorySchema>;

@Config
export class CodexCodingConfig {
	@Env('N8N_CODEX_CODING_REPOSITORIES', repositoriesSchema)
	repositories: CodexCodingRepositoryConfig[] = [];

	@Env('N8N_CODEX_CODING_EXECUTABLE')
	executable: string = process.platform === 'win32' ? 'codex.exe' : 'codex';

	@Env('N8N_CODEX_CODING_WORKTREES_ROOT')
	worktreesRoot: string = '';

	@Env('N8N_CODEX_CODING_MAX_CONCURRENCY')
	maxConcurrency: number = 1;

	@Env('N8N_CODEX_CODING_MAX_TIMEOUT_MS')
	maxTimeoutMs: number = 1_200_000;

	@Env('N8N_CODEX_CODING_MAX_OUTPUT_BYTES')
	maxOutputBytes: number = 256_000;
}
