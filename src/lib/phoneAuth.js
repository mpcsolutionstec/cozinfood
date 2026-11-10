export function normalizeBrazilPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (String(value || '').trim().startsWith('+')) {
    return digits.length >= 12 && digits.length <= 13 ? `+${digits}` : '';
  }
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return '';
}
