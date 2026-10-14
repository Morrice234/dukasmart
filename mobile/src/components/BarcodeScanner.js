import React, { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, s } from './ui';
import { colors } from '../theme';

// Shop products mostly carry EAN-13 barcodes; QR codes and other common types work too
const TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'qr'];
const SAME_CODE_PAUSE_MS = 2000;

// Full-screen camera that reads barcodes and QR codes.
// onScan(code) may return { message } or { error } to show; return { close: true } to close.
// With continuous, the camera stays open so a cashier can scan item after item.
export default function BarcodeScanner({ visible, onClose, onScan, continuous = false, title = 'Scan barcode or QR code' }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [note, setNote] = useState(null); // { text, error }
  const busy = useRef(false);
  const last = useRef({ code: null, at: 0 });

  useEffect(() => {
    if (visible) {
      setNote(null); setTorch(false);
      busy.current = false;
      last.current = { code: null, at: 0 };
      if (permission && !permission.granted && permission.canAskAgain) requestPermission();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handle({ data }) {
    const code = String(data || '').trim();
    if (!code || busy.current) return;
    const now = Date.now();
    // The camera sees the same code many times a second; count it once
    if (code === last.current.code && now - last.current.at < SAME_CODE_PAUSE_MS) return;
    last.current = { code, at: now };
    busy.current = true;
    Vibration.vibrate(60);
    try {
      const result = (await onScan(code)) || {};
      if (result.close || !continuous) { onClose(); return; }
      setNote(result.error ? { text: result.error, error: true } : result.message ? { text: result.message } : null);
    } catch (e) {
      setNote({ text: e.message, error: true });
    } finally {
      busy.current = false;
    }
  }

  let body;
  if (!permission) {
    body = null;
  } else if (!permission.granted) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Ionicons name="camera-outline" size={56} color={colors.muted} />
        <Text style={[s.h2, { marginTop: 12, textAlign: 'center' }]}>Allow the camera to scan</Text>
        <Text style={[s.muted, { textAlign: 'center', marginVertical: 10 }]}>DukaSmart only uses the camera to read barcodes. No photos are taken or saved.</Text>
        {permission.canAskAgain
          ? <Button title="Allow camera" onPress={requestPermission} />
          : <Button title="Open settings" onPress={() => Linking.openSettings()} />}
        <Button title="Cancel" variant="ghost" onPress={onClose} style={{ marginTop: 6 }} />
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{ barcodeTypes: TYPES }}
          onBarcodeScanned={visible ? handle : undefined}
        />
        <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
          <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={30} color="#fff" /></Pressable>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={() => setTorch((t) => !t)} hitSlop={12}>
            <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={26} color="#fff" />
          </Pressable>
        </View>
        <View style={styles.frameWrap} pointerEvents="none">
          <View style={styles.frame} />
          <Text style={styles.hint}>Hold the code inside the box</Text>
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 16 }]}>
          {note ? (
            <View style={[styles.note, { backgroundColor: note.error ? colors.danger : colors.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700', textAlign: 'center' }}>{note.text}</Text>
            </View>
          ) : null}
          {continuous ? <Button title="Done" onPress={onClose} /> : null}
        </View>
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {visible ? body : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.35)' },
  title: { color: '#fff', fontWeight: '700', fontSize: 16, flex: 1, textAlign: 'center' },
  frameWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  frame: { width: '78%', aspectRatio: 1.6, borderWidth: 3, borderColor: '#fff', borderRadius: 16 },
  hint: { color: '#fff', marginTop: 12, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 0 },
  note: { borderRadius: 12, padding: 12, marginBottom: 10 },
});
