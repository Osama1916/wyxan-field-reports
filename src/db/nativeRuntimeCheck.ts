import {Platform, TurboModuleRegistry} from 'react-native';
import {DatabaseError} from './errors';
import {
  getAppliedMigrationVersions,
  getLatestMigrationVersion,
} from './migrations';
import type {InitializeDatabaseResult} from './database';

export type NativeDatabaseVerification = {
  platform: string;
  migrationVersions: number[];
  latestMigrationVersion: number;
  reportsReadable: boolean;
  uploadJobsReadable: boolean;
  nativeModuleLinked: boolean;
};

/**
 * Development-only read-only check that the native op-sqlite path is live.
 * Does not insert reports, photos, or jobs, and does not modify user data.
 */
export async function verifyNativeDatabaseRuntime(
  init: InitializeDatabaseResult,
): Promise<NativeDatabaseVerification> {
  if (!__DEV__) {
    throw new DatabaseError(
      'verifyNativeDatabaseRuntime is only available in development builds',
    );
  }

  const nativeModule = TurboModuleRegistry.get('OPSQLite');
  if (nativeModule == null) {
    throw new DatabaseError(
      'Native OPSQLite TurboModule is not linked; Node test adapter must not be used in the app',
    );
  }

  const db = init.database;
  const latestMigrationVersion = getLatestMigrationVersion();
  const migrationVersions = await getAppliedMigrationVersions(db);

  if (!migrationVersions.includes(latestMigrationVersion)) {
    throw new DatabaseError(
      `Migrations incomplete: expected version ${latestMigrationVersion}, found [${migrationVersions.join(', ')}]`,
    );
  }

  // Read-only table access — no inserts or updates.
  const reports = await db.execute(
    'SELECT COUNT(*) AS c FROM reports',
  );
  const uploadJobs = await db.execute(
    'SELECT COUNT(*) AS c FROM upload_jobs',
  );

  if (reports.rows[0]?.c === undefined) {
    throw new DatabaseError('Failed to read reports table');
  }
  if (uploadJobs.rows[0]?.c === undefined) {
    throw new DatabaseError('Failed to read upload_jobs table');
  }

  return {
    platform: Platform.OS,
    migrationVersions,
    latestMigrationVersion,
    reportsReadable: true,
    uploadJobsReadable: true,
    nativeModuleLinked: true,
  };
}
