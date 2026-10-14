import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, s } from '../src/components/ui';
import { colors } from '../src/theme';
import { api } from '../src/api/client';
import { useAuth } from '../src/context/AuthContext';
import { useBranch } from '../src/context/BranchContext';
import { getDb, saveRecord } from '../src/db/database';
import { syncNow } from '../src/sync/syncEngine';
import { parseMpesaMessages, saleIdFor } from '../src/utils/mpesaSms';
import { money, shortDate, time } from '../src/utils/format';

export default function TillScreen() {
  const { business, subscription } = useAuth();
  const { defaultBranchId } = useBranch();
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [text, setText] = useState('');
  const [found, setFound] = useState(null); // parsed payments waiting to be added
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api('/till'));
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    await syncNow();
    await load();
    setRefreshing(false);
  }

  // Marks payments already in the app (from the till or pasted earlier) so they are not added again
  async function read() {
    const list = parseMpesaMessages(text);
    if (!list.length) {
      Alert.alert('No payments found', 'Paste the M-Pesa messages for money you received. Each one starts with the M-Pesa code, like "SJK3ABC123 Confirmed".');
      return;
    }
    const db = await getDb();
    const withIds = [];
    for (const p of list) {
      const id = await saleIdFor(business.id, p.code);
      const existing = await db.getFirstAsync('SELECT id FROM sales WHERE id = ?', [id]);
      withIds.push({ ...p, id, exists: Boolean(existing) });
    }
    setFound(withIds);
  }

  async function addFound() {
    const fresh = found.filter((p) => !p.exists);
    setAdding(true);
    try {
      for (const p of fresh) {
        await saveRecord('sales', {
          id: p.id,
          amount: p.amount,
          method: 'mpesa',
          description: `M-Pesa ${p.code}${p.name ? ` from ${p.name}` : ''}`,
          occurred_at: p.occurredAt,
          branch_id: defaultBranchId,
        });
      }
      Alert.alert('Sales added', `${fresh.length} M-Pesa payment${fresh.length === 1 ? '' : 's'} added to your sales.`);
      setFound(null);
      setText('');
    } catch (e) {
      Alert.alert('Could not add', e.message);
    } finally {
      setAdding(false);
    }
  }

  const conn = info && info.connection;
  const live = conn && (conn.status === 'active' || conn.status === 'pending');
  const fresh = found ? found.filter((p) => !p.exists) : [];

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.primary]} />}
    >
      {!info && !error ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 20 }} /> : null}
      {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}

      {info ? (
        live ? (
          <Card style={{ backgroundColor: colors.primarySoft, borderWidth: 0 }}>
            <View style={s.row}>
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              <Text style={[s.h2, { marginLeft: 6, color: colors.primaryDark }]}>Till {conn.tillNumber || conn.shortcode} connected</Text>
            </View>
            <Text style={[s.muted, { marginTop: 6 }]}>
              Every payment to your till is added to Sales by itself, usually within a minute. Pull down to refresh.
            </Text>
            {info.today ? (
              <Text style={{ marginTop: 8, fontWeight: '700', color: colors.text }}>
                Today: {money(info.today.total)} from {info.today.n} payment{info.today.n === 1 ? '' : 's'}
              </Text>
            ) : null}
            {conn.lastPaymentAt ? <Text style={[s.muted, { fontSize: 12 }]}>Last payment {shortDate(new Date(conn.lastPaymentAt).getTime())} {time(new Date(conn.lastPaymentAt).getTime())}</Text> : null}
          </Card>
        ) : (
          <Card>
            <Text style={[s.h2, { marginBottom: 6 }]}>Record till payments automatically</Text>
            <Text style={{ color: colors.text, marginBottom: 6 }}>
              Connect your Lipa na M-Pesa till and every payment customers make shows up in Sales without typing.
            </Text>
            <Text style={s.muted}>
              You need the login for your M-Pesa business portal (the one Safaricom gave you with the till). Contact DukaSmart and we will connect it with you. It takes about 15 minutes.
            </Text>
            {conn && conn.status === 'disabled' ? <Text style={[s.muted, { marginTop: 6 }]}>Your till connection is paused.</Text> : null}
          </Card>
        )
      ) : null}

      {live && info.payments.length ? (
        <>
          <Text style={[s.h2, { marginVertical: 8 }]}>Recent till payments</Text>
          {info.payments.map((p) => (
            <Card key={p.trans_id} style={[s.row, { justifyContent: 'space-between', paddingVertical: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{p.payer_name || 'Customer'}</Text>
                <Text style={[s.muted, { fontSize: 12 }]}>{p.trans_id} · {shortDate(Number(p.paid_at))} {time(Number(p.paid_at))}</Text>
              </View>
              <Text style={{ fontWeight: '700', color: colors.primary }}>{money(p.amount)}</Text>
            </Card>
          ))}
        </>
      ) : null}

      <Text style={[s.h2, { marginTop: 16, marginBottom: 4 }]}>Add from M-Pesa messages</Text>
      <Text style={[s.muted, { marginBottom: 10 }]}>
        {live
          ? 'For money received on another number, like Pochi la Biashara or your personal line. '
          : 'Works with any till, Pochi la Biashara or personal line. '}
        In your messages app, long-press the M-Pesa messages, copy them, and paste them here. Payments already in the app are skipped.
      </Text>
      <TextInput
        value={text}
        onChangeText={(t) => { setText(t); setFound(null); }}
        multiline
        placeholder="Paste M-Pesa messages here"
        placeholderTextColor={colors.muted}
        style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, minHeight: 110, color: colors.text, textAlignVertical: 'top', marginBottom: 10 }}
      />

      {!found ? (
        <Button title="Read payments" icon="scan-outline" variant="outline" onPress={read} disabled={!text.trim()} />
      ) : (
        <>
          {found.map((p) => (
            <Card key={p.code} style={[s.row, { justifyContent: 'space-between', paddingVertical: 10, opacity: p.exists ? 0.5 : 1 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '600', color: colors.text }}>{p.name || 'Customer'}</Text>
                <Text style={[s.muted, { fontSize: 12 }]}>
                  {p.code} · {shortDate(p.occurredAt)} {time(p.occurredAt)}{p.exists ? ' · already recorded' : ''}
                </Text>
              </View>
              <Text style={{ fontWeight: '700', color: colors.primary }}>{money(p.amount)}</Text>
            </Card>
          ))}
          {fresh.length ? (
            <Button
              title={`Add ${fresh.length} sale${fresh.length === 1 ? '' : 's'} (${money(fresh.reduce((n, p) => n + p.amount, 0))})`}
              onPress={() => (subscription.active ? addFound() : Alert.alert('Subscription needed', 'Renew your plan to add new records.'))}
              loading={adding}
            />
          ) : (
            <Text style={[s.muted, { textAlign: 'center' }]}>All of these are already in your sales.</Text>
          )}
          <Button title="Clear" variant="ghost" onPress={() => { setFound(null); setText(''); }} style={{ marginTop: 6 }} />
        </>
      )}
    </ScrollView>
  );
}
