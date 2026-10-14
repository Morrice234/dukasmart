import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, s } from './ui';
import { colors } from '../theme';
import { api } from '../api/client';
import { syncNow } from '../sync/syncEngine';
import { useAuth } from '../context/AuthContext';
import { money } from '../utils/format';

const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

// Same rule as the server: 160 characters per SMS, 153 per part when longer; emojis make it 70/67
function segmentsFor(text) {
  const plain = GSM.test(text);
  const len = [...text].length;
  if (len <= (plain ? 160 : 70)) return 1;
  return Math.ceil(len / (plain ? 153 : 67));
}

function fill(template, c, shop) {
  const balance = Number(c.balance).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  return template.replace(/\{name\}/gi, c.name).replace(/\{balance\}/gi, balance).replace(/\{shop\}/gi, shop).trim();
}

// customers: [{ id, name, phone, balance }] who should get a reminder
export default function SmsSheet({ visible, customers, onClose }) {
  const insets = useSafeAreaInsets();
  const { business, refresh, permissions } = useAuth();
  const [info, setInfo] = useState(null); // { credits, template, testMode }
  const [template, setTemplate] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!visible) return;
    setInfo(null); setError(null); setResult(null);
    api('/sms')
      .then((r) => { setInfo(r); setTemplate((t) => t || r.template); })
      .catch((e) => setError(e.message));
  }, [visible]);

  const shop = business ? business.name : '';
  const needed = useMemo(
    () => customers.reduce((n, c) => n + segmentsFor(fill(template || '', c, shop)), 0),
    [customers, template, shop]
  );
  const preview = customers[0] ? fill(template || '', customers[0], shop) : '';
  const tooLong = customers.some((c) => segmentsFor(fill(template || '', c, shop)) > 2);
  const notEnough = info && needed > info.credits;

  async function send() {
    setSending(true); setError(null);
    try {
      await syncNow(); // the server needs the latest deni records to work out balances
      const r = await api('/sms/reminders', { method: 'POST', body: { customerIds: customers.map((c) => c.id), message: template } });
      setResult(r);
      setInfo((i) => ({ ...i, credits: r.credits }));
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function fromMyPhone() {
    const c = customers[0];
    Linking.openURL(`sms:${c.phone}?body=${encodeURIComponent(preview)}`);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
        <ScrollView style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' }} contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled">
          <Text style={[s.h2, { marginBottom: 4 }]}>
            {customers.length === 1 ? `Remind ${customers[0].name}` : `Remind ${customers.length} customers`}
          </Text>

          {result ? (
            <>
              <Card style={{ backgroundColor: colors.primarySoft, borderWidth: 0 }}>
                <Text style={{ fontWeight: '700', color: colors.primaryDark, fontSize: 16 }}>
                  {result.sent ? `${result.sent} reminder${result.sent === 1 ? '' : 's'} sent` : 'No reminders sent'}
                </Text>
                <Text style={s.muted}>{result.used} SMS used, {result.credits} left</Text>
              </Card>
              {result.skipped && result.skipped.length ? (
                <Card>
                  <Text style={{ fontWeight: '700', color: colors.text, marginBottom: 4 }}>Not sent</Text>
                  {result.skipped.map((x) => (
                    <Text key={x.id} style={[s.muted, { fontSize: 13 }]}>
                      {(x.name || customers.find((c) => c.id === x.id)?.name || 'Customer')}: {x.reason}
                    </Text>
                  ))}
                </Card>
              ) : null}
              {info && info.testMode ? <Text style={[s.muted, { fontSize: 12, marginBottom: 8 }]}>Test server: messages were printed on the server, not sent to phones.</Text> : null}
              <Button title="Done" onPress={onClose} />
            </>
          ) : !info ? (
            error ? (
              <>
                <Text style={{ color: colors.danger, marginVertical: 12 }}>{error}</Text>
                {customers.length === 1 ? <Button title="Send from my phone instead" variant="outline" onPress={fromMyPhone} /> : null}
                <Button title="Close" variant="ghost" onPress={onClose} style={{ marginTop: 6 }} />
              </>
            ) : <ActivityIndicator color={colors.primary} style={{ marginVertical: 30 }} />
          ) : (
            <>
              <Text style={[s.muted, { marginBottom: 12 }]}>
                You have {info.credits} SMS left. This needs {needed}.
              </Text>

              <Text style={s.label}>Message</Text>
              <TextInput
                value={template}
                onChangeText={setTemplate}
                multiline
                maxLength={300}
                style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, minHeight: 90, color: colors.text, textAlignVertical: 'top' }}
              />
              <Text style={[s.muted, { fontSize: 12, marginTop: 4, marginBottom: 12 }]}>
                {'{name}'}, {'{balance}'} and {'{shop}'} are filled in for each customer.
              </Text>

              {preview ? (
                <Card>
                  <Text style={[s.muted, { fontSize: 12, marginBottom: 4 }]}>
                    {customers.length === 1 ? 'Preview' : `Preview for ${customers[0].name} (${money(customers[0].balance)})`}
                  </Text>
                  <Text style={{ color: colors.text }}>{preview}</Text>
                </Card>
              ) : null}

              {tooLong ? <Text style={{ color: colors.danger, marginBottom: 10 }}>The message is too long. Keep it within 2 SMS (about 300 characters).</Text> : null}
              {error ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{error}</Text> : null}

              {notEnough ? (
                <>
                  <Text style={{ color: colors.danger, marginBottom: 10 }}>
                    Not enough SMS left. {permissions.canPay ? 'Renew your plan to get more.' : 'Ask the owner to renew the plan.'}
                  </Text>
                  {permissions.canPay ? <Button title="Renew plan" onPress={() => { onClose(); router.push('/subscribe'); }} /> : null}
                  {customers.length === 1 ? <Button title="Send from my phone instead" variant="outline" onPress={fromMyPhone} style={{ marginTop: 8 }} /> : null}
                </>
              ) : (
                <Button
                  title={customers.length === 1 ? 'Send reminder' : `Send ${customers.length} reminders`}
                  icon="send"
                  onPress={send}
                  loading={sending}
                  disabled={!template.trim() || tooLong || !customers.length}
                />
              )}
              <Button title="Cancel" variant="ghost" onPress={onClose} style={{ marginTop: 6 }} />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
