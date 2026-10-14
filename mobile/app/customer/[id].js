import React, { useState } from 'react';
import { Alert, FlatList, Linking, Pressable, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import EntrySheet from '../../src/components/EntrySheet';
import SmsSheet from '../../src/components/SmsSheet';
import { Button, Card, Empty, s } from '../../src/components/ui';
import { colors } from '../../src/theme';
import { useLiveQuery } from '../../src/hooks/useData';
import { customerEntries, getCustomer } from '../../src/db/queries';
import { deleteRecord, saveRecord } from '../../src/db/database';
import { money, shortDate, time } from '../../src/utils/format';
import { useAuth } from '../../src/context/AuthContext';

export default function CustomerScreen() {
  const { id } = useLocalSearchParams();
  const { business, subscription, permissions, role, employee } = useAuth();
  const customer = useLiveQuery(() => getCustomer(id), [id]);
  const entries = useLiveQuery(() => customerEntries(id), [id]) || [];
  const [sheet, setSheet] = useState(null); // { type, entry }
  const [smsOpen, setSmsOpen] = useState(false);

  if (!customer) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  function open(type, entry = null) {
    if (!subscription.active) { router.push('/subscribe'); return; }
    if (entry && role === 'cashier' && entry.created_by !== (employee && employee.id)) return;
    setSheet({ type, entry });
  }

  async function save({ amount, method, note }) {
    await saveRecord('debt_entries', {
      ...(sheet.entry ? { id: sheet.entry.id } : {}),
      customer_id: id,
      type: sheet.type,
      amount,
      note: note || (sheet.type === 'payment' && method === 'mpesa' ? 'Paid via M-Pesa' : null),
      occurred_at: sheet.entry ? sheet.entry.occurred_at : Date.now(),
      branch_id: sheet.entry ? sheet.entry.branch_id : customer.branch_id,
    });
  }

  // Sends from the owner's own phone and airtime, for cashiers or when SMS credits run out
  function remindFromPhone() {
    if (!customer.phone) return;
    const msg = `Habari ${customer.name}, this is a friendly reminder from ${business ? business.name : 'us'} that your balance is ${money(customer.balance)}. Asante!`;
    Linking.openURL(`sms:${customer.phone}?body=${encodeURIComponent(msg)}`);
  }

  function removeCustomer() {
    Alert.alert('Delete customer?', 'This removes the customer and all their deni records.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          for (const e of entries) await deleteRecord('debt_entries', e.id);
          await deleteRecord('customers', id);
          router.back();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{
        title: customer.name,
        headerRight: () => !permissions.canDelete ? null : <Pressable onPress={removeCustomer} hitSlop={10}><Ionicons name="trash-outline" size={22} color={colors.danger} /></Pressable>,
      }} />
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={(
          <>
            <Card style={{ backgroundColor: customer.balance > 0 ? colors.warningSoft : colors.primarySoft, borderWidth: 0 }}>
              <Text style={s.muted}>{customer.balance >= 0 ? 'Balance owed' : 'Customer has credit of'}</Text>
              <Text style={{ fontSize: 30, fontWeight: '800', color: customer.balance > 0 ? colors.warning : colors.primaryDark }}>{money(Math.abs(customer.balance))}</Text>
              {customer.phone ? <Text style={s.muted}>{customer.phone}</Text> : null}
            </Card>
            <View style={[s.row, { marginBottom: 12 }]}>
              <Button title="Give deni" icon="arrow-up" variant="outline" style={{ flex: 1, marginRight: 6 }} onPress={() => open('credit')} />
              <Button title="Record payment" icon="arrow-down" style={{ flex: 1, marginLeft: 6 }} onPress={() => open('payment')} />
            </View>
            {customer.phone && customer.balance > 0 ? (
              permissions.canSendSms ? (
                <Button title="Send SMS reminder" icon="chatbubble-outline" variant="ghost" onPress={() => (subscription.active ? setSmsOpen(true) : router.push('/subscribe'))} style={{ marginBottom: 8 }} />
              ) : (
                <Button title="Remind from my phone" icon="chatbubble-outline" variant="ghost" onPress={remindFromPhone} style={{ marginBottom: 8 }} />
              )
            ) : null}
            <Text style={[s.h2, { marginBottom: 8 }]}>History</Text>
          </>
        )}
        ListEmptyComponent={<Empty text="No deni records yet" />}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(item.type, item)}>
            <Card style={[s.row, { justifyContent: 'space-between', paddingVertical: 12 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{item.type === 'credit' ? 'Took on credit' : 'Paid'}</Text>
                <Text style={[s.muted, { fontSize: 12 }]}>{shortDate(item.occurred_at)} {time(item.occurred_at)}{item.note ? ` · ${item.note}` : ''}</Text>
              </View>
              <Text style={{ fontWeight: '700', color: item.type === 'credit' ? colors.warning : colors.primary }}>
                {item.type === 'credit' ? '+' : '-'}{money(item.amount)}
              </Text>
            </Card>
          </Pressable>
        )}
      />
      <SmsSheet visible={smsOpen} customers={[customer]} onClose={() => setSmsOpen(false)} />
      <EntrySheet
        visible={Boolean(sheet)}
        onClose={() => setSheet(null)}
        title={sheet && sheet.type === 'credit' ? 'Give deni' : 'Record payment'}
        initial={sheet && sheet.entry}
        showMethod={Boolean(sheet && sheet.type === 'payment')}
        notePlaceholder={sheet && sheet.type === 'credit' ? 'e.g. 2kg sugar, 1 bread' : 'Optional note'}
        onSave={save}
        onDelete={sheet && sheet.entry && permissions.canDelete ? () => deleteRecord('debt_entries', sheet.entry.id) : null}
      />
    </View>
  );
}
