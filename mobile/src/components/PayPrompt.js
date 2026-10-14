import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input, s } from './ui';
import { colors } from '../theme';
import { api } from '../api/client';
import { money } from '../utils/format';

const POLL_MS = 3000;
const GIVE_UP_MS = 3.5 * 60 * 1000;

// Sends an M-Pesa prompt to the customer's phone and waits for them to enter their PIN.
// The money goes to the shop's own till. Shown inside the sale or deni sheet instead of its form.
// onPaid(request) runs once with { id, amount, receipt, recordId } when the money is in.
export default function PayPrompt({ amount, purpose = 'sale', customerId = null, branchId = null, defaultPhone = '', onPaid, onCancel }) {
  const [phone, setPhone] = useState(defaultPhone || '');
  const [stage, setStage] = useState('enter'); // enter | waiting | paid | failed
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const startedAt = useRef(0);
  const done = useRef(false);
  const value = Math.ceil(Number(amount) || 0);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function poll(id) {
    try {
      const { request: r } = await api(`/till/request/${id}`, { timeout: 20000 });
      setRequest(r);
      if (r.status === 'paid') {
        if (!done.current) {
          done.current = true;
          setStage('paid');
          await onPaid(r);
        }
        return;
      }
      if (r.status === 'failed' || r.status === 'cancelled') {
        setStage('failed');
        setError(r.resultDesc || 'The payment did not go through');
        return;
      }
    } catch {
      // Network hiccup: keep trying until we give up
    }
    if (Date.now() - startedAt.current > GIVE_UP_MS) {
      setStage('failed');
      setError('No answer yet. If the customer paid, it will still be recorded when M-Pesa confirms it.');
      return;
    }
    timer.current = setTimeout(() => poll(id), POLL_MS);
  }

  async function send() {
    setBusy(true); setError('');
    try {
      const { request: r } = await api('/till/request', { method: 'POST', body: { amount: value, phone, purpose, customerId, branchId } });
      setRequest(r);
      setStage('waiting');
      startedAt.current = Date.now();
      done.current = false;
      timer.current = setTimeout(() => poll(r.id), POLL_MS);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    clearTimeout(timer.current);
    setStage('enter'); setError(''); setRequest(null);
  }

  if (stage === 'paid') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 20 }}>
        <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
        <Text style={[s.h2, { color: colors.primaryDark, marginTop: 8 }]}>Paid {money(request.amount)}</Text>
        {request.receipt ? <Text style={s.muted}>M-Pesa {request.receipt}</Text> : null}
      </View>
    );
  }

  if (stage === 'waiting') {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 20 }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[s.h2, { marginTop: 14, textAlign: 'center' }]}>Waiting for the customer to enter their M-Pesa PIN</Text>
        <Text style={[s.muted, { textAlign: 'center', marginTop: 6 }]}>{money(value)} to {phone}. This usually takes under a minute.</Text>
        <Button title="Stop waiting" variant="ghost" onPress={() => { clearTimeout(timer.current); onCancel(); }} style={{ marginTop: 16 }} />
        <Text style={[s.muted, { fontSize: 12, textAlign: 'center' }]}>If they pay after you stop, the payment is still recorded.</Text>
      </View>
    );
  }

  return (
    <View>
      <Text style={[s.muted, { marginBottom: 10 }]}>
        The customer gets an M-Pesa prompt on their phone for {money(value)}
        {value !== Number(amount) ? ' (M-Pesa only takes whole shillings)' : ''}. The money goes straight to your till.
      </Text>
      <Input label="Customer's M-Pesa number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="07..." autoFocus={!defaultPhone} />
      {error ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{error}</Text> : null}
      {stage === 'failed' ? (
        <Button title="Try again" icon="refresh" onPress={retry} />
      ) : (
        <Button title={`Send prompt for ${money(value)}`} icon="phone-portrait-outline" onPress={send} loading={busy} disabled={phone.replace(/\D/g, '').length < 9 || !(value >= 1)} />
      )}
      <Button title="Back" variant="ghost" onPress={() => { clearTimeout(timer.current); onCancel(); }} style={{ marginTop: 6 }} />
    </View>
  );
}
