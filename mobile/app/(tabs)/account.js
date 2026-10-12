import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, Card, s } from '../../src/components/ui';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { useBranch } from '../../src/context/BranchContext';
import { useSyncState } from '../../src/hooks/useData';
import { syncNow } from '../../src/sync/syncEngine';
import { daysLeft, shortDate, timeAgo } from '../../src/utils/format';

const STATE_TEXT = { trial: 'Free trial', active: 'Active', expired: 'Expired', suspended: 'Suspended' };

function Row({ label, value }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between', paddingVertical: 8 }]}>
      <Text style={s.muted}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function LinkRow({ icon, title, subtitle, onPress }) {
  return (
    <Pressable onPress={onPress}>
      <Card style={[s.row, { paddingVertical: 14 }]}>
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Ionicons name={icon} size={20} color={colors.primaryDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: '700', color: colors.text }}>{title}</Text>
          {subtitle ? <Text style={[s.muted, { fontSize: 12 }]}>{subtitle}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Card>
    </Pressable>
  );
}

export default function Account() {
  const { business, employee, role, permissions, subscription, limits, signOut, refresh } = useAuth();
  const { branches, branchName } = useBranch();
  const sync = useSyncState();
  const [busy, setBusy] = useState(false);
  if (!business) return null;

  async function doSync() {
    setBusy(true);
    await syncNow();
    await refresh();
    setBusy(false);
  }

  function logout() {
    Alert.alert('Sign out?', 'Records stay safe in the cloud and come back when you sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive', onPress: async () => {
          try { await signOut(); router.replace('/login'); } catch (e) { Alert.alert('Not yet', e.message); }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={[s.h1, { marginBottom: 12 }]}>Account</Text>

        <Card>
          <Text style={[s.h2, { marginBottom: 6 }]}>{business.name}</Text>
          {employee ? (
            <>
              <Row label="Signed in as" value={employee.name} />
              <Row label="Role" value={role === 'manager' ? 'Manager' : 'Cashier'} />
              <Row label="Branch" value={employee.branchId ? branchName(employee.branchId) : 'All branches'} />
            </>
          ) : (
            <>
              <Row label="Owner" value={business.ownerName || '-'} />
              <Row label="Phone" value={business.phone} />
              <Row label="Type" value={business.businessType} />
            </>
          )}
        </Card>

        {permissions.isOwner ? (
          <>
            <LinkRow icon="storefront-outline" title="Branches" subtitle={`${branches.length} of ${limits.maxBranches} used`} onPress={() => router.push('/branches')} />
            <LinkRow icon="people-circle-outline" title="Staff" subtitle={limits.maxEmployees ? `Up to ${limits.maxEmployees} staff on your plan` : 'Upgrade to add staff'} onPress={() => router.push('/team')} />
            <LinkRow icon="gift-outline" title="Invite & earn" subtitle="Get free days for every shop you bring" onPress={() => router.push('/invite')} />
          </>
        ) : null}

        <Card>
          <Text style={[s.h2, { marginBottom: 6 }]}>Subscription</Text>
          <Row label="Status" value={STATE_TEXT[subscription.state] || subscription.state} />
          {subscription.planCode ? <Row label="Plan" value={subscription.planCode} /> : null}
          {subscription.endsAt ? (
            <Row label={subscription.active ? 'Ends' : 'Ended'} value={`${shortDate(subscription.endsAt)}${subscription.active ? ` (${daysLeft(subscription.endsAt)} days)` : ''}`} />
          ) : null}
          {permissions.canPay ? (
            <Button title={subscription.state === 'active' ? 'Renew or change plan' : 'Subscribe with M-Pesa'} onPress={() => router.push('/subscribe')} style={{ marginTop: 10 }} />
          ) : null}
        </Card>

        <Card>
          <Text style={[s.h2, { marginBottom: 6 }]}>Backup</Text>
          <Row label="Last backup" value={timeAgo(sync.lastSyncedAt)} />
          <Row label="Waiting to upload" value={String(sync.pending || 0)} />
          {sync.error ? <Text style={{ color: colors.danger, marginTop: 4 }}>{sync.error}</Text> : null}
          <Button title="Back up now" variant="outline" icon="cloud-upload-outline" onPress={doSync} loading={busy} style={{ marginTop: 10 }} />
          <Text style={[s.muted, { fontSize: 12, marginTop: 8 }]}>
            You can keep recording without internet. Records upload automatically when you are back online.
          </Text>
        </Card>

        <Button title="Sign out" variant="ghost" onPress={logout} />
      </ScrollView>
    </SafeAreaView>
  );
}
