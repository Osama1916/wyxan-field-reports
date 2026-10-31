import {useCallback, useState} from 'react';
import {showConfirmDialog} from '../components/common';
import {getDatabase} from '../db';
import {
  ResetAllReportsError,
  resetAllLocalAndServerReports,
} from '../reports/resetAllReports';

const RESET_CONFIRM_TITLE = 'Reset all reports?';
const RESET_CONFIRM_MESSAGE =
  'This permanently deletes all locally saved reports, queued uploads, locally stored report photos, and reports and images stored on the server. This action cannot be undone. Network access is required to reset server data.';

export function useSettingsReset() {
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const performReset = useCallback(async () => {
    if (resetting) {
      return;
    }
    setResetting(true);
    setError(null);
    setSuccess(null);
    try {
      const db = getDatabase();
      const result = await resetAllLocalAndServerReports(db);
      setSuccess(
        `Reset complete. Removed ${result.deletedLocalReports} local report${
          result.deletedLocalReports === 1 ? '' : 's'
        } and ${result.server.deletedReports} server report${
          result.server.deletedReports === 1 ? '' : 's'
        }. Chaos settings were left unchanged.`,
      );
    } catch (err) {
      if (err instanceof ResetAllReportsError) {
        setError(err.message);
      } else {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not reset reports. Please try again.',
        );
      }
    } finally {
      setResetting(false);
    }
  }, [resetting]);

  const onRequestReset = useCallback(() => {
    if (resetting) {
      return;
    }
    showConfirmDialog({
      title: RESET_CONFIRM_TITLE,
      message: RESET_CONFIRM_MESSAGE,
      confirmText: 'Reset all reports',
      destructive: true,
      onConfirm: () => {
        void performReset();
      },
    });
  }, [performReset, resetting]);

  return {
    resetting,
    error,
    success,
    onRequestReset,
  };
}
