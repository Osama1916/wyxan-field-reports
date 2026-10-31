import {useCallback, useEffect, useRef, useState} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import {getDatabase} from '../db';
import {cleanupOwnedCompressionTemps} from '../media/imageCompression';
import {
  capturePhotoWithCamera,
  ImageSelectionError,
  pickPhotosFromGallery,
} from '../media/imageSelection';
import {
  DraftReportError,
  loadReportDraft,
  persistDraftDescription,
  persistDraftPhotos,
  removeDraftPhoto,
} from '../reports/draftReport';
import {ReportSaveError, saveLocalReport} from '../reports/saveLocalReport';
import type {SelectedPhoto} from '../reports/types';
import {validateDescription} from '../reports/validation';
import {kickUploadWorker} from '../upload';

const DESCRIPTION_DRAFT_DEBOUNCE_MS = 400;

export type UseCreateReportFormOptions = {
  onSaved: (reportId: number) => void;
};

export function useCreateReportForm({onSaved}: UseCreateReportFormOptions) {
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [restoringDraft, setRestoringDraft] = useState(true);
  const [processingMessage, setProcessingMessage] = useState<string | null>(
    null,
  );

  const descriptionRef = useRef(description);
  const descriptionPersistTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const draftReadyRef = useRef(false);

  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);

  const clearErrors = useCallback(() => {
    setError(null);
    setDescriptionError(null);
  }, []);

  const flushDraftDescription = useCallback(async () => {
    if (!draftReadyRef.current) {
      return;
    }
    if (descriptionPersistTimerRef.current) {
      clearTimeout(descriptionPersistTimerRef.current);
      descriptionPersistTimerRef.current = null;
    }
    try {
      const db = getDatabase();
      await persistDraftDescription(db, descriptionRef.current);
    } catch {
      // Best-effort flush — last successful persist remains recoverable.
    }
  }, []);

  const scheduleDraftDescriptionPersist = useCallback((text: string) => {
    descriptionRef.current = text;
    if (!draftReadyRef.current) {
      return;
    }
    if (descriptionPersistTimerRef.current) {
      clearTimeout(descriptionPersistTimerRef.current);
    }
    descriptionPersistTimerRef.current = setTimeout(() => {
      descriptionPersistTimerRef.current = null;
      void persistDraftDescription(getDatabase(), text).catch(() => {
        // Keep UI editable; last good draft row stays on disk.
      });
    }, DESCRIPTION_DRAFT_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const db = getDatabase();
        const restored = await loadReportDraft(db);
        if (cancelled) {
          return;
        }
        setDescription(restored.description);
        descriptionRef.current = restored.description;
        setPhotos(restored.photos);
        if (restored.recoveryNotice) {
          setError(restored.recoveryNotice);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not restore the unsaved draft.',
          );
        }
      } finally {
        if (!cancelled) {
          draftReadyRef.current = true;
          setRestoringDraft(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (descriptionPersistTimerRef.current) {
        clearTimeout(descriptionPersistTimerRef.current);
        descriptionPersistTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const onAppStateChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        void flushDraftDescription();
      }
    };
    const sub = AppState.addEventListener('change', onAppStateChange);
    return () => {
      sub.remove();
    };
  }, [flushDraftDescription]);

  const handleSelectionError = useCallback((err: unknown) => {
    if (err instanceof ImageSelectionError) {
      if (err.code === 'cancelled') {
        return;
      }
      setError(err.message);
      return;
    }
    if (err instanceof DraftReportError) {
      setError(err.message);
      return;
    }
    setError(
      err instanceof Error ? err.message : 'Could not select a photo.',
    );
  }, []);

  const commitSelectedPhotos = useCallback(
    async (nextPhotos: SelectedPhoto[]) => {
      setProcessingMessage('Saving draft photos…');
      const db = getDatabase();
      const persisted = await persistDraftPhotos(db, nextPhotos);
      setPhotos(persisted);
      await cleanupOwnedCompressionTemps(nextPhotos);
    },
    [],
  );

  const onCamera = useCallback(async () => {
    if (saving || picking || restoringDraft) {
      return;
    }
    clearErrors();
    setPicking(true);
    setProcessingMessage('Opening camera…');
    try {
      const result = await capturePhotoWithCamera(photos, progress => {
        setProcessingMessage(progress.message);
      });
      if (result.status === 'selected') {
        await commitSelectedPhotos([...photos, ...result.photos]);
      }
    } catch (err) {
      handleSelectionError(err);
    } finally {
      setPicking(false);
      setProcessingMessage(null);
    }
  }, [
    clearErrors,
    commitSelectedPhotos,
    handleSelectionError,
    photos,
    picking,
    restoringDraft,
    saving,
  ]);

  const onGallery = useCallback(async () => {
    if (saving || picking || restoringDraft) {
      return;
    }
    clearErrors();
    setPicking(true);
    setProcessingMessage('Opening gallery…');
    try {
      const result = await pickPhotosFromGallery(photos, progress => {
        setProcessingMessage(progress.message);
      });
      if (result.status === 'selected') {
        await commitSelectedPhotos([...photos, ...result.photos]);
      }
    } catch (err) {
      handleSelectionError(err);
    } finally {
      setPicking(false);
      setProcessingMessage(null);
    }
  }, [
    clearErrors,
    commitSelectedPhotos,
    handleSelectionError,
    photos,
    picking,
    restoringDraft,
    saving,
  ]);

  const onRemovePhoto = useCallback(
    (selectionId: string) => {
      if (saving || picking || restoringDraft) {
        return;
      }
      clearErrors();
      void (async () => {
        try {
          const db = getDatabase();
          const next = await removeDraftPhoto(db, photos, selectionId);
          const removed = photos.find(
            photo => photo.selectionId === selectionId,
          );
          if (removed?.ownedTempPath) {
            await cleanupOwnedCompressionTemps([removed]);
          }
          setPhotos(next);
        } catch (err) {
          handleSelectionError(err);
        }
      })();
    },
    [
      clearErrors,
      handleSelectionError,
      photos,
      picking,
      restoringDraft,
      saving,
    ],
  );

  const onChangeDescription = useCallback(
    (text: string) => {
      clearErrors();
      setDescription(text);
      scheduleDraftDescriptionPersist(text);
    },
    [clearErrors, scheduleDraftDescriptionPersist],
  );

  const onSave = useCallback(async () => {
    if (saving || picking || restoringDraft) {
      return;
    }
    clearErrors();
    await flushDraftDescription();

    const descriptionIssue = validateDescription(description);
    if (descriptionIssue) {
      setDescriptionError(descriptionIssue.message);
      setError(descriptionIssue.message);
      return;
    }

    setSaving(true);
    setProcessingMessage('Saving report…');
    try {
      const db = getDatabase();
      const created = await saveLocalReport(db, {description, photos});
      setDescription('');
      descriptionRef.current = '';
      setPhotos([]);
      void kickUploadWorker();
      onSaved(created.id);
    } catch (err) {
      if (err instanceof ReportSaveError) {
        const isDescriptionError = err.message
          .toLowerCase()
          .includes('description');
        if (isDescriptionError) {
          setDescriptionError(err.message);
        }
        setError(err.message);
      } else {
        setError(
          err instanceof Error ? err.message : 'Could not save the report.',
        );
      }
    } finally {
      setSaving(false);
      setProcessingMessage(null);
    }
  }, [
    clearErrors,
    description,
    flushDraftDescription,
    onSaved,
    photos,
    picking,
    restoringDraft,
    saving,
  ]);

  const busy = saving || picking || restoringDraft;

  return {
    description,
    photos,
    error,
    descriptionError,
    saving,
    busy,
    processingMessage,
    onChangeDescription,
    onCamera,
    onGallery,
    onRemovePhoto,
    onSave,
  };
}
