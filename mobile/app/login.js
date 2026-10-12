import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Link, Redirect, router } from 'expo-router';
import { Button, Input, s } from '../src/components/ui';
import { colors } from '../src/theme';
import { useAuth } from '../src/context/AuthContext';

export default function Login() {
  const { token, signIn } = useAuth();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (token) return <Redirect href="/" />;

  async function submit() {
    setError('');
    setLoading(true);
    try {
      await signIn(phone, pin);
      router.replace('/');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginBottom: 32 }}>
          <Text style={{ fontSize: 34, fontWeight: '900', color: colors.primary }}>DukaSmart</Text>
          <Text style={[s.muted, { fontSize: 16, marginTop: 4 }]}>Know what you sold, spent and who owes you.</Text>
          <Text style={[s.muted, { fontSize: 13, marginTop: 12 }]}>Owners and staff both sign in with their own phone number and PIN.</Text>
        </View>
        <Input label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="0712 345 678" />
        <Input label="PIN" value={pin} onChangeText={setPin} keyboardType="number-pad" secureTextEntry maxLength={6} placeholder="4 to 6 digits" />
        {error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{error}</Text> : null}
        <Button title="Sign in" onPress={submit} loading={loading} disabled={!phone || pin.length < 4} />
        <View style={[s.row, { justifyContent: 'center', marginTop: 20 }]}>
          <Text style={s.muted}>New here? </Text>
          <Link href="/register" style={{ color: colors.primary, fontWeight: '700' }}>Start free trial</Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
