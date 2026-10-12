import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Banner, Card, SyncPill, s } from '../../src/components/ui';
import BranchSwitcher from '../../src/components/BranchSwitcher';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { useBranch } from '../../src/context/BranchContext';
import { useLiveQuery } from '../../src/hooks/useData';
import { daySummary, dayByBranch, lastNDays, salesByStaff } from '../../src/db/queries';
import { stockSummary } from '../../src/db/stock';
import { addDays, dayLabel, daysLeft, money, startOfDay } from '../../src/utils/format';

function Stat({ label, value, color = colors.text, sub }) {
  return (
    <Card style={{ flex: 1, marginHorizontal: 4 }}>
      <Text style={[s.muted, { fontSize: 12 }]}>{label}</Text>
      <Text style={{ fontSize: 18, fontWeight: '800', color, marginTop: 4 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={[s.muted, { fontSize: 11, marginTop: 2 }]}>{sub}</Text> : null}
    </Card>
  );
}

export default function Today() {
  const { business, subscription, employee, permissions, staff } = useAuth();
  const { branchFilter, branches } = useBranch();
  const [day, setDay] = useState(startOfDay());
  const sum = useLiveQuery(() => daySummary(day, branchFilter), [day, branchFilter]);
  const week = useLiveQuery(() => lastNDays(7, branchFilter), [branchFilter]) || [];
  const perBranch = useLiveQuery(() => dayByBranch(day), [day]) || [];
  const perStaff = useLiveQuery(() => salesByStaff(day, branchFilter), [day, branchFilter]) || [];
  const stock = useLiveQuery(() => stockSummary(branchFilter), [branchFilter]);
  const isToday = day === startOfDay();
  const maxWeek = Math.max(1, ...week.map((d) => Math.max(d.sales, d.expenses)));
  const staffName = (id) => (id ? ((staff.find((x) => x.id === id) || {}).name || 'Former staff') : (business && business.ownerName) || 'Owner');
  const greetName = employee ? employee.name : business && business.ownerName;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.muted}>Habari{greetName ? `, ${greetName.split(' ')[0]}` : ''}</Text>
            <Text style={s.h1} numberOfLines={1}>{business ? business.name : ''}</Text>
          </View>
          <SyncPill />
        </View>
        <View style={{ marginBottom: 12 }}><BranchSwitcher /></View>

        {subscription.state === 'trial' && permissions.canPay ? (
          <Banner tone="info" text={`Free trial: ${daysLeft(subscription.endsAt)} days left`} action="Subscribe" onPress={() => router.push('/subscribe')} />
        ) : null}
        {!subscription.active ? (
          <Banner
            tone="danger"
            text={subscription.state === 'suspended' ? 'This account is suspended.' : permissions.canPay ? 'Your subscription has ended. You can view records but not add new ones.' : 'The subscription has ended. Ask the owner to renew.'}
            action={permissions.canPay ? 'Renew' : null}
            onPress={() => permissions.canPay && router.push('/subscribe')}
          />
        ) : null}

        <View style={[s.row, { justifyContent: 'space-between', marginVertical: 6 }]}>
          <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={10}><Ionicons name="chevron-back" size={24} color={colors.primary} /></Pressable>
          <Text style={s.h2}>{dayLabel(day)}</Text>
          <Pressable onPress={() => !isToday && setDay(addDays(day, 1))} hitSlop={10}>
            <Ionicons name="chevron-forward" size={24} color={isToday ? colors.border : colors.primary} />
          </Pressable>
        </View>

        <Card style={{ backgroundColor: colors.primary, borderWidth: 0, marginTop: 6 }}>
          <Text style={{ color: '#D5EEDF' }}>Estimated profit</Text>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '800', marginTop: 2 }}>{money(sum ? sum.profit : 0)}</Text>
          <Text style={{ color: '#D5EEDF', fontSize: 12, marginTop: 4 }}>Sales minus expenses recorded for this day</Text>
        </Card>

        <View style={[s.row, { marginHorizontal: -4 }]}>
          <Stat label="Sales" value={money(sum ? sum.salesTotal : 0)} sub={`${sum ? sum.salesCount : 0} entries`} />
          <Stat label="Expenses" value={money(sum ? sum.expensesTotal : 0)} color={colors.danger} sub={`${sum ? sum.expensesCount : 0} entries`} />
        </View>
        <View style={[s.row, { marginHorizontal: -4 }]}>
          <Stat label="Cash sales" value={money(sum ? sum.byMethod.cash : 0)} />
          <Stat label="M-Pesa sales" value={money(sum ? sum.byMethod.mpesa : 0)} color={colors.mpesa} />
        </View>
        <View style={[s.row, { marginHorizontal: -4 }]}>
          <Stat label="Deni collected" value={money(sum ? sum.debtCollected : 0)} />
          <Stat label="Total unpaid deni" value={money(sum ? sum.outstanding : 0)} color={colors.warning} />
        </View>

        {stock && stock.products > 0 ? (
          <Pressable onPress={() => router.push('/stock')}>
            <Card style={[s.row, { backgroundColor: stock.low ? colors.warningSoft : colors.card }]}>
              <Ionicons name="cube-outline" size={26} color={stock.low ? colors.warning : colors.primary} style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '700', color: colors.text }}>
                  {stock.low ? `${stock.low} product${stock.low === 1 ? '' : 's'} low or out of stock` : 'Stock levels are fine'}
                </Text>
                <Text style={[s.muted, { fontSize: 12 }]}>Stock worth {money(stock.value)} at buying price</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Card>
          </Pressable>
        ) : null}

        {!branchFilter && branches.length > 1 ? (
          <Card>
            <Text style={[s.h2, { marginBottom: 10 }]}>By branch</Text>
            {perBranch.map((b) => (
              <View key={b.id} style={[s.row, { justifyContent: 'space-between', paddingVertical: 6 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '600' }}>{b.name}</Text>
                  <Text style={[s.muted, { fontSize: 12 }]}>Sales {money(b.sales)} · Expenses {money(b.expenses)}</Text>
                </View>
                <Text style={{ fontWeight: '700', color: b.sales - b.expenses >= 0 ? colors.primary : colors.danger }}>{money(b.sales - b.expenses)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {permissions.canSeeAllStaff && staff.length > 0 && perStaff.length > 0 ? (
          <Card>
            <Text style={[s.h2, { marginBottom: 10 }]}>Sales by staff</Text>
            {perStaff.map((p) => (
              <View key={p.created_by || 'owner'} style={[s.row, { justifyContent: 'space-between', paddingVertical: 6 }]}>
                <Text style={{ color: colors.text }}>{staffName(p.created_by)} <Text style={s.muted}>({p.n})</Text></Text>
                <Text style={{ fontWeight: '700', color: colors.text }}>{money(p.total)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        <Card>
          <Text style={[s.h2, { marginBottom: 12 }]}>Last 7 days</Text>
          {week.map((d) => (
            <View key={d.day} style={{ marginBottom: 10 }}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                <Text style={{ fontSize: 12, color: colors.muted }}>{dayLabel(d.day)}</Text>
                <Text style={{ fontSize: 12, color: colors.text, fontWeight: '600' }}>{money(d.sales - d.expenses)}</Text>
              </View>
              <View style={{ height: 6, backgroundColor: colors.primarySoft, borderRadius: 3, marginTop: 4 }}>
                <View style={{ height: 6, width: `${(d.sales / maxWeek) * 100}%`, backgroundColor: colors.primary, borderRadius: 3 }} />
              </View>
              <View style={{ height: 4, backgroundColor: colors.dangerSoft, borderRadius: 2, marginTop: 2 }}>
                <View style={{ height: 4, width: `${(d.expenses / maxWeek) * 100}%`, backgroundColor: colors.danger, borderRadius: 2 }} />
              </View>
            </View>
          ))}
          <Text style={[s.muted, { fontSize: 11 }]}>Green bar is sales, red bar is expenses. Figure on the right is the day's profit.</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
