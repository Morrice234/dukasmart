import React, { useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card, Empty, s } from '../../src/components/ui';
import { ProductSheet, SellSheet, StockMoveSheet, qtyText } from '../../src/components/stock/StockSheets';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { useBranch } from '../../src/context/BranchContext';
import { useLiveQuery } from '../../src/hooks/useData';
import { getProduct, productByBranch, productMovements, productsWithStock } from '../../src/db/stock';
import { saveRecord } from '../../src/db/database';
import { money, shortDate, time } from '../../src/utils/format';

const TYPE_LABEL = { in: 'Received', sale: 'Sold', out: 'Removed', adjust: 'Count correction' };

function Action({ icon, label, onPress, color = colors.primary }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, marginHorizontal: 4, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border }}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 4 }}>{label}</Text>
    </Pressable>
  );
}

export default function ProductScreen() {
  const { id } = useLocalSearchParams();
  const { subscription, permissions, role, employee, staff, business } = useAuth();
  const { branches, branchFilter, defaultBranchId, branchName } = useBranch();
  const product = useLiveQuery(() => getProduct(id, branchFilter), [id, branchFilter]);
  const perBranch = useLiveQuery(() => productByBranch(id), [id]) || [];
  const moves = useLiveQuery(() => productMovements(id, branchFilter), [id, branchFilter]) || [];
  const allProducts = useLiveQuery(() => productsWithStock('', branchFilter), [branchFilter]) || [];
  const [sheet, setSheet] = useState(null); // 'edit' | 'sell' | 'in' | 'out' | 'count'

  if (!product) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const branchOptions = !branchFilter ? branches.map((b) => ({ value: b.id, label: b.name })) : null;
  const canEdit = role !== 'cashier' || product.created_by === (employee && employee.id);
  const staffName = (sid) => (sid ? ((staff.find((x) => x.id === sid) || {}).name || 'Staff') : (business && business.ownerName) || 'Owner');
  // Counting needs one branch, because each branch has its own shelf
  const countQty = branchFilter ? product.qty
    : ((perBranch.find((b) => b.id === defaultBranchId) || {}).qty || 0);

  function open(name) {
    if (!subscription.active) { router.push('/subscribe'); return; }
    setSheet(name);
  }

  function remove() {
    Alert.alert(`Delete ${product.name}?`, 'It disappears from the stock list. Past sales are kept.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await saveRecord('products', { id: product.id, deleted: true }); router.back(); } },
    ]);
  }

  const margin = product.sell_price != null && product.buy_price != null ? product.sell_price - product.buy_price : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{
        title: product.name,
        headerRight: () => (canEdit ? <Pressable onPress={() => open('edit')} hitSlop={10}><Ionicons name="create-outline" size={22} color={colors.primary} /></Pressable> : null),
      }} />
      <FlatList
        data={moves}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={(
          <>
            <Card style={{ backgroundColor: product.qty <= 0 ? colors.dangerSoft : product.low ? colors.warningSoft : colors.primarySoft, borderWidth: 0 }}>
              <Text style={s.muted}>In stock{branchFilter ? ` at ${branchName(branchFilter)}` : branches.length > 1 ? ' (all branches)' : ''}</Text>
              <Text style={{ fontSize: 32, fontWeight: '800', color: product.qty <= 0 ? colors.danger : product.low ? colors.warning : colors.primaryDark }}>
                {qtyText(product.qty, product.unit)} {product.unit === 'pcs' ? 'pieces' : ''}
              </Text>
              {product.reorder_level ? <Text style={s.muted}>Warns at {qtyText(product.reorder_level, product.unit)}</Text> : null}
            </Card>

            <View style={[s.row, { marginHorizontal: -4, marginBottom: 12 }]}>
              <Action icon="cart-outline" label="Sell" onPress={() => open('sell')} />
              <Action icon="arrow-down-circle-outline" label="Receive" onPress={() => open('in')} />
              <Action icon="clipboard-outline" label="Count" onPress={() => open('count')} />
              <Action icon="remove-circle-outline" label="Remove" color={colors.danger} onPress={() => open('out')} />
            </View>

            <Card>
              <View style={[s.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                <Text style={s.muted}>Buying price</Text>
                <Text style={{ fontWeight: '600', color: colors.text }}>{product.buy_price != null ? money(product.buy_price) : '-'}</Text>
              </View>
              <View style={[s.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                <Text style={s.muted}>Selling price</Text>
                <Text style={{ fontWeight: '600', color: colors.text }}>{product.sell_price != null ? money(product.sell_price) : '-'}</Text>
              </View>
              {margin != null ? (
                <View style={[s.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                  <Text style={s.muted}>Profit on each</Text>
                  <Text style={{ fontWeight: '700', color: margin >= 0 ? colors.primary : colors.danger }}>{money(margin)}</Text>
                </View>
              ) : null}
              <View style={[s.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                <Text style={s.muted}>Stock value</Text>
                <Text style={{ fontWeight: '600', color: colors.text }}>{money(Math.max(0, product.qty) * (product.buy_price || 0))}</Text>
              </View>
            </Card>

            {!branchFilter && branches.length > 1 ? (
              <Card>
                <Text style={[s.h2, { marginBottom: 8 }]}>By branch</Text>
                {perBranch.map((b) => (
                  <View key={b.id} style={[s.row, { justifyContent: 'space-between', paddingVertical: 4 }]}>
                    <Text style={{ color: colors.text }}>{b.name}</Text>
                    <Text style={{ fontWeight: '700', color: b.qty <= 0 ? colors.danger : colors.text }}>{qtyText(b.qty, product.unit)}</Text>
                  </View>
                ))}
              </Card>
            ) : null}

            <Text style={[s.h2, { marginBottom: 8 }]}>History</Text>
          </>
        )}
        ListEmptyComponent={<Empty icon="time-outline" text="No stock changes yet" />}
        renderItem={({ item }) => (
          <Card style={[s.row, { justifyContent: 'space-between', paddingVertical: 10 }]}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{TYPE_LABEL[item.type] || item.type}</Text>
              <Text style={[s.muted, { fontSize: 12 }]} numberOfLines={2}>
                {shortDate(item.occurred_at)} {time(item.occurred_at)}
                {!branchFilter && branches.length > 1 ? ` · ${branchName(item.branch_id)}` : ''}
                {staff.length ? ` · ${staffName(item.created_by)}` : ''}
                {item.note ? ` · ${item.note}` : ''}
              </Text>
            </View>
            <Text style={{ fontWeight: '800', color: item.quantity >= 0 ? colors.primary : colors.danger }}>
              {item.quantity >= 0 ? '+' : ''}{qtyText(item.quantity, product.unit)}
            </Text>
          </Card>
        )}
      />

      <ProductSheet
        visible={sheet === 'edit'}
        onClose={() => setSheet(null)}
        product={product}
        onDelete={permissions.canDelete ? remove : null}
      />
      <StockMoveSheet
        visible={['in', 'out', 'count'].includes(sheet)}
        mode={sheet}
        onClose={() => setSheet(null)}
        product={product}
        currentQty={countQty}
        branchOptions={sheet === 'count' ? null : branchOptions}
        defaultBranchId={branchFilter || defaultBranchId}
        branchLabel={sheet === 'count' && branches.length > 1 ? branchName(branchFilter || defaultBranchId) : null}
      />
      <SellSheet
        visible={sheet === 'sell'}
        onClose={() => setSheet(null)}
        products={allProducts}
        initialProductId={product.id}
        branchOptions={branchOptions}
        defaultBranchId={branchFilter || defaultBranchId}
      />
    </View>
  );
}
