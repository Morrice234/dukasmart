import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Card, s } from './ui';
import { colors } from '../theme';
import { useBranch } from '../context/BranchContext';
import { useAuth } from '../context/AuthContext';

// Small pill under screen titles. Hidden when there is only one branch.
export default function BranchSwitcher() {
  const { branches, current, currentBranch, canSwitch, setCurrent } = useBranch();
  const { permissions } = useAuth();
  const [open, setOpen] = useState(false);

  if (branches.length <= 1) return null;

  const label = current === 'all' ? 'All branches' : (currentBranch ? currentBranch.name : 'Branch');

  return (
    <>
      <Pressable
        onPress={() => canSwitch && setOpen(true)}
        style={[s.row, { alignSelf: 'flex-start', marginTop: 8, backgroundColor: colors.primarySoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 }]}
      >
        <Ionicons name="storefront-outline" size={14} color={colors.primaryDark} />
        <Text style={{ color: colors.primaryDark, fontWeight: '700', marginLeft: 6 }}>{label}</Text>
        {canSwitch ? <Ionicons name="chevron-down" size={14} color={colors.primaryDark} style={{ marginLeft: 4 }} /> : null}
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 }} onPress={() => setOpen(false)}>
          <Card style={{ padding: 8 }}>
            {[{ id: 'all', name: 'All branches' }, ...branches].map((b) => (
              <Pressable
                key={b.id}
                onPress={() => { setCurrent(b.id); setOpen(false); }}
                style={[s.row, { padding: 14, justifyContent: 'space-between' }]}
              >
                <Text style={{ fontSize: 16, color: colors.text, fontWeight: current === b.id ? '700' : '400' }}>{b.name}</Text>
                {current === b.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
              </Pressable>
            ))}
            {permissions.canManageBranches ? (
              <Pressable onPress={() => { setOpen(false); router.push('/branches'); }} style={{ padding: 14 }}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Manage branches</Text>
              </Pressable>
            ) : null}
          </Card>
        </Pressable>
      </Modal>
    </>
  );
}
