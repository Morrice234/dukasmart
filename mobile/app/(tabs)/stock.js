import React, { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Button, Card, Empty, SyncPill, s } from '../../src/components/ui';
import BranchSwitcher from '../../src/components/BranchSwitcher';
import { ProductSheet, SellSheet, qtyText } from '../../src/components/stock/StockSheets';
import BarcodeScanner from '../../src/components/BarcodeScanner';
import { colors } from '../../src/theme';
import { useAuth } from '../../src/context/AuthContext';
import { useBranch } from '../../src/context/BranchContext';
import { useLiveQuery } from '../../src/hooks/useData';
import { productsWithStock } from '../../src/db/stock';
import { money } from '../../src/utils/format';

export default function Stock() {
  const { subscription } = useAuth();
  const { branches, branchFilter, defaultBranchId } = useBranch();
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selling, setSelling] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [newBarcode, setNewBarcode] = useState('');
  const all = useLiveQuery(() => productsWithStock('', branchFilter), [branchFilter]) || [];

  const q = search.trim().toLowerCase();
  const list = all.filter((p) => (!q || p.name.toLowerCase().includes(q) || (p.barcode && p.barcode === search.trim())) && (!onlyLow || p.low));
  const lowCount = all.filter((p) => p.low).length;
  const value = all.reduce((n, p) => n + Math.max(0, p.qty) * (p.buy_price || 0), 0);
  const branchOptions = !branchFilter ? branches.map((b) => ({ value: b.id, label: b.name })) : null;

  function guard(fn) {
    return () => (subscription.active ? fn() : router.push('/subscribe'));
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={s.h1}>Stock</Text>
          <SyncPill />
        </View>
        <BranchSwitcher />

        <View style={[s.row, { marginTop: 12, marginHorizontal: -4 }]}>
          <Card style={{ flex: 1, marginHorizontal: 4, backgroundColor: colors.primarySoft, borderWidth: 0 }}>
            <Text style={[s.muted, { fontSize: 12 }]}>Stock value (buying price)</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: colors.primaryDark }} numberOfLines={1} adjustsFontSizeToFit>{money(value)}</Text>
            <Text style={[s.muted, { fontSize: 11 }]}>{all.length} products</Text>
          </Card>
          <Pressable style={{ flex: 1, marginHorizontal: 4 }} onPress={() => setOnlyLow(!onlyLow)}>
            <Card style={{ backgroundColor: lowCount ? colors.warningSoft : colors.card, borderWidth: onlyLow ? 2 : 1, borderColor: onlyLow ? colors.warning : colors.border }}>
              <Text style={[s.muted, { fontSize: 12 }]}>Low or out of stock</Text>
              <Text style={{ fontSize: 18, fontWeight: '800', color: lowCount ? colors.warning : colors.text }}>{lowCount}</Text>
              <Text style={[s.muted, { fontSize: 11 }]}>{onlyLow ? 'Showing these only' : 'Tap to show only these'}</Text>
            </Card>
          </Pressable>
        </View>

        {all.length ? <Button title="Sell from stock" icon="cart-outline" onPress={guard(() => setSelling(true))} style={{ marginBottom: 12 }} /> : null}

        <View style={[s.row, { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12 }]}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search products" placeholderTextColor={colors.muted} style={{ flex: 1, height: 44, marginLeft: 8, color: colors.text }} />
          <Pressable onPress={() => setScanning(true)} hitSlop={10} style={{ paddingLeft: 8 }}>
            <Ionicons name="barcode-outline" size={26} color={colors.primary} />
          </Pressable>
        </View>
      </View>

      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        ListEmptyComponent={<Empty icon="cube-outline" text={all.length ? 'No products match' : 'No products yet. Tap + to add what you sell, and how many you have.'} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/product/${item.id}`)}>
            <Card style={[s.row, { paddingVertical: 12 }]}>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={{ fontWeight: '700', color: colors.text }} numberOfLines={1}>{item.name}</Text>
                <Text style={[s.muted, { fontSize: 12, marginTop: 2 }]}>
                  {item.sell_price != null ? `Sells at ${money(item.sell_price)}` : 'No selling price'}
                  {item.buy_price != null ? ` · buys at ${money(item.buy_price)}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: item.qty <= 0 ? colors.danger : item.low ? colors.warning : colors.text }}>
                  {qtyText(item.qty, item.unit)}
                </Text>
                {item.qty <= 0 ? <Text style={{ color: colors.danger, fontSize: 11, fontWeight: '700' }}>OUT</Text>
                  : item.low ? <Text style={{ color: colors.warning, fontSize: 11, fontWeight: '700' }}>LOW</Text> : null}
              </View>
            </Card>
          </Pressable>
        )}
      />

      <Pressable
        onPress={guard(() => setAdding(true))}
        style={{ position: 'absolute', right: 20, bottom: 24, backgroundColor: colors.primary, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', elevation: 4 }}
      >
        <Ionicons name="add" size={32} color="#fff" />
      </Pressable>

      <BarcodeScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        title="Find a product"
        onScan={(code) => {
          const p = all.find((x) => x.barcode && x.barcode === code);
          if (p) {
            router.push(`/product/${p.id}`);
          } else if (subscription.active) {
            // New item: open the product form with the code already filled in
            setNewBarcode(code);
            setAdding(true);
          }
          return { close: true };
        }}
      />
      <ProductSheet
        visible={adding}
        initialBarcode={newBarcode}
        onClose={() => { setAdding(false); setNewBarcode(''); }}
        branchOptions={branchOptions}
        defaultBranchId={defaultBranchId}
      />
      <SellSheet
        visible={selling}
        onClose={() => setSelling(false)}
        products={all}
        branchOptions={branchOptions}
        defaultBranchId={defaultBranchId}
      />
    </SafeAreaView>
  );
}
