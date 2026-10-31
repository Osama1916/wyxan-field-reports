/**
 * FieldReports app entry.
 * Cold-starts native SQLite once per process, then renders the main UI.
 *
 * @format
 */

import {NewAppScreen} from '@react-native/new-app-screen';
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
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {formatDatabaseErrorForDisplay} from './src/db/errors';
import {verifyNativeDatabaseRuntime} from './src/db/nativeRuntimeCheck';
import {resetDatabaseStartup, startDatabase} from './src/db/startup';

type StartupState =
  | {status: 'initializing'}
  | {status: 'ready'}
  | {status: 'error'; message: string};

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
        const verification = await verifyNativeDatabaseRuntime(init);
        console.info(
          '[FieldReports] Database initialization completed.',
          `Migration version: ${verification.latestMigrationVersion}`,
          `(applied: [${verification.migrationVersions.join(', ')}]).`,
          'Successful SELECT query against reports and upload_jobs.',
        );
      }
      setStartup({status: 'ready'});
    } catch (error) {
      if (__DEV__) {
        console.error('[FieldReports] database startup failed', error);
      }
      setStartup({
        status: 'error',
        message: formatDatabaseErrorForDisplay(error),
      });
    }
  }, []);

  useEffect(() => {
    void runStartup();
  }, [runStartup]);

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
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <NewAppScreen
        templateFileName="App.tsx"
        safeAreaInsets={safeAreaInsets}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
