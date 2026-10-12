import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/context/AuthContext';
import { colors } from '../../src/theme';

const icon = (name) => ({ color, size }) => <Ionicons name={name} size={size} color={color} />;

export default function TabsLayout() {
  const { loading, token } = useAuth();
  // Space taken by the phone's own navigation buttons or gesture bar
  const insets = useSafeAreaInsets();
  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  if (!token) return <Redirect href="/login" />;

  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.primary, tabBarLabelStyle: { fontSize: 11 }, tabBarStyle: { height: 60 + insets.bottom, paddingBottom: insets.bottom + 6, paddingTop: 6 } }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('home-outline') }} />
      <Tabs.Screen name="sales" options={{ title: 'Sales', tabBarIcon: icon('cash-outline') }} />
      <Tabs.Screen name="stock" options={{ title: 'Stock', tabBarIcon: icon('cube-outline') }} />
      <Tabs.Screen name="expenses" options={{ title: 'Expenses', tabBarIcon: icon('receipt-outline') }} />
      <Tabs.Screen name="debts" options={{ title: 'Deni', tabBarIcon: icon('people-outline') }} />
      <Tabs.Screen name="account" options={{ title: 'Account', tabBarIcon: icon('person-circle-outline') }} />
    </Tabs>
  );
}
