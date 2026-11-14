import { PROFILE_CLAIM_TYPES } from './claim-types.js';

export const STABLE_CLAIM_STATUSES = ['confirmed', 'verified', 'asserted'];
export const REVIEWABLE_CLAIM_STATUSES = ['extracted'];

export const FIELD_DESCRIPTIONS = Object.fromEntries(
  PROFILE_CLAIM_TYPES.map(([field, , , , description]) => [field, description]),
);

const FIELD_SEMANTIC_ALIASES = {
  firstName: ['given name', 'personal name'],
  lastName: ['family name', 'surname'],
  middleName: ['middle name'],
  passportNo: ['passport', 'travel document', 'document number'],
  passportType: ['document type', 'travel document type'],
  nationality: ['citizenship', 'nationality'],
  otherNationalities: ['other nationality', 'second nationality', 'additional citizenship'],
  dateOfBirth: ['birthday', 'dob', 'birth date'],
  birthYear: ['birth year'],
  birthMonth: ['birth month'],
  birthDay: ['birth day'],
  gender: ['sex', 'gender'],
  placeOfBirth: ['birth place', 'place of birth'],
  birthCity: ['birth city', 'city of birth'],
  birthStateProvince: ['birth state', 'birth province', 'state of birth', 'province of birth'],
  birthCountry: ['country of birth', 'birth country'],
  passportIssuingCountry: ['issuing country', 'passport country'],
  passportIssuingAuthority: ['issuing authority', 'passport authority'],
  passportIssuingPost: ['issuing post', 'issuing city', 'passport post'],
  issueDate: ['issued on', 'issue date'],
  expiryDate: ['expiration', 'expiry', 'expiration date'],
  nationalIdType: ['identity card type', 'national id type', 'identity document type'],
  nationalIdNumber: ['national id', 'id number', 'identity card number'],
  nationalIdIssuingCountry: ['id issuing country', 'identity document country'],
  nationalIdIssuingAuthority: ['id issuing authority', 'identity card authority'],
  nationalIdIssueDate: ['identity card issue date', 'national id issue date'],
  nationalIdExpiryDate: ['identity card expiry', 'national id expiry'],
  nationalIdLongTermValid: ['long term valid', 'permanent validity'],
  phone: ['telephone', 'phone number'],
  email: ['email address', 'mail'],
  homeAddress: ['residential address', 'home address'],
  homeAddressCountry: ['residential country', 'home country'],
  employer: ['company', 'employer', 'employment'],
  jobTitle: ['role', 'position', 'job title'],
  employerEmail: ['work email', 'company email'],
  employerPhone: ['work phone', 'company phone'],
  employerAddress: ['work address', 'company address'],
  maritalStatus: ['civil status', 'marital status'],
  emergencyContact: ['emergency contact'],
};

function isString(value) {
  return typeof value === 'string';
}

export function normalizeIdentityText(value) {
  return isString(value) ? value.trim() : '';
}

export function normalizeLower(value) {
  return normalizeIdentityText(value).toLowerCase();
}

export function tokenize(value) {
  return normalizeLower(value)
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

export function uniqueStrings(values) {
  return [...new Set(values.map((value) => normalizeIdentityText(value)).filter(Boolean))];
}

export function titleizeIdentityField(field) {
  return normalizeIdentityText(field)
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (value) => value.toUpperCase())
    .trim();
}

export function confidenceLabel(score) {
  if (typeof score !== 'number') return 'medium';
  if (score >= 0.85) return 'high';
  if (score >= 0.6) return 'medium';
  return 'low';
}

export function countBy(items, mapper) {
  return items.reduce((accumulator, item) => {
    const key = mapper(item);
    accumulator[key] = (accumulator[key] ?? 0) + 1;
    return accumulator;
  }, {});
}

export function maxIsoDate(values, fallback) {
  let best = '';
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const normalized = normalizeIdentityText(value);
    if (!normalized) continue;
    const score = Date.parse(normalized);
    if (Number.isNaN(score)) continue;
    if (score > bestScore) {
      bestScore = score;
      best = normalized;
    }
  }

  return best || fallback;
}

export function fieldSemanticTerms(field) {
  const aliases = FIELD_SEMANTIC_ALIASES[field] ?? [];
  const description = FIELD_DESCRIPTIONS[field] ?? '';
  return uniqueStrings([
    field,
    titleizeIdentityField(field),
    ...aliases,
    description,
  ]).flatMap((value) => [value, ...tokenize(value)]);
}

export function semanticAliasExpansion(token) {
  const matches = [];
  for (const [field, aliases] of Object.entries(FIELD_SEMANTIC_ALIASES)) {
    const aliasTokens = new Set(fieldSemanticTerms(field));
    if (aliasTokens.has(token)) {
      matches.push(field, ...aliases);
    }
  }
  return uniqueStrings(matches);
}
