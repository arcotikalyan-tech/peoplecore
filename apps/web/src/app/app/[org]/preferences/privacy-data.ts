/** What a data-deletion request can erase (shared by the server pages and the client forms). */
export const SCOPE_LABELS: Record<string, string> = {
  contact: 'Personal email and phone numbers', address: 'Current and permanent address', family: 'Family members and dependants',
  emergency: 'Emergency contacts', custom: 'Answers to custom profile fields',
};
