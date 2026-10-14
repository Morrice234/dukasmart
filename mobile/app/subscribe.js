import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Input, s } from '../src/components/ui';
import { colors } from '../src/theme';
import { api } from '../src/api/client';
import { getMeta, setMeta } from '../src/db/database';
import { useAuth } from '../src/context/AuthContext';
import { syncNow } from '../src/sync/syncEngine';
import { money } from '../src/utils/format';

const POLL_MS = 4000;
const POLL_FOR_MS = 120000;

export default function Subscribe() {
  const { business, refresh, permissions } = useAuth();
  const [plans, setPlans] = useState(null);
  const [selected, setSelected] = useState(null);
  const [phone, setPhone] = useState(business ? `0${business.phone.slice(3)}` : '');
  const [stage, setStage] = useState('choose'); // choose | waiting | done | failed
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    (async () => {
      const cached = await getMeta('plans');
      if (cached) applyPlans(JSON.parse(cached));
      try {
        const res = await api('/subscriptions/plans');
        await setMeta('plans', JSON.stringify(res.plans));
        applyPlans(res.plans);
      } catch (e) {
        if (!cached) setMessage(e.message);
      }
    })();
    return () => clearTimeout(pollRef.current);
  }, []);

  function applyPlans(list) {
    setPlans(list);
    setSelected((cur) => cur || (list[0] && list[0].code));
  }

  async function pay() {
    setLoading(true);
    setMessage('');
    try {
      const res = await api('/subscriptions/pay', { method: 'POST', body: { planCode: selected, phone } });
      setStage('waiting');
      setMessage(res.message);
      poll(res.paymentId, Date.now());
    } catch (e) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  }

  function poll(paymentId, startedAt) {
    pollRef.current = setTimeout(async () => {
      try {
        const res = await api(`/subscriptions/payments/${paymentId}`);
        if (res.payment.status === 'success') {
          await refresh();
          syncNow();
          setStage('done');
          setMessage(res.payment.receipt ? `M-Pesa receipt ${res.payment.receipt}` : 'Payment received');
          return;
        }
        if (res.payment.status !== 'pending') {
          setStage('failed');
          setMessage(res.payment.status === 'cancelled' ? 'You cancelled the payment.' : (res.payment.resultDesc || 'Payment failed.'));
          return;
        }
      } catch {
        // network hiccup, keep polling
      }
      if (Date.now() - startedAt < POLL_FOR_MS) poll(paymentId, startedAt);
      else { setStage('failed'); setMessage('We did not get a confirmation yet. If money left your M-Pesa, your plan will activate shortly.'); }
    }, POLL_MS);
  }

  if (!permissions.canPay) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Ionicons name="lock-closed-outline" size={48} color={colors.muted} />
        <Text style={[s.h2, { marginTop: 12, textAlign: 'center' }]}>Ask the owner to renew</Text>
        <Text style={[s.muted, { textAlign: 'center', marginTop: 8 }]}>Only the business owner can pay for the subscription.</Text>
        <Button title="Back" variant="outline" onPress={() => router.back()} style={{ marginTop: 20, alignSelf: 'stretch' }} />
      </View>
    );
  }

  if (stage === 'waiting') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.h2, { marginTop: 16, textAlign: 'center' }]}>Check your phone</Text>
        <Text style={[s.muted, { textAlign: 'center', marginTop: 8 }]}>Enter your M-Pesa PIN on the prompt to complete payment. {message}</Text>
      </View>
    );
  }

  if (stage === 'done' || stage === 'failed') {
    const ok = stage === 'done';
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.bg }}>
        <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={72} color={ok ? colors.primary : colors.danger} />
        <Text style={[s.h2, { marginTop: 12 }]}>{ok ? 'You are subscribed. Asante!' : 'Payment not completed'}</Text>
        <Text style={[s.muted, { textAlign: 'center', marginTop: 8 }]}>{message}</Text>
        <Button title={ok ? 'Continue' : 'Try again'} onPress={() => (ok ? router.back() : setStage('choose'))} style={{ marginTop: 20, alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Text style={[s.h1, { marginBottom: 4 }]}>Choose a plan</Text>
      <Text style={[s.muted, { marginBottom: 16 }]}>Pay with M-Pesa. Your records are kept safe whatever you choose.</Text>

      {!plans ? <ActivityIndicator color={colors.primary} /> : plans.map((p) => {
        const active = p.code === selected;
        const features = Array.isArray(p.features) ? p.features : [];
        return (
          <Pressable key={p.code} onPress={() => setSelected(p.code)}>
            <Card style={{ borderColor: active ? colors.primary : colors.border, borderWidth: active ? 2 : 1 }}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={s.h2}>{p.name}</Text>
                <Text style={{ fontSize: 18, fontWeight: '800', color: colors.primary }}>
                  {money(p.price_kes)}<Text style={s.muted}> / {p.duration_days} days</Text>
                </Text>
              </View>
              {[...features, ...(p.sms_credits ? [`${p.sms_credits} SMS reminders to customers who owe`] : [])].map((f) => (
                <View key={f} style={[s.row, { marginTop: 6 }]}>
                  <Ionicons name="checkmark" size={16} color={colors.primary} />
                  <Text style={{ marginLeft: 6, color: colors.text }}>{f}</Text>
                </View>
              ))}
            </Card>
          </Pressable>
        );
      })}

      <Input label="M-Pesa number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="07..." />
      {message ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{message}</Text> : null}
      <Button title="Pay with M-Pesa" onPress={pay} loading={loading} disabled={!selected || !phone} />
    </ScrollView>
  );
}
