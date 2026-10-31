jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => {
    throw new Error('op-sqlite open should not be called in unit tests');
  }),
}));

jest.mock('@dr.pogodin/react-native-fs', () => ({
  DocumentDirectoryPath: '/tmp/fieldreports-docs',
  CachesDirectoryPath: '/tmp/fieldreports-cache',
  copyFile: jest.fn(),
  exists: jest.fn(),
  mkdir: jest.fn(),
  stat: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('react-native-image-compression-kit', () => ({
  compressImage: jest.fn(),
}));

import {
  closeDatabase,
  getReportDraft,
  getReportWithDetails,
  initializeDatabase,
  listUploadJobs,
} from '../../db';
import {openNodeSqliteDatabase} from '../../db/testing/nodeSqliteAdapter';
import {
  loadReportDraft,
  persistDraftDescription,
  persistDraftPhotos,
  removeDraftPhoto,
  resetDraftPhotoWriteLockForTests,
} from '../draftReport';
import {
  setPhotoFileSystemForTests,
  stripFileScheme,
  type PhotoFileSystem,
} from '../photoStorage';
import {
  resetReportSaveLockForTests,
  saveLocalReport,
} from '../saveLocalReport';
import type {SelectedPhoto} from '../types';

function makeMemoryFs(initial: Record<string, Buffer> = {}): {
  fs: PhotoFileSystem;
  files: Map<string, Buffer>;
  unlinked: string[];
} {
  const files = new Map<string, Buffer>(
    Object.entries(initial).map(([path, buf]) => [path, Buffer.from(buf)]),
  );
  const unlinked: string[] = [];
  const dirs = new Set<string>();

  const fs: PhotoFileSystem = {
    documentDirectory: '/docs',
    exists: async path => files.has(path) || dirs.has(path),
    mkdir: async path => {
      dirs.add(path);
    },
    copyFile: async (from, into) => {
      const data = files.get(from);
      if (!data) {
        throw new Error(`missing source ${from}`);
      }
      files.set(into, Buffer.from(data));
    },
    writeFileBase64: async (path, base64) => {
      files.set(path, Buffer.from(base64, 'base64'));
    },
    unlink: async path => {
      files.delete(path);
      unlinked.push(path);
    },
    statSize: async path => {
      const data = files.get(path);
      if (!data) {
        throw new Error(`missing ${path}`);
      }
      return data.length;
    },
    readDirNames: async path => {
      const prefix = path.endsWith('/') ? path : `${path}/`;
      return [...files.keys()]
        .filter(key => key.startsWith(prefix))
        .map(key => key.slice(prefix.length).split('/')[0])
        .filter(Boolean);
    },
  };

  return {fs, files, unlinked};
}

function selected(
  overrides: Partial<SelectedPhoto> & {bytes?: number; path?: string} = {},
): SelectedPhoto {
  const bytes = overrides.bytes ?? 128;
  const path = overrides.path ?? '/cache/shot.jpg';
  const uri = overrides.uri ?? `file://${path}`;
  return {
    selectionId: overrides.selectionId ?? 'sel-1',
    uri,
    mimeType: overrides.mimeType ?? 'image/jpeg',
    byteSize: overrides.byteSize ?? bytes,
    fileName: overrides.fileName ?? 'shot.jpg',
    fingerprint: overrides.fingerprint ?? `uri:${uri}`,
    draftPersisted: overrides.draftPersisted,
    ownedTempPath: overrides.ownedTempPath,
    wasCompressed: overrides.wasCompressed,
  };
}

describe('unsaved report drafts', () => {
  afterEach(async () => {
    resetDraftPhotoWriteLockForTests();
    resetReportSaveLockForTests();
    setPhotoFileSystemForTests(null);
    await closeDatabase();
  });

  async function setupDb() {
    const database = openNodeSqliteDatabase(':memory:');
    await initializeDatabase({database, recoverStaleJobs: false});
    return database;
  }

  test('persists draft description', async () => {
    const database = await setupDb();
    await persistDraftDescription(database, 'Fence leaning west');

    const draft = await getReportDraft(database);
    expect(draft?.description).toBe('Fence leaning west');
    expect(draft?.photos).toEqual([]);
  });

  test('persists draft photos into app storage with unique files', async () => {
    const database = await setupDb();
    const sourceA = '/cache/a.jpg';
    const sourceB = '/cache/b.jpg';
    const {fs, files} = makeMemoryFs({
      [sourceA]: Buffer.alloc(100, 1),
      [sourceB]: Buffer.alloc(120, 2),
    });
    setPhotoFileSystemForTests(fs);

    const persisted = await persistDraftPhotos(database, [
      selected({
        selectionId: 'a',
        path: sourceA,
        uri: `file://${sourceA}`,
        bytes: 100,
        fingerprint: 'fp-a',
      }),
      selected({
        selectionId: 'b',
        path: sourceB,
        uri: `file://${sourceB}`,
        bytes: 120,
        fingerprint: 'fp-b',
        fileName: 'b.jpg',
      }),
    ]);

    expect(persisted).toHaveLength(2);
    expect(persisted.every(photo => photo.draftPersisted)).toBe(true);
    expect(persisted[0].uri).not.toBe(`file://${sourceA}`);
    expect(persisted[1].uri).not.toBe(`file://${sourceB}`);
    expect(persisted[0].uri).not.toBe(persisted[1].uri);

    const draft = await getReportDraft(database);
    expect(draft?.photos.map(p => p.selectionId)).toEqual(['a', 'b']);
    expect(files.has(stripFileScheme(persisted[0].uri))).toBe(true);
    expect(files.has(stripFileScheme(persisted[1].uri))).toBe(true);
  });

  test('restores description and photo order after simulated restart', async () => {
    const database = await setupDb();
    const sourceA = '/cache/a.jpg';
    const sourceB = '/cache/b.jpg';
    const {fs} = makeMemoryFs({
      [sourceA]: Buffer.alloc(80, 1),
      [sourceB]: Buffer.alloc(90, 2),
    });
    setPhotoFileSystemForTests(fs);

    await persistDraftDescription(database, 'Ordered photos');
    const persisted = await persistDraftPhotos(database, [
      selected({
        selectionId: 'first',
        path: sourceA,
        uri: `file://${sourceA}`,
        bytes: 80,
        fingerprint: 'fp-1',
      }),
      selected({
        selectionId: 'second',
        path: sourceB,
        uri: `file://${sourceB}`,
        bytes: 90,
        fingerprint: 'fp-2',
      }),
    ]);

    // Simulated process restart: new load from same SQLite + files.
    const restored = await loadReportDraft(database, fs);
    expect(restored.description).toBe('Ordered photos');
    expect(restored.photos.map(p => p.selectionId)).toEqual([
      'first',
      'second',
    ]);
    expect(restored.photos.map(p => p.uri)).toEqual(
      persisted.map(p => p.uri),
    );
    expect(restored.recoveryNotice).toBeNull();
  });

  test('draft remains after app restart (reload)', async () => {
    const database = await setupDb();
    const source = '/cache/one.jpg';
    const {fs} = makeMemoryFs({
      [source]: Buffer.alloc(64, 3),
    });
    setPhotoFileSystemForTests(fs);

    await persistDraftDescription(database, 'Still here');
    await persistDraftPhotos(database, [
      selected({
        selectionId: 'only',
        path: source,
        uri: `file://${source}`,
        bytes: 64,
      }),
    ]);

    const again = await loadReportDraft(database, fs);
    expect(again.description).toBe('Still here');
    expect(again.photos).toHaveLength(1);
  });

  test('adding and removing draft photos updates order and files', async () => {
    const database = await setupDb();
    const sourceA = '/cache/a.jpg';
    const sourceB = '/cache/b.jpg';
    const sourceC = '/cache/c.jpg';
    const {fs, files, unlinked} = makeMemoryFs({
      [sourceA]: Buffer.alloc(50, 1),
      [sourceB]: Buffer.alloc(60, 2),
      [sourceC]: Buffer.alloc(70, 3),
    });
    setPhotoFileSystemForTests(fs);

    let photos = await persistDraftPhotos(database, [
      selected({
        selectionId: 'a',
        path: sourceA,
        uri: `file://${sourceA}`,
        bytes: 50,
        fingerprint: 'a',
      }),
      selected({
        selectionId: 'b',
        path: sourceB,
        uri: `file://${sourceB}`,
        bytes: 60,
        fingerprint: 'b',
      }),
    ]);

    const removedUri = photos[0].uri;
    photos = await removeDraftPhoto(database, photos, 'a', fs);
    expect(photos.map(p => p.selectionId)).toEqual(['b']);
    expect(unlinked).toContain(stripFileScheme(removedUri));
    expect(files.has(stripFileScheme(removedUri))).toBe(false);

    photos = await persistDraftPhotos(database, [
      ...photos,
      selected({
        selectionId: 'c',
        path: sourceC,
        uri: `file://${sourceC}`,
        bytes: 70,
        fingerprint: 'c',
      }),
    ]);
    expect(photos.map(p => p.selectionId)).toEqual(['b', 'c']);
    expect(photos.every(p => p.draftPersisted)).toBe(true);

    // Existing draft photo was not copied again.
    const draft = await getReportDraft(database);
    expect(draft?.photos).toHaveLength(2);
    expect(draft?.photos[0].localUri).toBe(photos[0].uri);
  });

  test('no upload job exists before Save', async () => {
    const database = await setupDb();
    const source = '/cache/x.jpg';
    const {fs} = makeMemoryFs({
      [source]: Buffer.alloc(40, 9),
    });
    setPhotoFileSystemForTests(fs);

    await persistDraftDescription(database, 'Not saved yet');
    await persistDraftPhotos(database, [
      selected({
        selectionId: 'x',
        path: source,
        uri: `file://${source}`,
        bytes: 40,
      }),
    ]);

    expect(await listUploadJobs(database)).toEqual([]);
    const draft = await getReportDraft(database);
    expect(draft).not.toBeNull();
  });

  test('Save converts draft into a report, clears draft, and reuses photo files', async () => {
    const database = await setupDb();
    const source = '/cache/save-me.jpg';
    const {fs, files, unlinked} = makeMemoryFs({
      [source]: Buffer.alloc(200, 4),
    });
    setPhotoFileSystemForTests(fs);

    await persistDraftDescription(database, 'Ready to file');
    const draftPhotos = await persistDraftPhotos(database, [
      selected({
        selectionId: 's1',
        path: source,
        uri: `file://${source}`,
        bytes: 200,
        fingerprint: 'save',
      }),
    ]);
    const draftPath = stripFileScheme(draftPhotos[0].uri);
    expect(files.has(draftPath)).toBe(true);

    const created = await saveLocalReport(database, {
      description: 'Ready to file',
      photos: draftPhotos,
    });

    expect(created.description).toBe('Ready to file');
    expect(created.photos[0].localUri).toBe(draftPhotos[0].uri);
    expect(files.has(draftPath)).toBe(true);
    expect(unlinked).not.toContain(draftPath);

    expect(await getReportDraft(database)).toBeNull();
    expect(await listUploadJobs(database)).toHaveLength(1);

    const details = await getReportWithDetails(database, created.id);
    expect(details?.photos).toHaveLength(1);
  });

  test('failed Save does not lose the draft', async () => {
    const database = await setupDb();
    const source = '/cache/keep.jpg';
    const {fs, files} = makeMemoryFs({
      [source]: Buffer.alloc(55, 5),
    });
    setPhotoFileSystemForTests(fs);

    await persistDraftDescription(database, 'Must survive');
    const draftPhotos = await persistDraftPhotos(database, [
      selected({
        selectionId: 'keep',
        path: source,
        uri: `file://${source}`,
        bytes: 55,
      }),
    ]);
    const draftPath = stripFileScheme(draftPhotos[0].uri);

    await expect(
      saveLocalReport(database, {
        description: '   ',
        photos: draftPhotos,
      }),
    ).rejects.toMatchObject({code: 'validation'});

    const draft = await getReportDraft(database);
    expect(draft?.description).toBe('Must survive');
    expect(draft?.photos).toHaveLength(1);
    expect(files.has(draftPath)).toBe(true);
    expect(await listUploadJobs(database)).toEqual([]);
  });

  test('cleanup on remove only deletes draft-owned files', async () => {
    const database = await setupDb();
    const source = '/cache/draft-only.jpg';
    const reportOwned = '/docs/report-photos/report-owned.jpg';
    const {fs, files, unlinked} = makeMemoryFs({
      [source]: Buffer.alloc(33, 7),
      [reportOwned]: Buffer.alloc(44, 8),
    });
    setPhotoFileSystemForTests(fs);

    const photos = await persistDraftPhotos(database, [
      selected({
        selectionId: 'd1',
        path: source,
        uri: `file://${source}`,
        bytes: 33,
      }),
    ]);
    const draftUri = photos[0].uri;

    await removeDraftPhoto(database, photos, 'd1', fs);

    expect(unlinked).toContain(stripFileScheme(draftUri));
    expect(files.has(reportOwned)).toBe(true);
    expect(unlinked).not.toContain(reportOwned);
  });

  test('missing draft photo files are dropped with a recovery notice', async () => {
    const database = await setupDb();
    const source = '/cache/gone.jpg';
    const {fs, files} = makeMemoryFs({
      [source]: Buffer.alloc(22, 1),
    });
    setPhotoFileSystemForTests(fs);

    const photos = await persistDraftPhotos(database, [
      selected({
        selectionId: 'gone',
        path: source,
        uri: `file://${source}`,
        bytes: 22,
      }),
    ]);
    files.delete(stripFileScheme(photos[0].uri));

    const restored = await loadReportDraft(database, fs);
    expect(restored.photos).toEqual([]);
    expect(restored.recoveryNotice).toMatch(/missing/i);
    expect(await getReportDraft(database)).toMatchObject({
      photos: [],
    });
  });

  test('repeated persist of the same draft photos does not duplicate copies', async () => {
    const database = await setupDb();
    const source = '/cache/once.jpg';
    const {fs, files} = makeMemoryFs({
      [source]: Buffer.alloc(77, 6),
    });
    setPhotoFileSystemForTests(fs);

    const first = await persistDraftPhotos(database, [
      selected({
        selectionId: 'once',
        path: source,
        uri: `file://${source}`,
        bytes: 77,
      }),
    ]);
    const pathsBefore = [...files.keys()].filter(p =>
      p.includes('report-photos'),
    );

    const second = await persistDraftPhotos(database, first);
    const pathsAfter = [...files.keys()].filter(p =>
      p.includes('report-photos'),
    );

    expect(second[0].uri).toBe(first[0].uri);
    expect(pathsAfter).toEqual(pathsBefore);
  });
});
