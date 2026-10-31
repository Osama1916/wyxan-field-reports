/**
 * FieldReports app entry.
 * Cold-starts native SQLite once per process, then renders Create Report UI.
 *
 * @format
 */

import {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
} from 'react-native-safe-area-context';
import {formatDatabaseErrorForDisplay} from './src/db/errors';
import {verifyNativeDatabaseRuntime} from './src/db/nativeRuntimeCheck';
import {resetDatabaseStartup, startDatabase} from './src/db/startup';
import {CreateReportScreen} from './src/screens/CreateReportScreen';
import {SavedReportsScreen} from './src/screens/SavedReportsScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {
  kickUploadWorker,
  startUploadNetworkListener,
} from './src/upload';

type StartupState =
  | {status: 'initializing'}
  | {status: 'ready'}
  | {status: 'error'; message: string};

type AppScreen =
  | {name: 'create'; lastSavedId: number | null}
  | {name: 'saved'; highlightReportId: number | null; refreshToken: number}
  | {name: 'settings'; returnTo: 'create' | 'saved'};

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const [startup, setStartup] = useState<StartupState>({
    status: 'initializing',
  });

  const runStartup = useCallback(async () => {
    setStartup({status: 'initializing'});
    try {
      const init = await startDatabase();
      if (__DEV__) {
        // Fail fast in development if the native SQLite path is not live.
        await verifyNativeDatabaseRuntime(init);
      }
      // Durable queue: process any pending / recovered jobs after cold start.
      void kickUploadWorker();
      setStartup({status: 'ready'});
    } catch (error) {
      setStartup({
        status: 'error',
        message: formatDatabaseErrorForDisplay(error),
      });
    }
  }, []);

  useEffect(() => {
    void runStartup();
  }, [runStartup]);

  useEffect(() => {
    // Network regain kicks the same single-flight worker (no extra workers).
    return startUploadNetworkListener();
  }, []);

  const onRetry = useCallback(async () => {
    await resetDatabaseStartup();
    await runStartup();
  }, [runStartup]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {startup.status === 'initializing' ? (
        <StartupLoading />
      ) : startup.status === 'error' ? (
        <StartupError message={startup.message} onRetry={onRetry} />
      ) : (
        <AppContent />
      )}
    </SafeAreaProvider>
  );
}

function StartupLoading() {
  return (
    <View style={styles.centered} accessibilityLabel="Initializing database">
      <ActivityIndicator size="large" />
      <Text style={styles.loadingText}>Initializing local database…</Text>
    </View>
  );
}

function StartupError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.centered} accessibilityLabel="Database initialization error">
      <Text style={styles.errorTitle}>Database unavailable</Text>
      <Text style={styles.errorBody}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({pressed}) => [
          styles.retryButton,
          pressed && styles.retryButtonPressed,
        ]}>
        <Text style={styles.retryLabel}>Retry</Text>
      </Pressable>
    </View>
  );
}

function AppContent() {
  const [screen, setScreen] = useState<AppScreen>({
    name: 'create',
    lastSavedId: null,
  });
  const [savedHighlightId, setSavedHighlightId] = useState<number | null>(null);
  const [savedRefreshToken, setSavedRefreshToken] = useState(0);

  if (screen.name === 'settings') {
    return (
      <SettingsScreen
        onBack={() => {
          if (screen.returnTo === 'saved') {
            setScreen({
              name: 'saved',
              highlightReportId: savedHighlightId,
              refreshToken: savedRefreshToken || Date.now(),
            });
            return;
          }
          setScreen({name: 'create', lastSavedId: savedHighlightId});
        }}
      />
    );
  }

  if (screen.name === 'saved') {
    return (
      <SavedReportsScreen
        highlightReportId={screen.highlightReportId}
        onRefreshRequest={screen.refreshToken}
        onBack={() =>
          setScreen({
            name: 'create',
            lastSavedId: screen.highlightReportId,
          })
        }
        onOpenSettings={() => {
          setSavedHighlightId(screen.highlightReportId);
          setSavedRefreshToken(screen.refreshToken);
          setScreen({name: 'settings', returnTo: 'saved'});
        }}
      />
    );
  }

  return (
    <CreateReportScreen
      onSaved={reportId =>
        setScreen({
          name: 'saved',
          highlightReportId: reportId,
          refreshToken: Date.now(),
        })
      }
      onViewSaved={() =>
        setScreen({
          name: 'saved',
          highlightReportId: screen.lastSavedId,
          refreshToken: Date.now(),
        })
      }
      onOpenSettings={() =>
        setScreen({name: 'settings', returnTo: 'create'})
      }
    />
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#ffffff',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#333333',
    textAlign: 'center',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111111',
    textAlign: 'center',
    marginBottom: 8,
  },
  errorBody: {
    fontSize: 14,
    color: '#555555',
    textAlign: 'left',
    marginBottom: 20,
    alignSelf: 'stretch',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#111111',
    borderRadius: 8,
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default App;
