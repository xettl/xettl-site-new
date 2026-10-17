'use strict';
const versions = Object.freeze({ privacyVersion: '2026-10-17-thank-you', termsVersion: '2026-10-17', emailPreferencesVersion: '2026-10-17' });
function validate(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: { fullName: true } };
  const text = key => typeof input[key] === 'string' ? input[key].trim() : '';
  const data = { version: 4, requestId: text('requestId'), fullName: text('fullName'), email: text('email').toLowerCase(), countryFrom: text('countryFrom'), featureWish: text('featureWish'), adultConfirmed: input.adultConfirmed, termsAccepted: input.termsAccepted, privacyAcknowledged: input.privacyAcknowledged, emailPreferences: input.emailPreferences, ...versions };
  if (!data.fullName || data.fullName.length > 160) errors.fullName = true;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email) || data.email.length > 254) errors.email = true;
  if (data.countryFrom.length > 80) errors.countryFrom = true;
  if (data.featureWish.length < 3 || data.featureWish.length > 1000) errors.featureWish = true;
  if (data.adultConfirmed !== true) errors.adultConfirmed = true;
  if (data.termsAccepted !== true || data.privacyAcknowledged !== true) errors.termsAccepted = true;
  if (input.version !== 4 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.requestId) || Object.entries(versions).some(([key, value]) => key === 'privacyVersion' ? ![value,'2026-10-17-email','2026-10-17-dual-analytics'].includes(input[key]) : input[key] !== value)) return { invalidContract: true };
  // Preserve the notice actually shown by an older open tab; never queue mail retroactively.
  data.privacyVersion = input.privacyVersion;
  if (!data.emailPreferences || typeof data.emailPreferences.newsletter !== 'boolean' || typeof data.emailPreferences.marketing !== 'boolean') return { invalidContract: true };
  data.emailPreferences = { newsletter: data.emailPreferences.newsletter, marketing: data.emailPreferences.marketing };
  return { data, errors };
}
module.exports = { validate, versions };
