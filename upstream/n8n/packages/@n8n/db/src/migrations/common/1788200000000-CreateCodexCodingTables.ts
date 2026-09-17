import type { MigrationContext, ReversibleMigration } from '../migration-types';

export class CreateCodexCodingTables1788200000000 implements ReversibleMigration {
	async up({ schemaBuilder: { createTable, column } }: MigrationContext) {
		await createTable('codex_coding_run')
			.withColumns(
				column('id').varchar(36).primary,
				column('projectId').varchar(36),
				column('workflowId').varchar(36).notNull,
				column('workflowExecutionId').varchar(36).notNull,
				column('nodeId').varchar(36).notNull,
				column('repositoryId').varchar(128).notNull,
				column('baseCommit').varchar(64).notNull,
				column('branchName').varchar(255).notNull,
				column('worktreePath').text.notNull,
				column('codexThreadId').varchar(128),
				column('codexSessionId').varchar(128),
				column('status').varchar(32).notNull,
				column('lastTurnId').varchar(128),
				column('error').text,
			)
			.withIndexOn(['workflowExecutionId', 'nodeId'], true)
			.withIndexOn('projectId')
			.withForeignKey('projectId', {
				tableName: 'project',
				columnName: 'id',
				onDelete: 'CASCADE',
			}).withTimestamps;

		await createTable('codex_coding_turn')
			.withColumns(
				column('id').varchar(36).primary,
				column('runId').varchar(36).notNull,
				column('turnId').varchar(128),
				column('round').int.notNull,
				column('status').varchar(32).notNull,
				column('summary').text,
				column('usage').text,
				column('checks').text,
				column('error').text,
				column('diffArtifactId').varchar(128),
			)
			.withIndexOn(['runId', 'round'], true)
			.withForeignKey('runId', {
				tableName: 'codex_coding_run',
				columnName: 'id',
				onDelete: 'CASCADE',
			}).withTimestamps;
	}

	async down({ schemaBuilder: { dropTable } }: MigrationContext) {
		await dropTable('codex_coding_turn');
		await dropTable('codex_coding_run');
	}
}
