import React, { useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, Card, Input, s } from '../../src/components/ui';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { useBranch } from '../../src/context/BranchContext';
import { useSyncState } from '../../src/hooks/useData';
import { syncNow } from '../../src/sync/syncEngine';
import { api, PRIVACY_URL } from '../../src/api/client';
import { wipeLocalData } from '../../src/db/database';
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
  const [deleting, setDeleting] = useState(null); // { pin, error, loading } while the delete sheet is open
  const insets = useSafeAreaInsets();
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

  function askDelete() {
    Alert.alert(
      'Delete account permanently?',
      `This deletes ${business.name} and all its sales, expenses, deni, stock, branches and staff from this phone and from the cloud. Staff will also lose access. It cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: () => setDeleting({ pin: '', error: null, loading: false }) },
      ]
    );
  }

  async function confirmDelete() {
    setDeleting((d) => ({ ...d, loading: true, error: null }));
    try {
      await api('/auth/delete-account', { method: 'POST', body: { pin: deleting.pin } });
      setDeleting(null);
      await wipeLocalData();
      await signOut(true);
      router.replace('/login');
      Alert.alert('Account deleted', 'Your business and all its records have been removed.');
    } catch (e) {
      setDeleting((d) => (d ? { ...d, loading: false, error: e.message } : d));
    }
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
          <Row label="SMS reminders left" value={String(business.smsCredits || 0)} />
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

        {permissions.canExport ? (
          <LinkRow
            icon="phone-portrait-outline"
            title="M-Pesa payments"
            subtitle={business.tillConnected ? `Till ${business.tillNumber} records sales by itself` : 'Record till payments automatically'}
            onPress={() => router.push('/till')}
          />
        ) : null}
        {permissions.canExport ? (
          <LinkRow icon="download-outline" title="Export records" subtitle="Sales, expenses, deni and stock to Excel (CSV)" onPress={() => router.push('/export')} />
        ) : null}
        <LinkRow icon="shield-checkmark-outline" title="Privacy policy" subtitle="How we handle your data" onPress={() => Linking.openURL(PRIVACY_URL)} />

        <Button title="Sign out" variant="ghost" onPress={logout} />
        {permissions.isOwner ? (
          <Pressable onPress={askDelete} style={{ alignItems: 'center', paddingVertical: 14 }}>
            <Text style={{ color: colors.danger, fontWeight: '600' }}>Delete account</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(deleting)} transparent animationType="slide" onRequestClose={() => setDeleting(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
          <ScrollView style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20 }} contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled">
            {deleting ? (
              <>
                <Text style={[s.h2, { marginBottom: 6, color: colors.danger }]}>Confirm with your PIN</Text>
                <Text style={[s.muted, { marginBottom: 14 }]}>You need internet for this. Once deleted, the records cannot be brought back.</Text>
                <Input label="Owner PIN" value={deleting.pin} onChangeText={(pin) => setDeleting((d) => ({ ...d, pin }))} keyboardType="number-pad" secureTextEntry maxLength={6} autoFocus />
                {deleting.error ? <Text style={{ color: colors.danger, marginBottom: 12 }}>{deleting.error}</Text> : null}
                <Button title="Delete everything" variant="danger" onPress={confirmDelete} loading={deleting.loading} disabled={deleting.pin.length < 4} />
                <Button title="Cancel" variant="ghost" onPress={() => setDeleting(null)} style={{ marginTop: 6 }} />
              </>
            ) : null}
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
