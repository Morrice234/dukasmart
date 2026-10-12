import React, { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Input, s } from '../src/components/ui';
import { colors } from '../src/theme';
import { useAuth } from '../src/context/AuthContext';
import { useBranch } from '../src/context/BranchContext';
import { deleteRecord, saveRecord } from '../src/db/database';
import { branchRecordCount } from '../src/db/queries';

export default function Branches() {
  const { permissions, limits, subscription } = useAuth();
  const { branches, current, setCurrent } = useBranch();
  const [editing, setEditing] = useState(null); // null | {} for new | branch row
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');

  if (!permissions.canManageBranches) {
    return <View style={{ padding: 24 }}><Text style={s.muted}>Only the owner can manage branches.</Text></View>;
  }

  const atLimit = branches.length >= limits.maxBranches;

  function open(branch) {
    if (!subscription.active) { router.push('/subscribe'); return; }
    if (!branch && atLimit) {
      Alert.alert('Branch limit reached', `Your plan allows ${limits.maxBranches} branch${limits.maxBranches === 1 ? '' : 'es'}. Upgrade to the Business plan to add more.`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'See plans', onPress: () => router.push('/subscribe') },
      ]);
      return;
    }
    setName(branch ? branch.name : '');
    setLocation(branch ? branch.location || '' : '');
    setEditing(branch || {});
  }

  async function save() {
    if (!name.trim()) return;
    await saveRecord('branches', { ...(editing.id ? { id: editing.id } : {}), name: name.trim(), location: location.trim() || null });
    setEditing(null);
  }

  async function remove(branch) {
    if (branches.length <= 1) { Alert.alert('Keep at least one branch'); return; }
    const n = await branchRecordCount(branch.id);
    if (n > 0) {
      Alert.alert('Branch has records', `${branch.name} still has ${n} records. Branches with records cannot be removed, but you can rename it.`);
      return;
    }
    Alert.alert(`Remove ${branch.name}?`, '', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await deleteRecord('branches', branch.id);
          if (current === branch.id) setCurrent('all');
          setEditing(null);
        },
      },
    ]);
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[s.muted, { marginBottom: 12 }]}>
        Each branch keeps its own sales, expenses and deni book. You are using {branches.length} of {limits.maxBranches} branches on your plan.
      </Text>
      {branches.map((b) => (
        <Pressable key={b.id} onPress={() => open(b)}>
          <Card style={[s.row, { justifyContent: 'space-between' }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.h2}>{b.name}</Text>
              {b.location ? <Text style={s.muted}>{b.location}</Text> : null}
            </View>
            <Ionicons name="create-outline" size={20} color={colors.muted} />
          </Card>
        </Pressable>
      ))}
      <Button title="Add branch" icon="add" onPress={() => open(null)} variant={atLimit ? 'outline' : 'primary'} />

      <Modal visible={Boolean(editing)} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 }}>
          <Card style={{ padding: 20 }}>
            <Text style={[s.h2, { marginBottom: 16 }]}>{editing && editing.id ? 'Edit branch' : 'New branch'}</Text>
            <Input label="Branch name" value={name} onChangeText={setName} autoFocus placeholder="e.g. Kawangware shop" />
            <Input label="Location (optional)" value={location} onChangeText={setLocation} placeholder="e.g. Next to Naivas" />
            <Button title="Save" onPress={save} disabled={!name.trim()} />
            {editing && editing.id ? <Button title="Remove branch" variant="ghost" onPress={() => remove(editing)} style={{ marginTop: 6 }} /> : null}
            <Button title="Cancel" variant="ghost" onPress={() => setEditing(null)} style={{ marginTop: 6 }} />
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}
