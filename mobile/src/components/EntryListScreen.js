import React, { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import EntrySheet, { EXPENSE_CATEGORIES } from './EntrySheet';
import { Card, Empty, SyncPill, s } from './ui';
import { colors } from '../theme';
import { useLiveQuery } from '../hooks/useData';
import { listEntries } from '../db/queries';
import { deleteRecord, saveRecord } from '../db/database';
import { addDays, dayLabel, money, startOfDay, time } from '../utils/format';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import BranchSwitcher from './BranchSwitcher';
import { SellSheet } from './stock/StockSheets';
import { deleteSaleStock, productsWithStock } from '../db/stock';

const METHOD_LABEL = { cash: 'Cash', mpesa: 'M-Pesa', other: 'Other' };
const CATEGORY_LABEL = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));

// Shared by the Sales and Expenses tabs
export default function EntryListScreen({ table, title }) {
  const isExpense = table === 'expenses';
  const { subscription, permissions, employee, staff, role, business } = useAuth();
  const tillConnected = Boolean(business && business.tillConnected);
  const stkEnabled = Boolean(business && business.stkEnabled);

  // The customer paid through an M-Pesa prompt: the server already made the sale with this id
  async function savePaidSale(r, { note, branchId }) {
    await saveRecord('sales', {
      id: r.recordId,
      amount: r.amount,
      method: 'mpesa',
      description: [note, r.receipt ? `M-Pesa ${r.receipt}` : 'M-Pesa prompt'].filter(Boolean).join(' · '),
      occurred_at: Date.now(),
      branch_id: branchId || defaultBranchId,
    });
  }
  const { branches, branchFilter, defaultBranchId, branchName } = useBranch();
  const staffName = (id) => (id ? ((staff.find((x) => x.id === id) || {}).name || 'Staff') : 'Owner');
  const showStaff = staff.length > 0;
  const [day, setDay] = useState(startOfDay());
  const [editing, setEditing] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selling, setSelling] = useState(false);
  // Only the Sales screen needs the product list (for "Sell from stock")
  const products = useLiveQuery(() => (isExpense ? Promise.resolve([]) : productsWithStock('', branchFilter)), [isExpense, branchFilter]) || [];
  const rows = useLiveQuery(() => listEntries(table, day, branchFilter), [table, day, branchFilter]) || [];
  const total = rows.reduce((n, r) => n + r.amount, 0);

  function openSheet(row) {
    if (!subscription.active) { router.push('/subscribe'); return; }
    // Cashiers can only correct entries they recorded themselves
    if (row && role === 'cashier' && row.created_by !== (employee && employee.id)) return;
    setEditing(row || null);
    setSheetOpen(true);
  }

  async function save({ amount, method, category, note, branchId }) {
    // New entries for a past day keep the current time of day on that date
    const now = new Date();
    const occurredAt = editing ? editing.occurred_at
      : day === startOfDay() ? now.getTime()
        : day + (now.getHours() * 3600 + now.getMinutes() * 60) * 1000;
    await saveRecord(table, {
      ...(editing ? { id: editing.id } : {}),
      amount,
      method,
      description: note || null,
      ...(isExpense ? { category } : {}),
      occurred_at: occurredAt,
      branch_id: branchId || defaultBranchId,
    });
  }

  const isToday = day === startOfDay();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={s.h1}>{title}</Text>
          <SyncPill />
        </View>
        <BranchSwitcher />
        <View style={[s.row, { justifyContent: 'space-between', marginTop: 14 }]}>
          <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={10}><Ionicons name="chevron-back" size={24} color={colors.primary} /></Pressable>
          <Text style={s.h2}>{dayLabel(day)}</Text>
          <Pressable onPress={() => !isToday && setDay(addDays(day, 1))} hitSlop={10}>
            <Ionicons name="chevron-forward" size={24} color={isToday ? colors.border : colors.primary} />
          </Pressable>
        </View>
        <Card style={{ marginTop: 12, backgroundColor: isExpense ? colors.dangerSoft : colors.primarySoft, borderWidth: 0 }}>
          <Text style={s.muted}>{isExpense ? 'Total spent' : 'Total sold'}</Text>
          <Text style={{ fontSize: 28, fontWeight: '800', color: isExpense ? colors.danger : colors.primaryDark }}>{money(total)}</Text>
          <Text style={s.muted}>{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</Text>
        </Card>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListEmptyComponent={<Empty text={isExpense ? 'No expenses recorded for this day' : 'No sales recorded for this day'} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => openSheet(item)}>
            <Card style={[s.row, { justifyContent: 'space-between', paddingVertical: 12 }]}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={{ fontWeight: '600', color: colors.text }} numberOfLines={1}>
                  {item.description || (isExpense ? CATEGORY_LABEL[item.category] || 'Expense' : 'Sale')}
                </Text>
                <Text style={[s.muted, { fontSize: 12, marginTop: 2 }]}>
                  {time(item.occurred_at)} · {METHOD_LABEL[item.method] || item.method}
                  {isExpense && item.description ? ` · ${CATEGORY_LABEL[item.category] || ''}` : ''}
                  {!branchFilter && branches.length > 1 ? ` · ${branchName(item.branch_id)}` : ''}
                  {showStaff ? ` · ${staffName(item.created_by)}` : ''}
                  {item.dirty ? ' · not backed up' : ''}
                </Text>
              </View>
              <Text style={{ fontWeight: '700', fontSize: 16, color: isExpense ? colors.danger : colors.text }}>{money(item.amount)}</Text>
            </Card>
          </Pressable>
        )}
      />

      <Pressable
        onPress={() => openSheet(null)}
        style={{ position: 'absolute', right: 20, bottom: 24, backgroundColor: isExpense ? colors.danger : colors.primary, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 4 }}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>

      {!isExpense && products.length ? (
        <Pressable
          onPress={() => (subscription.active ? setSelling(true) : router.push('/subscribe'))}
          style={{ position: 'absolute', right: 92, bottom: 30, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.primary, height: 48, borderRadius: 24, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', elevation: 3 }}
        >
          <Ionicons name="cart-outline" size={20} color={colors.primary} />
          <Text style={{ color: colors.primary, fontWeight: '700', marginLeft: 6 }}>From stock</Text>
        </Pressable>
      ) : null}

      {!isExpense ? (
        <SellSheet
          tillConnected={!isExpense && tillConnected}
          stkEnabled={!isExpense && stkEnabled && subscription.active}
          visible={selling}
          onClose={() => setSelling(false)}
          products={products}
          branchOptions={!branchFilter ? branches.map((b) => ({ value: b.id, label: b.name })) : null}
          defaultBranchId={defaultBranchId}
        />
      ) : null}

      <EntrySheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={editing ? (isExpense ? 'Edit expense' : 'Edit sale') : (isExpense ? 'New expense' : 'New sale')}
        initial={editing}
        showCategory={isExpense}
        notePlaceholder={isExpense ? 'e.g. Bought 2 bales of sugar' : 'e.g. Bread and milk'}
        onPaidByPrompt={!isExpense && stkEnabled && !editing && subscription.active ? savePaidSale : null}
        mpesaHint={!isExpense && tillConnected && !editing
          ? `Payments to your till (${business.tillNumber}) are added by themselves. Only record M-Pesa here if it went to another number, or it will be counted twice.`
          : null}
        onSave={save}
        onDelete={editing && permissions.canDelete ? async () => {
          // A sale made from stock puts its items back on the shelf when deleted
          if (!isExpense) await deleteSaleStock(editing.id);
          await deleteRecord(table, editing.id);
        } : null}
        branchOptions={!branchFilter ? branches.map((b) => ({ value: b.id, label: b.name })) : null}
        defaultBranchId={defaultBranchId}
      />
    </SafeAreaView>
  );
}
