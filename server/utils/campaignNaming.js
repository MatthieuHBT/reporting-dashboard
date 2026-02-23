/**
 * Normalise les variantes de noms produits pour éviter les doublons.
 * Ex: SILVERVINESTICKS → SILVERVINE DENTAL STICKS, SMARTBALL → SMART BALL
 */
const PRODUCT_ALIASES = {
  silvervinesticks: 'SILVERVINE DENTAL STICKS',
  silvervinedentalsticks: 'SILVERVINE DENTAL STICKS',
  'silvervine dental sticks': 'SILVERVINE DENTAL STICKS',
  smartball: 'SMART BALL',
  'smart ball': 'SMART BALL',
  pawtrimmer: 'PAW TRIMMER',
  'paw trimmer': 'PAW TRIMMER',
  'anti flea collar 12 months': 'ANTI FLEA COLLAR 12 MONTHS',
  barkingdevice: 'BARKING DEVICE',
  'barking device': 'BARKING DEVICE',
  bundles: 'BUNDLES',
  pheromonediffuser: 'PHEROMONE DIFFUSER',
  'lint reusable roller': 'LINT REUSABLE ROLLER',
  smartbal: 'SMART BALL',
  'bg silvervine dental sticks': 'SILVERVINE DENTAL STICKS',
  'bg lint reusable roller': 'LINT REUSABLE ROLLER',
  dentalwipes: 'DENTAL WIPES',
  fingerwipes: 'FINGER WIPES',
  spiralscratch: 'SPIRAL SCRATCH',
  'mist brush': 'MIST BRUSH',
}

export function normalizeProductName(name) {
  if (!name || typeof name !== 'string') return 'Other'
  const key = name.trim().toLowerCase().replace(/\s+/g, '')
  const bySpaces = name.trim().toLowerCase()
  return PRODUCT_ALIASES[key] || PRODUCT_ALIASES[bySpaces] || (name.trim() || 'Other')
}

/** Clé produit pour agrégation : normalise + fusionne variantes (ex. "X LP" / "X PDP" → "X"). */
export function normalizeProductKey(label) {
  if (!label || typeof label !== 'string') return 'Other'
  let s = normalizeProductName(label.trim())
  s = s.replace(/\s+LP\s*$/i, '').replace(/\s+PDP(\s+PDP)*\s*$/i, '').replace(/\s{2,}/g, ' ').trim()
  return s || 'Other'
}

/**
 * Parse campaign naming: CBO_[CODE_COUNTRY]_[PRODUCT NAME]_[ANIMAL]_[TYPE]_[DATE]
 * Example: CBO_ES_SMART_BALL_CAT_BASIC_MASHUP_VIDEO_20250216
 */
const COUNTRY_CODE_RE = /^[A-Z]{2,3}$/

export function parseCampaignName(name) {
  if (!name || typeof name !== 'string') {
    return { codeCountry: '', productName: 'Other', animal: '', type: '', date: '', raw: name }
  }

  const parts = name.split('_')
  // CBO/ABO_XX_... : extraire le pays (accepter espaces: "CBO _HR_" → HR)
  const firstPart = (parts[0] || '').trim()
  let codeCountry = (parts.length >= 2 && /^(CBO|ABO)$/i.test(firstPart) && COUNTRY_CODE_RE.test((parts[1] || '').trim().toUpperCase()))
    ? (parts[1] || '').trim().toUpperCase()
    : ''
  // Fallback: [NEW] CBO_GR_..., [NOT LIVE] CBO_HU_..., CBO _HR_... (espace après CBO)
  if (!codeCountry) {
    const match = name.match(/(?:CBO|ABO)\s*_\s*([A-Z]{2,3})(?:_|$|\s)/i)
    if (match && COUNTRY_CODE_RE.test((match[1] || '').toUpperCase())) {
      codeCountry = (match[1] || '').toUpperCase()
    }
  }

  // Format court 5 parties : CBO_MX_DENTALWIPES_DOG_TESTING #7 → product=DENTAL WIPES, animal=DOG
  if (parts.length === 5) {
    const rawProduct = (parts[2] || '').trim()
    const animal = (parts[3] || '').trim()
    const productName = normalizeProductName(rawProduct)
    const productWithAnimal = animal ? `${productName} ${animal}` : productName
    return { codeCountry, productName, productWithAnimal, animal, type: (parts[4] || '').trim(), date: '', raw: name }
  }

  if (parts.length < 6) {
    return { codeCountry, productName: 'Other', animal: '', type: '', date: '', raw: name }
  }

  const date = parts[parts.length - 1] || ''
  const animal = parts[parts.length - 3] || '' // e.g. CAT, DOG
  const type = parts[parts.length - 2] || ''   // e.g. BASIC, PROMO
  const rawProduct = parts.slice(2, parts.length - 3).join(' ').replace(/_/g, ' ').trim() || ''
  const productName = normalizeProductName(rawProduct)
  // Inclure l'animal : SMART BALL DOG, SMART BALL CAT (convention Diego)
  const productWithAnimal = animal ? `${productName} ${animal}` : productName

  return {
    codeCountry,
    productName,
    productWithAnimal,
    animal,
    type,
    date,
    raw: name
  }
}
