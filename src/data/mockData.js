// Mock data - Phase 1 Reporting (extended for filters, date ranges, projections)
import { subDays, format } from 'date-fns'

const markets = ['ES', 'MX', 'FR', 'DE', 'IT', 'UK']
const products = ['Smart Ball Cat', 'Dental Stick Dog', 'Anti-Shed Brush', 'Calming Treats', 'Joint Supplement']

// Génère des données de tendance
export const getSpendTrend = (days = 7) => {
  const data = []
  for (let i = days - 1; i >= 0; i--) {
    const d = subDays(new Date(), i)
    const base = 8000 + Math.random() * 8000
    data.push({
      date: format(d, 'd MMM'),
      fullDate: format(d, 'yyyy-MM-dd'),
      spend: Math.round(base),
    })
  }
  return data
}

export const getSpendTrendCustom = (dateFrom, dateTo) => {
  const from = new Date(dateFrom)
  const to = new Date(dateTo)
  const days = Math.max(1, Math.ceil((to - from) / (24 * 60 * 60 * 1000)) + 1)
  const data = []
  for (let i = 0; i < Math.min(days, 90); i++) {
    const d = new Date(from)
    d.setDate(d.getDate() + i)
    if (d > to) break
    const base = 8000 + Math.random() * 8000
    data.push({
      date: format(d, 'd MMM'),
      fullDate: format(d, 'yyyy-MM-dd'),
      spend: Math.round(base),
    })
  }
  return data
}

export const spendByAccount = [
  { account: 'VELUNAPETS ES COD $', spend: 12450, budget: 15000, country: 'ES', model: 'COD', currency: '$' },
  { account: 'VELUNAPETS MX DROP $', spend: 8900, budget: 10000, country: 'MX', model: 'DROP', currency: '$' },
  { account: 'VELUNAPETS FR COD €', spend: 18700, budget: 20000, country: 'FR', model: 'COD', currency: '€' },
  { account: 'VELUNAPETS DE COD €', spend: 15200, budget: 18000, country: 'DE', model: 'COD', currency: '€' },
  { account: 'VELUNAPETS IT DROP €', spend: 6200, budget: 8000, country: 'IT', model: 'DROP', currency: '€' },
  { account: 'VELUNAPETS UK COD £', spend: 21300, budget: 25000, country: 'UK', model: 'COD', currency: '£' },
]

export const spendByProduct = [
  { product: 'Smart Ball Cat', spend: 18200, impressions: 2450000, ctr: 2.1 },
  { product: 'Dental Stick Dog', spend: 15600, impressions: 1980000, ctr: 1.8 },
  { product: 'Anti-Shed Brush', spend: 12400, impressions: 1670000, ctr: 2.4 },
  { product: 'Calming Treats', spend: 9800, impressions: 1340000, ctr: 1.6 },
  { product: 'Joint Supplement', spend: 7560, impressions: 980000, ctr: 2.0 },
]

// Données pour pie chart par marché
export const spendByMarket = [
  { market: 'ES', spend: 12450, fill: '#f59e0b' },
  { market: 'MX', spend: 8900, fill: '#22c55e' },
  { market: 'FR', spend: 18700, fill: '#3b82f6' },
  { market: 'DE', spend: 15200, fill: '#8b5cf6' },
  { market: 'IT', spend: 6200, fill: '#ec4899' },
  { market: 'UK', spend: 21300, fill: '#06b6d4' },
]

