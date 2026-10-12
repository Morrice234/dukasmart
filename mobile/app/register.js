import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Link, Redirect, router } from 'expo-router';
import { Button, Chips, Input, s } from '../src/components/ui';
import { colors } from '../src/theme';
import { useAuth } from '../src/context/AuthContext';
import { api } from '../src/api/client';

const TYPES = [
  { value: 'duka', label: 'Duka / Shop' },
  { value: 'barbershop', label: 'Barbershop' },
  { value: 'salon', label: 'Salon' },
  { value: 'food', label: 'Food / Kibanda' },
  { value: 'other', label: 'Other' },
];

export default function Register() {
  const { token, register } = useAuth();
  const [form, setForm] = useState({ businessName: '', ownerName: '', phone: '', pin: '', confirm: '', businessType: 'duka', location: '', referralCode: '' });
  const [invite, setInvite] = useState(null); // { referrerName, bonusTrialDays } or { error }
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  // Check the invite code as the owner types it
  useEffect(() => {
    const code = form.referralCode.trim();
    if (code.length < 4) { setInvite(null); return undefined; }
    const t = setTimeout(() => {
      api(`/auth/referral/${encodeURIComponent(code)}`)
        .then(setInvite)
        .catch((e) => setInvite({ error: e.status === 404 ? 'Code not found' : null }));
    }, 500);
    return () => clearTimeout(t);
  }, [form.referralCode]);

  if (token) return <Redirect href="/" />;

  async function submit() {
    setError('');
    if (form.pin !== form.confirm) { setError('PINs do not match'); return; }
    setLoading(true);
    try {
      const { confirm, ...details } = form;
      if (!details.referralCode.trim()) delete details.referralCode;
      await register(details);
      router.replace('/');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 60, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
        <Text style={s.h1}>Start your free trial</Text>
        <Text style={[s.muted, { marginBottom: 24, marginTop: 4 }]}>7 days free. No payment needed today.</Text>
        <Input label="Business name" value={form.businessName} onChangeText={set('businessName')} placeholder="e.g. Baraka Mini Mart" />
        <Input label="Your name" value={form.ownerName} onChangeText={set('ownerName')} placeholder="e.g. John Kamau" />
        <Text style={s.label}>Type of business</Text>
        <Chips options={TYPES} value={form.businessType} onChange={set('businessType')} />
        <Input label="Area (optional)" value={form.location} onChangeText={set('location')} placeholder="e.g. Kawangware" />
        <Input label="Safaricom number" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" placeholder="0712 345 678" />
        <Input label="Invite code (optional)" value={form.referralCode} onChangeText={set('referralCode')} autoCapitalize="characters" placeholder="From a friend or agent" />
        {invite && invite.referrerName ? (
          <Text style={{ color: colors.primary, marginTop: -8, marginBottom: 12, fontWeight: '600' }}>
            Invited by {invite.referrerName}. You get {invite.bonusTrialDays} extra free days.
          </Text>
        ) : null}
        {invite && invite.error ? <Text style={{ color: colors.danger, marginTop: -8, marginBottom: 12 }}>{invite.error}</Text> : null}
        <Input label="Create a PIN" value={form.pin} onChangeText={set('pin')} keyboardType="number-pad" secureTextEntry maxLength={6} placeholder="4 to 6 digits" />
        <Input label="Confirm PIN" value={form.confirm} onChangeText={set('confirm')} keyboardType="number-pad" secureTextEntry maxLength={6} />
        {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        <Button title="Create account" onPress={submit} loading={loading} disabled={!form.businessName || !form.phone || form.pin.length < 4} />
        <View style={[s.row, { justifyContent: 'center', marginTop: 20 }]}>
          <Text style={s.muted}>Already registered? </Text>
          <Link href="/login" style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
