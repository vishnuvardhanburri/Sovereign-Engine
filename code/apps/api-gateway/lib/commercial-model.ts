export const XAVIRA_COMMERCIAL_MODEL = {
  currency: 'GBP',
  currencySymbol: '£',
  productName: 'Xavira Control Stack',
  internalEnterpriseLicense: {
    name: 'Internal Enterprise License',
    price: 40_000,
    label: '£40,000',
    rights: 'Internal operational usage rights only',
  },
  whiteLabelCommercialLicense: {
    name: 'White-Label Commercial License',
    price: 160_000,
    label: '£160,000',
    rights: 'White-label, reseller, commercial deployment, and multi-client operations rights',
    partnerEconomics:
      'Designed for agencies to package as a premium client-generation deployment; roughly 3-4 serious client rollouts can recover the £160,000 license cost, then the stack becomes a reusable commercial operating asset.',
  },
  operationsMaintenance: {
    name: 'Operations & Maintenance',
    priceMonthly: 3_000,
    label: '£3,000/month',
    rights: 'Support, updates, infrastructure guidance, monitoring support, and governance support',
  },
} as const

export type XaviraOfferType = 'direct' | 'agency'

export function commercialDealValueGbp(offerType: XaviraOfferType): number {
  return offerType === 'agency'
    ? XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.price
    : XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.price
}

export function commercialDealLabel(offerType: XaviraOfferType): string {
  return offerType === 'agency'
    ? XAVIRA_COMMERCIAL_MODEL.whiteLabelCommercialLicense.label
    : XAVIRA_COMMERCIAL_MODEL.internalEnterpriseLicense.label
}

export function formatGbp(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: XAVIRA_COMMERCIAL_MODEL.currency,
    maximumFractionDigits: 0,
  }).format(Number(value || 0))
}
