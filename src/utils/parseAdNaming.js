/**
 * Parse ad naming: #_code country_product name_target_offer_concept_type_format
 * Example: 1094_EN_SMART_BALL_CAT_BASIC_MASHUP_VIDEO_4x5
 */
export function parseAdName(name) {
  if (!name || typeof name !== 'string') {
    return { raw: name, id: '', codeCountry: '', productName: '', target: '', offer: '', concept: '', type: '', format: '' }
  }
  const parts = name.split('_')
  if (parts.length < 4) return { raw: name, id: parts[0] || '', codeCountry: '', productName: name, target: '', offer: '', concept: '', type: '', format: '' }

  const id = parts[0] || ''
  const codeCountry = parts[1] || ''
  const format = parts[parts.length - 1] || ''
  const type = parts[parts.length - 2] || ''
  const middle = parts.slice(2, -2)

  const knownTypes = ['VIDEO', 'IMAGE', 'CAROUSEL']
  const knownConcepts = ['BASIC', 'PROMO', 'MASHUP', 'UGG']

  let productParts = []
  let conceptParts = []
  let seenConcept = false

  for (const p of middle) {
    const up = p.toUpperCase()
    if (knownConcepts.includes(up)) {
      conceptParts.push(p)
      seenConcept = true
    } else if (seenConcept && knownTypes.includes(up)) {
      break
    } else if (!seenConcept) {
      productParts.push(p)
    }
  }
  const productName = productParts.join(' ').replace(/_/g, ' ') || 'Other'
  const concept = conceptParts.length ? conceptParts.join(' ') : '-'

  return {
    raw: name,
    id,
    codeCountry,
    productName: productName || 'Other',
    target: '',
    offer: '',
    concept: concept || '-',
    type: type || '-',
    format: format || '-'
  }
}
