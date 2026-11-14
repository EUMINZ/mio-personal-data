import { randomUUID } from 'node:crypto';

export const PROFILE_CLAIM_TYPES = [
  ['lastName', 'person.name.last', 'text', 'critical', 'Legal family name.'],
  ['firstName', 'person.name.first', 'text', 'critical', 'Legal given name.'],
  ['middleName', 'person.name.middle', 'text', 'high', 'Legal middle name.'],
  ['passportNo', 'passport.number', 'text', 'critical', 'Passport document number.'],
  ['passportType', 'passport.type', 'text', 'high', 'Passport or travel document type.'],
  ['nationality', 'person.nationality', 'text', 'critical', 'Current nationality or citizenship.'],
  ['otherNationalities', 'person.nationalities.other', 'text', 'high', 'Other nationalities or citizenships.'],
  ['dateOfBirth', 'person.birth.date', 'date', 'critical', 'Date of birth.'],
  ['birthYear', 'person.birth.year', 'text', 'high', 'Birth year.'],
  ['birthMonth', 'person.birth.month', 'text', 'high', 'Birth month.'],
  ['birthDay', 'person.birth.day', 'text', 'high', 'Birth day.'],
  ['gender', 'person.gender', 'text', 'high', 'Gender marker used by documents.'],
  ['placeOfBirth', 'person.birth.place', 'text', 'high', 'Portable place-of-birth representation.'],
  ['birthCity', 'person.birth.city', 'text', 'high', 'Birth city.'],
  ['birthStateProvince', 'person.birth.state_province', 'text', 'high', 'Birth state or province.'],
  ['birthCountry', 'person.birth.country', 'text', 'high', 'Birth country.'],
  ['passportIssuingCountry', 'passport.issuing_country', 'text', 'critical', 'Passport issuing country.'],
  ['passportIssuingAuthority', 'passport.issuing_authority', 'text', 'high', 'Passport issuing authority.'],
  ['passportIssuingPost', 'passport.issuing_post', 'text', 'high', 'Passport issuing post or city.'],
  ['issueDate', 'passport.issue_date', 'date', 'critical', 'Passport issue date.'],
  ['expiryDate', 'passport.expiry_date', 'date', 'critical', 'Passport expiry date.'],
  ['nationalIdType', 'identity_document.primary.type', 'text', 'high', 'Primary national identity document type.'],
  ['nationalIdNumber', 'identity_document.primary.number', 'text', 'critical', 'Primary national identity document number.'],
  ['nationalIdIssuingCountry', 'identity_document.primary.issuing_country', 'text', 'high', 'Primary national identity document issuing country.'],
  ['nationalIdIssuingAuthority', 'identity_document.primary.issuing_authority', 'text', 'high', 'Primary national identity document issuing authority.'],
  ['nationalIdIssueDate', 'identity_document.primary.issue_date', 'date', 'medium', 'Primary national identity document issue date.'],
  ['nationalIdExpiryDate', 'identity_document.primary.expiry_date', 'date', 'medium', 'Primary national identity document expiry date.'],
  ['nationalIdLongTermValid', 'identity_document.primary.long_term_valid', 'text', 'medium', 'Whether the primary national identity document is long-term valid.'],
  ['phone', 'person.contact.phone', 'text', 'high', 'Primary phone number.'],
  ['email', 'person.contact.email', 'text', 'high', 'Primary email address.'],
  ['homeAddress', 'person.contact.home_address', 'text', 'high', 'Home address.'],
  ['homeAddressCountry', 'person.contact.home_country', 'text', 'medium', 'Home address country.'],
  ['employer', 'person.employment.employer', 'text', 'high', 'Employer name.'],
  ['jobTitle', 'person.employment.job_title', 'text', 'medium', 'Employment title or role.'],
  ['employerEmail', 'person.employment.email', 'text', 'high', 'Employer email.'],
  ['employerPhone', 'person.employment.phone', 'text', 'medium', 'Employer phone number.'],
  ['employerAddress', 'person.employment.address', 'text', 'high', 'Employer address.'],
  ['maritalStatus', 'person.civil.marital_status', 'text', 'medium', 'Marital status.'],
  ['emergencyContact', 'person.contact.emergency_contact', 'text', 'high', 'Emergency contact.'],
];

export const PROFILE_FIELD_TO_CLAIM_KEY = Object.fromEntries(
  PROFILE_CLAIM_TYPES.map(([field, key]) => [field, key]),
);

export const CLAIM_KEY_TO_PROFILE_FIELD = Object.fromEntries(
  PROFILE_CLAIM_TYPES.map(([field, key]) => [key, field]),
);

export function buildDefaultClaimTypes() {
  return PROFILE_CLAIM_TYPES.map(([field, key, valueType, sensitivityLevel, description]) => ({
    id: `claim_type_${field}`,
    key,
    valueType,
    sensitivityLevel,
    description,
  }));
}

export function getClaimTypeKeyForField(field) {
  return PROFILE_FIELD_TO_CLAIM_KEY[field] ?? null;
}

export function getFieldForClaimTypeKey(claimTypeKey) {
  return CLAIM_KEY_TO_PROFILE_FIELD[claimTypeKey] ?? null;
}

export function createClaimTypeId() {
  return `claim_type_${randomUUID()}`;
}
