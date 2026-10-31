import {useCallback, useEffect, useRef, useState} from 'react';
import {Alert} from 'react-native';
import {
  getServerReport,
  listServerReports,
  resolveServerImageUrl,
  subscribeServerReviewRefresh,
} from '../api';
import {showConfirmDialog} from '../components/common/ConfirmDialog';
import type {ServerReviewItem} from '../components/reports/ServerReportCard';
import {
  formatDatabaseErrorForDisplay,
  getDatabase,
  getReportWithDetails,
  listReports,
  type LocalReportWithPhotos,
} from '../db';
import {
  deleteLocalReport,
  ReportDeleteError,
} from '../reports/deleteLocalReport';
import {
  kickUploadWorker,
  retryFailedReport,
  subscribeUploadWorker,
} from '../upload';

export const SERVER_REVIEW_PREVIEW_COUNT = 2;
export const LOCAL_REPORTS_PREVIEW_COUNT = 4;

export type ActionNotice = {
  type: 'success' | 'error';
  message: string;
};

export type UseSavedReportsOptions = {
  highlightReportId?: number | null;
  onRefreshRequest?: number;
};

export function useSavedReports({
  highlightReportId,
  onRefreshRequest = 0,
}: UseSavedReportsOptions) {
  const mountedRef = useRef(true);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<ActionNotice | null>(null);
  const [reports, setReports] = useState<LocalReportWithPhotos[]>([]);
  const [serverReports, setServerReports] = useState<ServerReviewItem[]>([]);
  const [serverReviewError, setServerReviewError] = useState<string | null>(
    null,
  );
  const [serverRefreshing, setServerRefreshing] = useState(false);
  const [serverReviewExpanded, setServerReviewExpanded] = useState(false);
  const [localReportsExpanded, setLocalReportsExpanded] = useState(false);
  const serverReviewLoadRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadServerReview = useCallback(async () => {
    if (serverReviewLoadRef.current) {
      return serverReviewLoadRef.current;
    }

    const loadPromise = (async () => {
      if (mountedRef.current) {
        setServerRefreshing(true);
      }
      try {
        const response = await listServerReports();
        const enriched = await Promise.all(
          response.reports.map(async (summary): Promise<ServerReviewItem> => {
            try {
              const detail = await getServerReport(summary.id);
              const images = [...detail.images]
                .filter(image => resolveServerImageUrl(image.url) != null)
                .sort((a, b) => a.sortOrder - b.sortOrder);
              return {
                ...summary,
                imageCount:
                  images.length > 0 ? images.length : summary.imageCount,
                images,
              };
            } catch {
              return {...summary, images: []};
            }
          }),
        );
        if (!mountedRef.current) {
          return;
        }
        setServerReports(enriched);
        setServerReviewError(null);
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }
        setServerReviewError(
          err instanceof Error
            ? err.message
            : 'Could not load server review data.',
        );
      } finally {
        if (mountedRef.current) {
          setServerRefreshing(false);
        }
      }
    })().finally(() => {
      serverReviewLoadRef.current = null;
    });

    serverReviewLoadRef.current = loadPromise;
    return loadPromise;
  }, []);

  const loadLocalList = useCallback(async (isReload = false) => {
    if (isReload) {
      setReloading(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const db = getDatabase();
      const rows = await listReports(db);
      const detailed = (
        await Promise.all(rows.map(row => getReportWithDetails(db, row.id)))
      ).filter((row): row is LocalReportWithPhotos => row != null);

      if (!mountedRef.current) {
        return;
      }
      setReports(detailed);
    } catch (err) {
      if (!mountedRef.current) {
        return;
      }
      setError(
        formatDatabaseErrorForDisplay(err) ||
          'Could not load saved reports. Please try again.',
      );
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setReloading(false);
      }
    }
  }, []);

  const onManualReload = useCallback(async () => {
    await Promise.all([loadLocalList(true), loadServerReview()]);
  }, [loadLocalList, loadServerReview]);

  useEffect(() => {
    void loadLocalList(false);
    void loadServerReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-once per refresh token
  }, [onRefreshRequest]);

  useEffect(() => {
    return subscribeServerReviewRefresh(() => {
      void loadServerReview();
    });
  }, [loadServerReview]);

  useEffect(() => {
    return subscribeUploadWorker(event => {
      if (
        event.type === 'job_result' ||
        event.type === 'pass_finished' ||
        event.type === 'error'
      ) {
        void loadLocalList(true);
      }
    });
  }, [loadLocalList]);

  const onSync = useCallback(async () => {
    if (syncing || loading) {
      return;
    }
    setSyncing(true);
    try {
      await kickUploadWorker();
      await loadLocalList(true);
    } finally {
      if (mountedRef.current) {
        setSyncing(false);
      }
    }
  }, [loadLocalList, loading, syncing]);

  const onRetryReport = useCallback(
    async (reportId: number) => {
      if (retryingId != null || deletingId != null) {
        return;
      }
      setRetryingId(reportId);
      try {
        const db = getDatabase();
        const queued = await retryFailedReport(db, reportId);
        if (queued) {
          await kickUploadWorker();
        }
        await loadLocalList(true);
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }
        setError(
          formatDatabaseErrorForDisplay(err) ||
            'Could not retry this report.',
        );
      } finally {
        if (mountedRef.current) {
          setRetryingId(null);
        }
      }
    },
    [deletingId, loadLocalList, retryingId],
  );

  const performDelete = useCallback(
    async (reportId: number) => {
      if (deletingId != null || retryingId != null) {
        return;
      }
      setDeletingId(reportId);
      setActionNotice(null);
      try {
        const db = getDatabase();
        await deleteLocalReport(db, reportId);
        if (!mountedRef.current) {
          return;
        }
        setReports(current => current.filter(report => report.id !== reportId));
        setActionNotice({
          type: 'success',
          message: 'Report deleted from this device',
        });
      } catch (err) {
        if (!mountedRef.current) {
          return;
        }
        const message =
          err instanceof ReportDeleteError
            ? err.message
            : formatDatabaseErrorForDisplay(err) ||
              'Could not delete this report. Please try again.';
        setActionNotice({type: 'error', message});
        if (err instanceof ReportDeleteError && err.code === 'uploading') {
          Alert.alert('Upload in progress', err.message);
        }
      } finally {
        if (mountedRef.current) {
          setDeletingId(null);
        }
      }
    },
    [deletingId, retryingId],
  );

  const onRequestDelete = useCallback(
    (reportId: number) => {
      if (deletingId != null || retryingId != null) {
        return;
      }
      showConfirmDialog({
        title: 'Delete report?',
        message:
          'This permanently removes this report and its locally stored photos. It will not delete anything already stored on the server.',
        confirmText: 'Delete',
        destructive: true,
        onConfirm: () => {
          void performDelete(reportId);
        },
      });
    },
    [deletingId, performDelete, retryingId],
  );

  useEffect(() => {
    if (highlightReportId == null) {
      return;
    }
    const index = reports.findIndex(r => r.id === highlightReportId);
    if (index >= LOCAL_REPORTS_PREVIEW_COUNT) {
      setLocalReportsExpanded(true);
    }
  }, [highlightReportId, reports]);

  const busy = loading || reloading || syncing || serverRefreshing;
  const visibleLocalReports = localReportsExpanded
    ? reports
    : reports.slice(0, LOCAL_REPORTS_PREVIEW_COUNT);
  const hiddenLocalCount = Math.max(
    0,
    reports.length - LOCAL_REPORTS_PREVIEW_COUNT,
  );

  return {
    loading,
    reloading,
    syncing,
    serverRefreshing,
    retryingId,
    deletingId,
    error,
    actionNotice,
    setActionNotice,
    reports,
    serverReports,
    serverReviewError,
    serverReviewExpanded,
    localReportsExpanded,
    setServerReviewExpanded,
    setLocalReportsExpanded,
    busy,
    visibleLocalReports,
    hiddenLocalCount,
    loadServerReview,
    onManualReload,
    onSync,
    onRetryReport,
    onRequestDelete,
  };
}
