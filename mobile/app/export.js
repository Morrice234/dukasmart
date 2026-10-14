import React, { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { Button, Card, Chips, s } from '../src/components/ui';
import BranchSwitcher from '../src/components/BranchSwitcher';
import { colors } from '../src/theme';
import { useAuth } from '../src/context/AuthContext';
import { useBranch } from '../src/context/BranchContext';
import { EXPORTS, PERIODS, exportCsv } from '../src/export/csv';

const KIND_OPTIONS = Object.entries(EXPORTS).map(([value, e]) => ({ value, label: e.label }));
const PERIOD_OPTIONS = Object.entries(PERIODS).map(([value, label]) => ({ value, label }));

export default function ExportScreen() {
  const { business, staff } = useAuth();
  const { branchFilter, branchName, branches } = useBranch();
  const [kind, setKind] = useState('sales');
  const [period, setPeriod] = useState('this_month');
  const [busy, setBusy] = useState(false);
  const def = EXPORTS[kind];

  async function run() {
    setBusy(true);
    try {
      const staffById = new Map((staff || []).map((e) => [e.id, e.name]));
      const n = await exportCsv(kind, {
        period,
        branchId: branchFilter,
        businessName: business && business.name,
        names: {
          branch: (id) => (id ? branchName(id) : ''),
          staff: (id) => (!id ? (business.ownerName || 'Owner') : staffById.get(id) || 'Staff'),
        },
      });
      if (n === 0) Alert.alert('Nothing to export', 'There are no records for what you chose. The file was still created with just the column names.');
    } catch (e) {
      Alert.alert('Could not export', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
      <Text style={[s.muted, { marginBottom: 12 }]}>
        Download your records as a CSV file. It opens in Excel or Google Sheets, and you can send it by WhatsApp or email or save it to your phone.
      </Text>

      <Text style={s.label}>What to export</Text>
      <Chips options={KIND_OPTIONS} value={kind} onChange={setKind} />

      {def.dated ? (
        <>
          <Text style={s.label}>Period</Text>
          <Chips options={PERIOD_OPTIONS} value={period} onChange={setPeriod} />
        </>
      ) : (
        <Text style={[s.muted, { marginBottom: 14 }]}>This shows how things stand today.</Text>
      )}

      {branches.length > 1 ? (
        <>
          <Text style={s.label}>Branch</Text>
          <BranchSwitcher />
        </>
      ) : null}

      <Card style={{ marginTop: 12 }}>
        <Text style={{ color: colors.text }}>
          {def.label}{def.dated ? `, ${PERIODS[period].toLowerCase()}` : ''}{branches.length > 1 ? `, ${branchFilter ? branchName(branchFilter) : 'all branches'}` : ''}
        </Text>
        <Text style={[s.muted, { fontSize: 12, marginTop: 4 }]}>Uses the records on this phone. Back up first if staff recorded things on other phones today.</Text>
      </Card>

      <Button title="Export CSV" icon="download-outline" onPress={run} loading={busy} style={{ marginTop: 8 }} />
    </ScrollView>
  );
}
