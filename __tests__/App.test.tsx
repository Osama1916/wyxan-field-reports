/**
 * @format
 */

jest.mock('../src/db/startup', () => ({
  startDatabase: jest.fn(async () => ({
    database: {},
    appliedMigrations: [1],
    staleJobRecovery: {recovered: [], recoveredCount: 0},
  })),
  resetDatabaseStartup: jest.fn(async () => undefined),
}));

jest.mock('../src/db/nativeRuntimeCheck', () => ({
  verifyNativeDatabaseRuntime: jest.fn(async () => ({
    platform: 'ios',
    migrationVersions: [1],
    latestMigrationVersion: 1,
    reportsReadable: true,
    uploadJobsReadable: true,
    nativeModuleLinked: true,
  })),
}));

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';
import {startDatabase} from '../src/db/startup';

test('renders main UI after database startup succeeds', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
    await Promise.resolve();
  });

  expect(startDatabase).toHaveBeenCalled();
  expect(tree!.root).toBeTruthy();
});
