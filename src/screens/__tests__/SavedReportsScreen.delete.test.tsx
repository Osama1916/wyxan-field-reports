/**
 * SavedReportsScreen local Delete UX: visibility, confirmation, success/error.
 */

import React from 'react';
import {Alert, Text} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

const mockListServerReports = jest.fn(async (): Promise<{reports: never[]}> => ({
  reports: [],
}));
const mockListReports = jest.fn(async (_db: unknown): Promise<unknown[]> => []);
const mockGetReportWithDetails = jest.fn(
  async (_db: unknown, _id: unknown): Promise<unknown> => null,
);
const mockGetDatabase = jest.fn(() => ({}));
const mockKickUploadWorker = jest.fn(async (): Promise<void> => undefined);
const mockRetryFailedReport = jest.fn(
  async (_db: unknown, _reportId: unknown): Promise<boolean> => false,
);
const mockDeleteLocalReport = jest.fn(
  async (_db: unknown, reportId: number): Promise<{reportId: number}> => ({
    reportId,
  }),
);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  exists: jest.fn(async () => true),
}));

jest.mock('../../api', () => ({
  getApiBaseUrl: () => 'http://10.0.2.2:3000',
  listServerReports: () => mockListServerReports(),
  getServerReport: async (id: string) => ({
    id,
    idempotencyKey: `key-${id}`,
    description: 'detail',
    createdAt: '2026-01-01T00:00:00.000Z',
    images: [],
  }),
  resolveServerImageUrl: (url: string | null | undefined) => {
    if (url == null || String(url).trim() === '') {
      return null;
    }
    const trimmed = String(url).trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return `http://10.0.2.2:3000${trimmed.startsWith('/') ? '' : '/'}${trimmed}`;
  },
  subscribeServerReviewRefresh: () => () => undefined,
}));

jest.mock('../../db', () => ({
  formatDatabaseErrorForDisplay: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
  getDatabase: () => mockGetDatabase(),
  listReports: (db: unknown) => mockListReports(db),
  getReportWithDetails: (db: unknown, id: unknown) =>
    mockGetReportWithDetails(db, id),
}));

jest.mock('../../upload', () => ({
  kickUploadWorker: () => mockKickUploadWorker(),
  retryFailedReport: (db: unknown, reportId: unknown) =>
    mockRetryFailedReport(db, reportId),
  subscribeUploadWorker: () => () => undefined,
}));

jest.mock('../../reports/deleteLocalReport', () => {
  class ReportDeleteError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'ReportDeleteError';
      this.code = code;
    }
  }
  return {
    ReportDeleteError,
    deleteLocalReport: (db: unknown, reportId: number) =>
      mockDeleteLocalReport(db, reportId),
  };
});

import {SavedReportsScreen} from '../SavedReportsScreen';
import {ReportDeleteError} from '../../reports/deleteLocalReport';

type LocalReportFixture = {
  id: number;
  description: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'failed';
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastError: string | null;
  serverReportId: string | null;
  idempotencyKey: string;
  photos: Array<{
    id: number;
    reportId: number;
    localUri: string;
    mimeType: string;
    byteSize: number;
    sortOrder: number;
    uploadStatus: string;
  }>;
  uploadJob: null;
};

