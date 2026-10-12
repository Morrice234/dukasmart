import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';
import { useSyncState } from '../hooks/useData';
import { syncNow } from '../sync/syncEngine';
import { timeAgo } from '../utils/format';

export function Card({ style, children }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }) {
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [s.btn, { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : (
        <View style={s.row}>
          {icon ? <Ionicons name={icon} size={18} color={v.fg} style={{ marginRight: 6 }} /> : null}
          <Text style={[s.btnText, { color: v.fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const VARIANTS = {
  primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
  outline: { bg: '#fff', fg: colors.primary, border: colors.primary },
  danger: { bg: colors.danger, fg: '#fff', border: colors.danger },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export function Input({ label, style, ...props }) {
  return (
    <View style={{ marginBottom: 14 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.muted} style={[s.input, style]} {...props} />
    </View>
  );
}

export function Chips({ options, value, onChange }) {
  return (
    <View style={[s.row, { flexWrap: 'wrap', marginBottom: 14 }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={String(o.value)} onPress={() => onChange(o.value)} style={[s.chip, active && s.chipActive]}>
            <Text style={[s.chipText, active && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Banner({ tone = 'warning', text, action, onPress }) {
  const t = tone === 'danger'
    ? { bg: colors.dangerSoft, fg: colors.danger }
    : tone === 'info' ? { bg: colors.primarySoft, fg: colors.primaryDark } : { bg: colors.warningSoft, fg: colors.warning };
  return (
    <Pressable onPress={onPress} style={[s.banner, { backgroundColor: t.bg }]}>
      <Text style={{ color: t.fg, flex: 1, fontWeight: '500' }}>{text}</Text>
      {action ? <Text style={{ color: t.fg, fontWeight: '700', marginLeft: 8 }}>{action}</Text> : null}
    </Pressable>
  );
}

export function SyncPill() {
  const st = useSyncState();
  const map = {
    syncing: { icon: 'sync', text: 'Syncing', color: colors.primary },
    offline: { icon: 'cloud-offline-outline', text: st.pending ? `Offline, ${st.pending} waiting` : 'Offline', color: colors.warning },
    error: { icon: 'alert-circle-outline', text: 'Sync failed', color: colors.danger },
    blocked: { icon: 'lock-closed-outline', text: 'Backup paused', color: colors.danger },
    idle: { icon: 'cloud-done-outline', text: st.pending ? `${st.pending} waiting` : `Backed up ${timeAgo(st.lastSyncedAt)}`, color: colors.primary },
  };
  const m = map[st.status] || map.idle;
  return (
    <Pressable onPress={syncNow} style={[s.pill, { borderColor: m.color }]}>
      <Ionicons name={m.icon} size={14} color={m.color} />
      <Text style={{ color: m.color, fontSize: 12, marginLeft: 4, fontWeight: '600' }}>{m.text}</Text>
    </Pressable>
  );
}

export function Empty({ icon = 'file-tray-outline', text }) {
  return (
    <View style={{ alignItems: 'center', padding: 32 }}>
      <Ionicons name={icon} size={40} color={colors.border} />
      <Text style={{ color: colors.muted, marginTop: 8, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

export const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  btn: { height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, paddingHorizontal: 16 },
  btnText: { fontSize: 16, fontWeight: '700' },
  label: { color: colors.muted, marginBottom: 6, fontSize: 13, fontWeight: '600' },
  input: { height: 50, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, backgroundColor: '#fff', color: colors.text },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.border, marginRight: 8, marginBottom: 8, backgroundColor: '#fff' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '600' },
  banner: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12, marginBottom: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  h1: { fontSize: 24, fontWeight: '800', color: colors.text },
  h2: { fontSize: 17, fontWeight: '700', color: colors.text },
  muted: { color: colors.muted },
});
