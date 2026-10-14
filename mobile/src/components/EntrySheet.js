import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chips, Input, s } from './ui';
import { colors } from '../theme';
import PayPrompt from './PayPrompt';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'other', label: 'Other' },
];

export const EXPENSE_CATEGORIES = [
  { value: 'stock', label: 'Stock' },
  { value: 'rent', label: 'Rent' },
  { value: 'wages', label: 'Wages' },
  { value: 'transport', label: 'Transport' },
  { value: 'utilities', label: 'Power & water' },
  { value: 'other', label: 'Other' },
];

// Generic bottom sheet for adding/editing a sale, expense or debt entry
export default function EntrySheet({
  visible, onClose, onSave, onDelete, title, initial,
  showMethod = true, showCategory = false, notePlaceholder = 'What was it for? (optional)',
  branchOptions = null, defaultBranchId = null, mpesaHint = null,
  onPaidByPrompt = null, // set for new sales when the shop can send M-Pesa prompts
}) {
  const [paying, setPaying] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [category, setCategory] = useState('stock');
  const [note, setNote] = useState('');
  const [branchId, setBranchId] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      setAmount(initial ? String(initial.amount) : '');
      setMethod((initial && initial.method) || 'cash');
      setCategory((initial && initial.category) || 'stock');
      setNote((initial && (initial.description || initial.note)) || '');
      setBranchId((initial && initial.branch_id) || defaultBranchId);
      setError('');
      setPaying(false);
    }
  }, [visible, initial, defaultBranchId]);

  const promptAmount = Number(String(amount).replace(/,/g, ''));
  function startPrompt() {
    if (!(promptAmount > 0)) { setError('Enter an amount'); return; }
    setError('');
    setPaying(true);
  }

  async function save() {
    const value = Number(String(amount).replace(/,/g, ''));
    if (!(value > 0)) { setError('Enter an amount'); return; }
    setSaving(true);
    try {
      await onSave({ amount: value, method, category, note: note.trim(), branchId });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '90%' }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled">
            <View style={[s.row, { justifyContent: 'space-between', marginBottom: 16 }]}>
              <Text style={s.h2}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={24} color={colors.muted} /></Pressable>
            </View>
            {paying ? (
              <PayPrompt
                amount={promptAmount}
                purpose="sale"
                branchId={branchId}
                onPaid={async (r) => { await onPaidByPrompt(r, { note: note.trim(), branchId }); setTimeout(onClose, 1200); }}
                onCancel={() => setPaying(false)}
              />
            ) : (<>
            <Input
              label="Amount (KSh)"
              value={amount}
              onChangeText={setAmount}
              keyboardType="numeric"
              autoFocus
              placeholder="0"
              style={{ fontSize: 28, height: 64, fontWeight: '700' }}
            />
            {showMethod ? (<><Text style={s.label}>Paid by</Text><Chips options={METHODS} value={method} onChange={setMethod} /></>) : null}
            {showMethod && method === 'mpesa' && mpesaHint ? (
              <Text style={{ color: colors.warning, fontSize: 12, marginTop: -6, marginBottom: 12 }}>{mpesaHint}</Text>
            ) : null}
            {showCategory ? (<><Text style={s.label}>Category</Text><Chips options={EXPENSE_CATEGORIES} value={category} onChange={setCategory} /></>) : null}
            {branchOptions && branchOptions.length > 1 ? (
              <><Text style={s.label}>Branch</Text><Chips options={branchOptions} value={branchId} onChange={setBranchId} /></>
            ) : null}
            <Input label="Note" value={note} onChangeText={setNote} placeholder={notePlaceholder} />
            {error ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{error}</Text> : null}
            {onPaidByPrompt ? (
              <Button title="Ask customer to pay by M-Pesa" icon="phone-portrait-outline" onPress={startPrompt} style={{ marginBottom: 8 }} />
            ) : null}
            <Button title="Save" variant={onPaidByPrompt ? 'outline' : 'primary'} onPress={save} loading={saving} />
            {onDelete ? <Button title="Delete" variant="ghost" style={{ marginTop: 8 }} onPress={async () => { await onDelete(); onClose(); }} /> : null}
            </>)}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