export const topWinners = [
  { rank: 1, adName: '1094_EN_SMART_BALL_CAT_BASIC_MASHUP_VIDEO_4x5', market: 'ES', spend: 2450, roas: 3.2, product: 'Smart Ball Cat', format: '4x5', ctr: 2.4 },
  { rank: 2, adName: '1089_ES_DENTAL_STICK_DOG_PROMO_VIDEO_1x1', market: 'ES', spend: 2100, roas: 2.9, product: 'Dental Stick Dog', format: '1x1', ctr: 1.9 },
  { rank: 3, adName: '1092_FR_ANTI_SHED_BRUSH_BASIC_VIDEO_4x5', market: 'FR', spend: 3200, roas: 2.7, product: 'Anti-Shed Brush', format: '4x5', ctr: 2.6 },
  { rank: 4, adName: '1085_MX_CALMING_TREATS_PROMO_VIDEO_9x16', market: 'MX', spend: 1850, roas: 2.5, product: 'Calming Treats', format: '9x16', ctr: 2.1 },
  { rank: 5, adName: '1090_DE_JOINT_SUPPLEMENT_BASIC_VIDEO_4x5', market: 'DE', spend: 2800, roas: 2.4, product: 'Joint Supplement', format: '4x5', ctr: 1.8 },
  { rank: 6, adName: '1091_UK_SMART_BALL_CAT_PROMO_VIDEO_9x16', market: 'UK', spend: 4100, roas: 2.3, product: 'Smart Ball Cat', format: '9x16', ctr: 2.0 },
  { rank: 7, adName: '1088_IT_DENTAL_STICK_DOG_BASIC_VIDEO_4x5', market: 'IT', spend: 1200, roas: 2.8, product: 'Dental Stick Dog', format: '4x5', ctr: 2.2 },
  { rank: 8, adName: '1093_FR_CALMING_TREATS_MASHUP_VIDEO_4x5', market: 'FR', spend: 2650, roas: 2.6, product: 'Calming Treats', format: '4x5', ctr: 2.3 },
  { rank: 9, adName: '1087_ES_ANTI_SHED_BRUSH_VIDEO_9x16', market: 'ES', spend: 1580, roas: 2.4, product: 'Anti-Shed Brush', format: '9x16', ctr: 1.7 },
  { rank: 10, adName: '1086_UK_JOINT_SUPPLEMENT_PROMO_VIDEO_1x1', market: 'UK', spend: 3200, roas: 2.2, product: 'Joint Supplement', format: '1x1', ctr: 1.5 },
]

export const stockByWarehouse = [
  { warehouse: 'ES-BCN', sku: 'Smart Ball Cat', sold: 1240, stock: 3200, status: 'ok', reorderAt: 500, dailyAvg: 85 },
  { warehouse: 'ES-BCN', sku: 'Dental Stick Dog', sold: 980, stock: 450, status: 'warning', reorderAt: 500, dailyAvg: 65 },
  { warehouse: 'MX-MEX', sku: 'Calming Treats', sold: 2100, stock: 120, status: 'critical', reorderAt: 300, dailyAvg: 140 },
  { warehouse: 'MX-MEX', sku: 'Joint Supplement', sold: 650, stock: 2100, status: 'ok', reorderAt: 400, dailyAvg: 45 },
  { warehouse: 'FR-PAR', sku: 'Anti-Shed Brush', sold: 1450, stock: 890, status: 'ok', reorderAt: 500, dailyAvg: 95 },
  { warehouse: 'FR-PAR', sku: 'Smart Ball Cat', sold: 890, stock: 180, status: 'critical', reorderAt: 400, dailyAvg: 60 },
  { warehouse: 'DE-BER', sku: 'Dental Stick Dog', sold: 720, stock: 1100, status: 'ok', reorderAt: 400, dailyAvg: 48 },
  { warehouse: 'UK-LON', sku: 'Smart Ball Cat', sold: 2100, stock: 340, status: 'warning', reorderAt: 500, dailyAvg: 140 },
]

export const stockAlerts = [
  { sku: 'Calming Treats', warehouse: 'MX-MEX', stock: 120, action: 'Order stock', daysLeft: 0.9, suggested: 'Cut marketing on MX' },
  { sku: 'Smart Ball Cat', warehouse: 'FR-PAR', stock: 180, action: 'Order stock', daysLeft: 3, suggested: 'Cut marketing on FR' },
  { sku: 'Dental Stick Dog', warehouse: 'ES-BCN', stock: 450, action: 'Monitor', daysLeft: 7, suggested: 'Place order within 7 days' },
  { sku: 'Smart Ball Cat', warehouse: 'UK-LON', stock: 340, action: 'Monitor', daysLeft: 2.4, suggested: 'Place order within 3 days' },
]

export { markets, products }
