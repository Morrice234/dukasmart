import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Share, Text, View } from 'react-native';
import { Button, Card, Empty, s } from '../src/components/ui';
import { colors } from '../src/theme';
import { api } from '../src/api/client';
import { getMeta, setMeta } from '../src/db/database';
import { shortDate } from '../src/utils/format';

export default function Invite() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const cached = await getMeta('referrals');
      if (cached) setData(JSON.parse(cached));
      try {
        const res = await api('/referrals');
        setData(res);
        await setMeta('referrals', JSON.stringify(res));
      } catch (e) {
        if (!cached) setError(e.message);
      }
    })();
  }, []);

  if (error) return <View style={{ padding: 24 }}><Text style={{ color: colors.danger }}>{error}</Text></View>;
  if (!data) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;

  const shareWhatsApp = () => Linking.openURL(`whatsapp://send?text=${encodeURIComponent(data.shareMessage)}`)
    .catch(() => Share.share({ message: data.shareMessage }));

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Card style={{ backgroundColor: colors.primary, borderWidth: 0, alignItems: 'center', paddingVertical: 24 }}>
        <Text style={{ color: '#D5EEDF' }}>Your invite code</Text>
        <Text style={{ color: '#fff', fontSize: 38, fontWeight: '900', letterSpacing: 4, marginVertical: 6 }} selectable>{data.code}</Text>
        <Text style={{ color: '#D5EEDF', textAlign: 'center' }}>
          You get {data.rewardDays} free days when a business you invite pays for the first time. They get {data.friendBonusDays} extra trial days.
        </Text>
      </Card>

      <View style={[s.row, { marginBottom: 12 }]}>
        <Button title="WhatsApp" icon="logo-whatsapp" onPress={shareWhatsApp} style={{ flex: 1, marginRight: 6 }} />
        <Button title="Share" icon="share-social-outline" variant="outline" onPress={() => Share.share({ message: data.shareMessage })} style={{ flex: 1, marginLeft: 6 }} />
      </View>

      <View style={[s.row, { marginHorizontal: -4 }]}>
        {[['Signed up', data.totals.signedUp], ['Paid', data.totals.converted], ['Days earned', data.totals.daysEarned]].map(([label, v]) => (
          <Card key={label} style={{ flex: 1, marginHorizontal: 4, alignItems: 'center' }}>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{v}</Text>
            <Text style={[s.muted, { fontSize: 12 }]}>{label}</Text>
          </Card>
        ))}
      </View>

      <Text style={[s.h2, { marginVertical: 8 }]}>People you invited</Text>
      {data.referrals.length === 0 ? <Empty icon="gift-outline" text="Nobody yet. Share your code with other shop owners near you." /> : null}
      {data.referrals.map((r) => (
        <Card key={r.id} style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600', color: colors.text }}>{r.businessName}</Text>
            <Text style={[s.muted, { fontSize: 12 }]}>Joined {shortDate(new Date(r.joinedAt).getTime())}</Text>
          </View>
          <Text style={{ fontWeight: '700', color: r.status === 'converted' ? colors.primary : colors.warning }}>
            {r.status === 'converted' ? `+${r.daysEarned} days` : 'On trial'}
          </Text>
        </Card>
      ))}
    </ScrollView>
  );
}
