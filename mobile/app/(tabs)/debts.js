import React, { useState } from 'react';
import { FlatList, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, Card, Empty, Input, SyncPill, s } from '../../src/components/ui';
import { colors } from '../../src/theme';
import { useLiveQuery } from '../../src/hooks/useData';
import { customersWithBalance } from '../../src/db/queries';
import { saveRecord } from '../../src/db/database';
import { money, timeAgo } from '../../src/utils/format';
import { useAuth } from '../../src/context/AuthContext';
import { useBranch } from '../../src/context/BranchContext';
import BranchSwitcher from '../../src/components/BranchSwitcher';
import SmsSheet from '../../src/components/SmsSheet';

export default function Debts() {
  const { subscription, permissions } = useAuth();
  const { branchFilter, defaultBranchId, branches, branchName } = useBranch();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [remindOpen, setRemindOpen] = useState(false);
  const customers = useLiveQuery(() => customersWithBalance(search, branchFilter), [search, branchFilter]) || [];
  const owed = customers.reduce((n, c) => n + Math.max(0, c.balance), 0);
  // Everyone who owes and has a phone number, biggest balance first (the server takes up to 100 at a time)
  const remindable = customers.filter((c) => c.balance > 0 && c.phone).slice(0, 100);

  function openAdd() {
    if (!subscription.active) { router.push('/subscribe'); return; }
    setName(''); setPhone(''); setAdding(true);
  }

  async function addCustomer() {
    if (!name.trim()) return;
    const c = await saveRecord('customers', { name: name.trim(), phone: phone.trim() || null, notes: null, branch_id: defaultBranchId });
    setAdding(false);
    router.push(`/customer/${c.id}`);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={s.h1}>Deni</Text>
          <SyncPill />
        </View>
        <BranchSwitcher />
        <Card style={{ marginTop: 12, backgroundColor: colors.warningSoft, borderWidth: 0 }}>
          <Text style={s.muted}>Customers owe you</Text>
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.warning }}>{money(owed)}</Text>
          <Text style={s.muted}>{customers.filter((c) => c.balance > 0).length} customers with unpaid deni</Text>
          {permissions.canSendSms && remindable.length && !search ? (
            <Button
              title={`SMS reminder to ${remindable.length === 1 ? '1 customer' : `all ${remindable.length}`}`}
              icon="chatbubbles-outline"
              variant="outline"
              onPress={() => (subscription.active ? setRemindOpen(true) : router.push('/subscribe'))}
              style={{ marginTop: 10 }}
            />
          ) : null}
        </Card>
        <View style={[s.row, { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search customer" placeholderTextColor={colors.muted} style={{ flex: 1, height: 44, marginLeft: 8, color: colors.text }} />
        </View>
      </View>

      <FlatList
        data={customers}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListEmptyComponent={<Empty icon="people-outline" text="No customers yet. Tap + to add someone who takes goods on credit." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/customer/${item.id}`)}>
            <Card style={[s.row, { paddingVertical: 12 }]}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text style={{ color: colors.primaryDark, fontWeight: '800' }}>{item.name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{item.name}</Text>
                <Text style={[s.muted, { fontSize: 12 }]}>{item.phone || 'No phone'} · {!branchFilter && branches.length > 1 ? `${branchName(item.branch_id)} · ` : ''}{item.last_activity ? timeAgo(item.last_activity) : 'no entries'}</Text>
              </View>
              <Text style={{ fontWeight: '700', color: item.balance > 0 ? colors.warning : colors.primary }}>
                {item.balance > 0 ? money(item.balance) : item.balance < 0 ? `+${money(-item.balance)}` : 'Cleared'}
              </Text>
            </Card>
          </Pressable>
        )}
      />

      <Pressable onPress={openAdd} style={{ position: 'absolute', right: 20, bottom: 24, backgroundColor: colors.primary, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 4 }}>
        <Ionicons name="person-add" size={26} color="#fff" />
      </Pressable>

      <SmsSheet visible={remindOpen} customers={remindable} onClose={() => setRemindOpen(false)} />

      <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 }}>
          <Card style={{ padding: 20 }}>
            <Text style={[s.h2, { marginBottom: 16 }]}>New customer</Text>
            <Input label="Name" value={name} onChangeText={setName} autoFocus placeholder="e.g. Mama Wanjiku" />
            <Input label="Phone (optional)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="07..." />
            <Button title="Add customer" onPress={addCustomer} disabled={!name.trim()} />
            <Button title="Cancel" variant="ghost" onPress={() => setAdding(false)} style={{ marginTop: 6 }} />
          </Card>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
