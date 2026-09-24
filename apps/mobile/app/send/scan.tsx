import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Component, useRef, useState, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { useBackend } from '@entole/core/backend';

import { Button } from '@/components/ui/Button';
import { Header } from '@/components/ui/Header';
import { ActionBar, Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { cleanNote, sendParamsFor } from '@/lib/recipient';

type CameraModule = typeof import('expo-camera');

/**
 * The camera is a native module. An installed build made before it was added
 * does not contain it, and importing it there throws. The import is guarded so
 * that build shows a plain fallback (paste the code instead) and never crashes.
 */
let Camera: CameraModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Camera = require('expo-camera') as CameraModule;
} catch {
  Camera = null;
}

const NOT_A_CODE = "That doesn't look like an Entole code.";
const NOTHING_TO_PASTE = 'There is nothing to paste. Copy their code or link first.';

/** Something in the camera view failing at render time falls back, too. */
class CameraBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Reads the clipboard and, if it holds a code or link, goes on to the amount. */
function usePasteToSend(note: string | undefined) {
  const router = useRouter();
  const backend = useBackend();
  const [problem, setProblem] = useState<string | null>(null);

  async function paste() {
    setProblem(null);
    const clip = (await Clipboard.getStringAsync()).trim();
    if (!clip) {
      setProblem(NOTHING_TO_PASTE);
      return;
    }
    const target = sendParamsFor(clip, note, backend.source.resolveContactId);
    if (!target) {
      setProblem(NOT_A_CODE);
      return;
    }
    router.replace({ pathname: '/send', params: target });
  }

  return { paste, problem };
}

function Notice({ title, body, problem }: { title: string; body: string; problem?: string | null }) {
  return (
    <View className="flex-1 justify-center px-gutter-lg pb-16">
      <Text className="font-strong text-title text-ink">{title}</Text>
      <Text className="mt-2 font-body text-body-sm text-slate">{body}</Text>
      {problem ? <Text className="mt-4 font-body text-label text-halt">{problem}</Text> : null}
    </View>
  );
}

/** No camera to scan with: paste is the way in. */
function Unavailable({ note }: { note: string | undefined }) {
  const { paste, problem } = usePasteToSend(note);
  return (
    <>
      <Notice
        title="Scanning needs the updated app"
        body="This version of Entole can’t use the camera yet. Paste their code or link instead."
        problem={problem}
      />
      <ActionBar>
        <Button label="Paste" onPress={() => void paste()} />
      </ActionBar>
    </>
  );
}

function Scanner({ camera, note }: { camera: CameraModule; note: string | undefined }) {
  const router = useRouter();
  const backend = useBackend();
  const { CameraView, useCameraPermissions } = camera;
  const [permission, requestPermission] = useCameraPermissions();
  const { paste, problem: pasteProblem } = usePasteToSend(note);
  const [problem, setProblem] = useState<string | null>(null);
  const locked = useRef(false);

  function onScanned({ data }: { data: string }) {
    // The camera reports the same code many times a second; act on the first.
    if (locked.current) return;
    locked.current = true;
    const target = sendParamsFor(data, note, backend.source.resolveContactId);
    if (!target) {
      setProblem(NOT_A_CODE);
      return;
    }
    void Haptics.selectionAsync();
    router.replace({ pathname: '/send', params: target });
  }

  function tryAgain() {
    setProblem(null);
    locked.current = false;
  }

  if (permission === null) {
    return (
      <View className="flex-1 px-gutter pt-2" accessibilityLabel="Getting the camera ready">
        <Skeleton className="flex-1 rounded-panel" />
      </View>
    );
  }

  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <>
        <Notice
          title={blocked ? 'The camera is off for Entole' : 'Scan their QR code'}
          body={
            blocked
              ? 'Turn the camera on for Entole in Settings to scan a code. Or paste their code instead.'
              : 'Entole uses the camera to scan a payment code.'
          }
          problem={pasteProblem}
        />
        <ActionBar>
          <Button label="Paste" variant="secondary" onPress={() => void paste()} />
          {blocked ? (
            <Button label="Open settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label="Allow camera" onPress={() => void requestPermission()} />
          )}
        </ActionBar>
      </>
    );
  }

  return (
    <>
      <View className="flex-1 px-gutter pt-2">
        <View className="flex-1 overflow-hidden rounded-panel bg-track">
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={problem ? undefined : onScanned}
          />
          <View pointerEvents="none" className="absolute inset-0 items-center justify-center">
            <View className="aspect-square w-3/5 rounded-card border-2 border-white" />
          </View>
        </View>
        <View className="min-h-[56px] justify-center px-1 py-3">
          {(problem ?? pasteProblem) ? (
            <Text className="font-body text-label text-halt">{problem ?? pasteProblem}</Text>
          ) : (
            <Text className="font-body text-label text-slate">Hold their QR code inside the square.</Text>
          )}
        </View>
      </View>
      <ActionBar>
        <Button label="Paste" variant="secondary" onPress={() => void paste()} />
        {problem ? <Button label="Try again" onPress={tryAgain} /> : null}
      </ActionBar>
    </>
  );
}

/** Scan someone's QR code to pay them — the same door as pasting a code or link. */
export default function ScanRecipient() {
  const params = useLocalSearchParams<{ note?: string }>();
  const note = cleanNote(params.note);

  return (
    <Screen>
      <Header title="Scan a code" />
      {Camera ? (
        <CameraBoundary fallback={<Unavailable note={note} />}>
          <Scanner camera={Camera} note={note} />
        </CameraBoundary>
      ) : (
        <Unavailable note={note} />
      )}
    </Screen>
  );
}
