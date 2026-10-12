import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Chips, Input, s } from '../src/components/ui';
import { colors } from '../src/theme';
import { api } from '../src/api/client';
import { useAuth } from '../src/context/AuthContext';
import { useBranch } from '../src/context/BranchContext';
import { timeAgo } from '../src/utils/format';

const ROLES = [
  { value: 'cashier', label: 'Cashier' },
  { value: 'manager', label: 'Manager' },
];
const ROLE_HELP = {
  cashier: 'Records sales, expenses and deni at one branch. Can fix their own entries but cannot delete.',
  manager: 'Sees everything at their branch (or all branches), can edit and delete records.',
};

export default function Team() {
  const { permissions, subscription, loadStaff } = useAuth();
  const { branches, branchName } = useBranch();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  const load = useCallback(async () => {
    try {
      setData(await api('/team/employees'));
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!permissions.canManageTeam) {
    return <View style={{ padding: 24 }}><Text style={s.muted}>Only the owner can manage staff.</Text></View>;
  }

  const activeCount = data ? data.employees.filter((e) => e.isActive).length : 0;
  const max = data ? data.limits.maxEmployees : 0;
  const branchOptions = [
    ...branches.map((b) => ({ value: b.id, label: b.name })),
    ...(form && form.role === 'manager' ? [{ value: null, label: 'All branches' }] : []),
  ];

  function openNew() {
    if (!subscription.active) { router.push('/subscribe'); return; }
    if (activeCount >= max) {
      Alert.alert('Staff limit reached', `Your plan allows ${max} staff account${max === 1 ? '' : 's'}. Upgrade to add more.`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'See plans', onPress: () => router.push('/subscribe') },
      ]);
      return;
    }
    setForm({ name: '', phone: '', pin: '', role: 'cashier', branchId: branches[0] && branches[0].id, isActive: true });
  }

  function openEdit(e) {
    setForm({ id: e.id, name: e.name, phone: e.phone, pin: '', role: e.role, branchId: e.branchId, isActive: e.isActive });
  }

  async function save() {
    setSaving(true);
    try {
      if (form.id) {
        const body = { name: form.name, role: form.role, branchId: form.branchId, isActive: form.isActive };
        if (form.pin) body.pin = form.pin;
        await api(`/team/employees/${form.id}`, { method: 'PATCH', body });
      } else {
        await api('/team/employees', { method: 'POST', body: form });
      }
      setForm(null);
      await load();
      loadStaff();
    } catch (e) {
      Alert.alert('Could not save', e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[s.muted, { marginBottom: 12 }]}>
        Staff sign in on their own phone with their number and PIN. Their records sync to your account.
        {data ? ` ${activeCount} of ${max} staff accounts used.` : ''}
      </Text>
      {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
      {!data && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {data && data.employees.map((e) => (
        <Pressable key={e.id} onPress={() => openEdit(e)}>
          <Card style={{ opacity: e.isActive ? 1 : 0.55 }}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <Text style={s.h2}>{e.name}</Text>
              <Text style={{ color: colors.primary, fontWeight: '700', textTransform: 'capitalize' }}>{e.isActive ? e.role : 'Turned off'}</Text>
            </View>
            <Text style={s.muted}>{e.phone} · {e.branchId ? branchName(e.branchId) : 'All branches'}</Text>
            <Text style={[s.muted, { fontSize: 12 }]}>Last active {e.lastSeenAt ? timeAgo(new Date(e.lastSeenAt).getTime()) : 'never'}</Text>
          </Card>
        </Pressable>
      ))}
      {data ? <Button title="Add staff" icon="person-add-outline" onPress={openNew} /> : null}

      <Modal visible={Boolean(form)} transparent animationType="slide" onRequestClose={() => setForm(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <ScrollView style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' }} contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled">
            {form ? (
              <>
                <Text style={[s.h2, { marginBottom: 16 }]}>{form.id ? 'Edit staff' : 'New staff member'}</Text>
                <Input label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} placeholder="e.g. Brian Otieno" />
                {!form.id ? <Input label="Their Safaricom number" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" placeholder="07..." /> : null}
                <Input
                  label={form.id ? 'New PIN (leave empty to keep)' : 'Their PIN'}
                  value={form.pin}
                  onChangeText={(v) => setForm({ ...form, pin: v })}
                  keyboardType="number-pad" secureTextEntry maxLength={6} placeholder="4 to 6 digits"
                />
                <Text style={s.label}>Role</Text>
                <Chips options={ROLES} value={form.role} onChange={(v) => setForm({ ...form, role: v, branchId: v === 'cashier' && !form.branchId ? branches[0] && branches[0].id : form.branchId })} />
                <Text style={[s.muted, { fontSize: 12, marginTop: -6, marginBottom: 12 }]}>{ROLE_HELP[form.role]}</Text>
                <Text style={s.label}>Branch</Text>
                <Chips options={branchOptions} value={form.branchId} onChange={(v) => setForm({ ...form, branchId: v })} />
                {form.id ? (
                  <View style={[s.row, { justifyContent: 'space-between', marginBottom: 16 }]}>
                    <Text style={{ color: colors.text }}>Account active</Text>
                    <Switch value={form.isActive} onValueChange={(v) => setForm({ ...form, isActive: v })} trackColor={{ true: colors.primary }} />
                  </View>
                ) : null}
                <Button title="Save" onPress={save} loading={saving} disabled={!form.name || (!form.id && (!form.phone || form.pin.length < 4))} />
                <Button title="Cancel" variant="ghost" onPress={() => setForm(null)} style={{ marginTop: 6 }} />
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}
