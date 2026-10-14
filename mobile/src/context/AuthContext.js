import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, loadToken, setToken } from '../api/client';
import { getMeta, setMeta, wipeLocalData, pendingChangesCount, setSessionContext } from '../db/database';
import { startAutoSync, syncNow } from '../sync/syncEngine';
import { on } from '../events';

const AuthContext = createContext(null);

// Works offline: decides from the dates we last received from the server
export function computeSubscription(b) {
  if (!b) return { state: 'none', active: false };
  const now = Date.now();
  const trial = b.trialEndsAt ? new Date(b.trialEndsAt).getTime() : 0;
  const sub = b.subscriptionEndsAt ? new Date(b.subscriptionEndsAt).getTime() : 0;
  if (b.status === 'suspended') return { state: 'suspended', active: false };
  if (sub > now) return { state: 'active', active: true, endsAt: b.subscriptionEndsAt, planCode: b.planCode };
  if (trial > now) return { state: 'trial', active: true, endsAt: b.trialEndsAt };
  return { state: 'expired', active: false, endsAt: b.subscriptionEndsAt || b.trialEndsAt };
}

// What each role may do in the app. The server enforces the same rules.
export function permissionsFor(role) {
  return {
    isOwner: role === 'owner',
    canDelete: role !== 'cashier',
    canManageTeam: role === 'owner',
    canManageBranches: role === 'owner',
    canPay: role === 'owner',
    canSeeAllStaff: role !== 'cashier',
    canExport: role !== 'cashier',
    canSendSms: role !== 'cashier',
  };
}

function sessionKey(s) {
  return s && s.business ? `${s.business.id}:${s.employee ? s.employee.id : 'owner'}` : null;
}

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [token, setTokenState] = useState(null);
  // { business, employee, role, limits }
  const [session, setSession] = useState(null);
  const [staff, setStaff] = useState([]);

  const saveSession = useCallback(async (s) => {
    setSession(s);
    setSessionContext({ employeeId: s.employee ? s.employee.id : null });
    await setMeta('session', JSON.stringify(s));
  }, []);

  const loadStaff = useCallback(async () => {
    try {
      const res = await api('/team/staff');
      setStaff(res.staff);
      await setMeta('staff', JSON.stringify(res.staff));
    } catch {
      // offline, keep the cached list
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const s = await api('/auth/me');
      await saveSession(s);
      loadStaff();
      return s;
    } catch (e) {
      if (e.status === 401) await signOut(true);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveSession, loadStaff]);

  // Boot: use cached data first so the app opens without internet
  useEffect(() => {
    (async () => {
      const t = await loadToken();
      let cached = await getMeta('session');
      // Upgrade from the first version, which only cached the business
      const legacy = !cached && (await getMeta('business'));
      if (legacy) cached = JSON.stringify({ business: JSON.parse(legacy), employee: null, role: 'owner', limits: { maxBranches: 1, maxEmployees: 0 } });
      const cachedStaff = await getMeta('staff');
      if (cachedStaff) setStaff(JSON.parse(cachedStaff));
      if (t && cached) {
        const s = JSON.parse(cached);
        setSessionContext({ employeeId: s.employee ? s.employee.id : null });
        setSession(s);
        setTokenState(t);
      }
      setLoading(false);
      if (t) refresh();
    })();
  }, [refresh]);

  useEffect(() => {
    if (!token) return undefined;
    const stop = startAutoSync();
    const offExpired = on('auth-expired', () => signOut(true));
    const offBlocked = on('subscription-blocked', () => refresh());
    return () => { stop(); offExpired(); offBlocked(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function finishSignIn({ token: t, ...s }) {
    // Different person on this phone: their data and branch access differ, start clean
    const legacyId = await getMeta('business_id');
    const previous = (await getMeta('session_key')) || (legacyId ? `${legacyId}:owner` : null);
    if (previous && previous !== sessionKey(s)) await wipeLocalData();
    await setToken(t);
    await setMeta('session_key', sessionKey(s));
    await saveSession(s);
    setTokenState(t);
    loadStaff();
  }

  async function signIn(phone, pin) {
    await finishSignIn(await api('/auth/login', { method: 'POST', body: { phone, pin } }));
  }

  async function register(details) {
    await finishSignIn(await api('/auth/register', { method: 'POST', body: details }));
  }

  // force = true skips the unsynced data check (used when the session is invalid)
  async function signOut(force = false) {
    if (!force) {
      await syncNow();
      const pending = await pendingChangesCount();
      if (pending > 0) {
        throw new Error(`${pending} records have not been backed up yet. Connect to the internet and try again.`);
      }
    }
    await setToken(null);
    setTokenState(null);
    setSession(null);
  }

  const business = session ? session.business : null;
  const role = session ? session.role : 'owner';
  const subscription = useMemo(() => computeSubscription(business), [business]);
  const permissions = useMemo(() => permissionsFor(role), [role]);

  const value = {
    loading, token, business, subscription, signIn, register, signOut, refresh,
    employee: session ? session.employee : null,
    role,
    permissions,
    limits: (session && session.limits) || { maxBranches: 1, maxEmployees: 0 },
    staff,
    loadStaff,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
