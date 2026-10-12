import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import { BranchProvider } from '../src/context/BranchContext';
import { on } from '../src/events';
import { colors } from '../src/theme';

// Always start on the home tabs, never on a screen like Subscription
export const unstable_settings = { initialRouteName: '(tabs)' };

const PUBLIC_SCREENS = ['login', 'register'];

// Sends anyone who is not signed in to the login screen, whatever screen they land on
function AuthGate() {
  const { loading, token } = useAuth();
  const segments = useSegments();
  useEffect(() => {
    if (loading) return;
    const onPublic = PUBLIC_SCREENS.includes(segments[0]);
    if (!token && !onPublic) router.replace('/login');
    else if (token && onPublic) router.replace('/');
  }, [loading, token, segments]);
  return null;
}

function SyncNotices() {
  useEffect(() => on('sync-rejected', (n) => {
    Alert.alert(
      'Some changes were not saved',
      `${n} change${n === 1 ? ' was' : 's were'} not allowed for your account or plan (for example a new branch over the plan limit) and ${n === 1 ? 'has' : 'have'} been undone.`
    );
  }), []);
  return null;
}

// Screens opened on top of the tabs keep their content above the phone's navigation bar
function AppStack() {
  const insets = useSafeAreaInsets();
  const withHeader = (title, extra = {}) => ({
    headerShown: true,
    title,
    contentStyle: { backgroundColor: colors.bg, paddingBottom: insets.bottom },
    ...extra,
  });
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="subscribe" options={withHeader('Subscription', { presentation: 'modal' })} />
      <Stack.Screen name="customer/[id]" options={withHeader('Customer')} />
      <Stack.Screen name="product/[id]" options={withHeader('Product')} />
      <Stack.Screen name="branches" options={withHeader('Branches')} />
      <Stack.Screen name="team" options={withHeader('Staff')} />
      <Stack.Screen name="invite" options={withHeader('Invite & earn')} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <BranchProvider>
          <StatusBar style="dark" />
          <SyncNotices />
          <AuthGate />
          <AppStack />
        </BranchProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