function makeReport(
  overrides: Partial<LocalReportFixture> & Pick<LocalReportFixture, 'id' | 'status'>,
): LocalReportFixture {
  return {
    description: `Description for report ${overrides.id}`,
    createdAt: '2026-10-30T12:00:00.000Z',
    updatedAt: '2026-10-30T12:00:00.000Z',
    attemptCount: 0,
    lastError: null,
    serverReportId: null,
    idempotencyKey: `key-${overrides.id}`,
    photos: [
      {
        id: overrides.id * 10,
        reportId: overrides.id,
        localUri: `file:///docs/p${overrides.id}.jpg`,
        mimeType: 'image/jpeg',
        byteSize: 1200,
        sortOrder: 0,
        uploadStatus: 'pending',
      },
    ],
    uploadJob: null,
    ...overrides,
  };
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function seedReports(reports: LocalReportFixture[]): void {
  mockListReports.mockResolvedValue(
    reports.map(report => ({
      id: report.id,
      description: report.description,
      status: report.status,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      attemptCount: report.attemptCount,
      lastError: report.lastError,
      serverReportId: report.serverReportId,
      idempotencyKey: report.idempotencyKey,
    })),
  );
  mockGetReportWithDetails.mockImplementation(async (_db, id) => {
    return reports.find(report => report.id === id) ?? null;
  });
}

describe('SavedReportsScreen Delete UI', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockListServerReports.mockClear();
    mockListServerReports.mockResolvedValue({reports: []});
    mockListReports.mockClear();
    mockGetReportWithDetails.mockClear();
    mockGetDatabase.mockClear();
    mockKickUploadWorker.mockClear();
    mockRetryFailedReport.mockClear();
    mockDeleteLocalReport.mockClear();
    mockDeleteLocalReport.mockResolvedValue({reportId: 1});
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('shows Delete for pending and failed, not for uploading or uploaded', async () => {
    seedReports([
      makeReport({id: 1, status: 'pending'}),
      makeReport({id: 2, status: 'failed', lastError: 'Network error'}),
      makeReport({id: 3, status: 'uploading'}),
      makeReport({
        id: 4,
        status: 'uploaded',
        serverReportId: 'srv-4',
      }),
    ]);

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={1} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(tree.root.findByProps({testID: 'delete-report-1'})).toBeTruthy();
    expect(tree.root.findByProps({testID: 'delete-report-2'})).toBeTruthy();
    expect(() =>
      tree.root.findByProps({testID: 'delete-report-3'}),
    ).toThrow();
    expect(() =>
      tree.root.findByProps({testID: 'delete-report-4'}),
    ).toThrow();

    const blocked = tree.root.findByProps({testID: 'delete-blocked-3'});
    expect(blocked.props.children).toBe('Cannot delete while uploading');

    const deleteLabel = tree.root
      .findByProps({testID: 'delete-report-1'})
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat()
      .join(' ');
    expect(deleteLabel).toContain('Delete');
    expect(deleteLabel).not.toContain('key-');
    expect(deleteLabel).not.toContain('file://');

    const allText = tree.root
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat()
      .join(' ');
    expect(allText).toContain('Uploaded to server');
  });

  test('confirmation dialog uses required title, message, and destructive Delete', async () => {
    seedReports([makeReport({id: 11, status: 'pending'})]);

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={2} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    const deleteButton = tree.root.findByProps({testID: 'delete-report-11'});
    await ReactTestRenderer.act(async () => {
      deleteButton.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toBe('Delete report?');
    expect(message).toBe(
      'This permanently removes this report and its locally stored photos. It will not delete anything already stored on the server.',
    );
    expect(buttons).toEqual([
      {text: 'Cancel', style: 'cancel'},
      expect.objectContaining({text: 'Delete', style: 'destructive'}),
    ]);
  });

  test('successful delete removes the card, shows success, and skips extra GET /reports', async () => {
    seedReports([
      makeReport({id: 21, status: 'pending'}),
      makeReport({id: 22, status: 'failed', lastError: 'Timeout'}),
    ]);

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={3} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(mockListServerReports).toHaveBeenCalledTimes(1);

    alertSpy.mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find(
        (button: {style?: string}) => button.style === 'destructive',
      );
      destructive?.onPress?.();
    });

    const deleteButton = tree.root.findByProps({testID: 'delete-report-21'});
    await ReactTestRenderer.act(async () => {
      deleteButton.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(mockDeleteLocalReport).toHaveBeenCalledWith({}, 21);
    expect(() =>
      tree.root.findByProps({testID: 'delete-report-21'}),
    ).toThrow();
    expect(tree.root.findByProps({testID: 'delete-report-22'})).toBeTruthy();
    expect(
      tree.root.findByProps({testID: 'delete-success-notice'}).props
        .accessibilityLabel,
    ).toBe('Delete success');
    const noticeText = tree.root
      .findByProps({testID: 'delete-success-notice'})
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat()
      .join(' ');
    expect(noticeText).toContain('Report deleted from this device');
    // Open-once GET only — local delete must not refetch server review.
    expect(mockListServerReports).toHaveBeenCalledTimes(1);
  });

  test('failed delete keeps the report and shows a retryable error notice', async () => {
    seedReports([makeReport({id: 31, status: 'pending'})]);
    mockDeleteLocalReport.mockRejectedValue(
      new ReportDeleteError('failed', 'Disk write failed while deleting photos.'),
    );

    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <SavedReportsScreen onBack={() => undefined} onRefreshRequest={4} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    alertSpy.mockImplementation((_title, _message, buttons) => {
      const destructive = buttons?.find(
        (button: {style?: string}) => button.style === 'destructive',
      );
      destructive?.onPress?.();
    });

    const deleteButton = tree.root.findByProps({testID: 'delete-report-31'});
    await ReactTestRenderer.act(async () => {
      deleteButton.props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(tree.root.findByProps({testID: 'delete-report-31'})).toBeTruthy();
    const errorNotice = tree.root.findByProps({testID: 'delete-error-notice'});
    const errorText = errorNotice
      .findAllByType(Text)
      .map(node => node.props.children)
      .flat()
      .join(' ');
    expect(errorText).toContain('Disk write failed while deleting photos.');
    expect(errorText).toContain('You can try Delete again');
  });
});
