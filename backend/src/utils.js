class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Accepts 07XXXXXXXX, 01XXXXXXXX, 7XXXXXXXX, +2547XXXXXXXX and returns 2547XXXXXXXX
function normalizePhone(input) {
  let s = String(input || '').replace(/\D/g, '');
  if (s.startsWith('0')) s = '254' + s.slice(1);
  else if (s.length === 9 && (s.startsWith('7') || s.startsWith('1'))) s = '254' + s;
  return /^254(7|1)\d{8}$/.test(s) ? s : null;
}

function subscriptionInfo(b) {
  const now = Date.now();
  const trialEnds = b.trial_ends_at ? new Date(b.trial_ends_at).getTime() : 0;
  const subEnds = b.subscription_ends_at ? new Date(b.subscription_ends_at).getTime() : 0;

  if (b.status === 'suspended') return { state: 'suspended', active: false, endsAt: null };
  if (subEnds > now) return { state: 'active', active: true, endsAt: b.subscription_ends_at, planCode: b.plan_code };
  if (trialEnds > now) return { state: 'trial', active: true, endsAt: b.trial_ends_at };
  return { state: 'expired', active: false, endsAt: subEnds ? b.subscription_ends_at : b.trial_ends_at };
}

function publicBusiness(b) {
  return {
    id: b.id,
    name: b.name,
    ownerName: b.owner_name,
    phone: b.phone,
    businessType: b.business_type,
    location: b.location,
    status: b.status,
    trialEndsAt: b.trial_ends_at,
    subscriptionEndsAt: b.subscription_ends_at,
    planCode: b.plan_code,
    referralCode: b.referral_code,
    smsCredits: b.sms_credits || 0,
    createdAt: b.created_at,
    subscription: subscriptionInfo(b),
  };
}

module.exports = { HttpError, normalizePhone, subscriptionInfo, publicBusiness };
