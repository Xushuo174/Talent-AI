import { WithTimestampsAndStringId } from '@n8n/db';
import { Column, Entity, Index } from '@n8n/typeorm';
import type { CodexCodingStatus } from 'n8n-workflow';

export type CodexCodingRunStatus = CodexCodingStatus | 'preparing' | 'running';

@Entity({ name: 'codex_coding_run' })
@Index(['workflowExecutionId', 'nodeId'], { unique: true })
@Index(['projectId'])
export class CodexCodingRun extends WithTimestampsAndStringId {
	@Column({ type: 'varchar', length: 36, nullable: true })
	projectId: string | null;

	@Column({ type: 'varchar', length: 36 })
	workflowId: string;

	@Column({ type: 'varchar', length: 36 })
	workflowExecutionId: string;

	@Column({ type: 'varchar', length: 36 })
	nodeId: string;

	@Column({ type: 'varchar', length: 128 })
	repositoryId: string;

	@Column({ type: 'varchar', length: 64 })
	baseCommit: string;

	@Column({ type: 'varchar', length: 255 })
	branchName: string;

	@Column({ type: 'text' })
	worktreePath: string;

	@Column({ type: 'varchar', length: 128, nullable: true })
	codexThreadId: string | null;

	@Column({ type: 'varchar', length: 128, nullable: true })
	codexSessionId: string | null;

	@Column({ type: 'varchar', length: 32 })
	status: CodexCodingRunStatus;

	@Column({ type: 'varchar', length: 128, nullable: true })
	lastTurnId: string | null;

	@Column({ type: 'text', nullable: true })
	error: string | null;
}
