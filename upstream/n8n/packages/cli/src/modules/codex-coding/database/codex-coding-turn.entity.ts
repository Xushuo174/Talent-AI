import { WithTimestampsAndStringId } from '@n8n/db';
import { Column, Entity, Index } from '@n8n/typeorm';
import type { CodexCodingStatus } from 'n8n-workflow';

@Entity({ name: 'codex_coding_turn' })
@Index(['runId', 'round'], { unique: true })
export class CodexCodingTurn extends WithTimestampsAndStringId {
	@Column({ type: 'varchar', length: 36 })
	runId: string;

	@Column({ type: 'varchar', length: 128, nullable: true })
	turnId: string | null;

	@Column({ type: 'int' })
	round: number;

	@Column({ type: 'varchar', length: 32 })
	status: CodexCodingStatus;

	@Column({ type: 'text', nullable: true })
	summary: string | null;

	@Column({ type: 'text', nullable: true })
	usage: string | null;

	@Column({ type: 'text', nullable: true })
	checks: string | null;

	@Column({ type: 'text', nullable: true })
	error: string | null;

	@Column({ type: 'varchar', length: 128, nullable: true })
	diffArtifactId: string | null;
}
