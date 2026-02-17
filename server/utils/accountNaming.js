/**
 * Extract market (country code) from ad account name
 * Convention: [BRAND] [CODE-COUNTRY] [MODEL] [CURRENCY]
 * Example: VELUNAPETS SI COD $ → SI, VELUNAPETS SK COD $ → SK
 * Note: le market est prioritairement lu depuis le nom de campagne (CBO_MX_... → MX)
 *       extractMarketFromAccount sert de fallback pour les campagnes sans convention
 */
export function extractMarketFromAccount(accountName) {
  if (!accountName || typeof accountName !== 'string') return ''
  const parts = accountName.trim().split(/\s+/)
  // Second token is the country code (e.g. SI, SK, HU, ES, MX)
  const code = parts[1]
  if (!code || code.length < 2 || code.length > 3) return ''
  return code.toUpperCase()
}
