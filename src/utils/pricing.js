// Client-side pricing preview ONLY - purely for showing a live calculator
// as the customer types. The real, authoritative price is always
// recalculated inside the `place_order` database function on the server.
// Never trust this output for the actual charge.
//
// IMPORTANT: service/tier rates are the CUSTOMER RATE PER 1,000 units
// (matches the SMM supplier panel's own pricing convention), not a
// per-single-unit price. So Customer Cost = (Quantity / 1000) * Rate.

export function findApplicableTier(tiers, quantity) {
  if (!tiers || tiers.length === 0) return null
  const active = tiers
    .filter((t) => t.is_active)
    .sort((a, b) => a.min_quantity - b.min_quantity)
  for (const tier of active) {
    const withinMin = quantity >= tier.min_quantity
    const withinMax = tier.max_quantity == null || quantity <= tier.max_quantity
    if (withinMin && withinMax) return tier
  }
  return null
}

export function getApplicableRate(service, tiers, quantity) {
  const tier = findApplicableTier(tiers, quantity)
  if (tier) return Number(tier.rate)
  return Number(service.base_rate)
}

export function calculateServiceTotal(service, tiers, quantity) {
  const qty = Number(quantity) || 0
  const rate = getApplicableRate(service, tiers, qty)
  // Fixed-price services (e.g. a YouTube Watch Time package) are sold as
  // one flat package, not scaled by quantity - base_rate IS the price,
  // full stop. Everything else keeps the per-1,000 convention above.
  if (service.is_fixed_price) {
    return { rate, total: Math.round(rate * 100) / 100 }
  }
  return {
    rate,
    total: Math.round(((rate * qty) / 1000) * 100) / 100
  }
}

export function validateQuantity(service, quantity) {
  const qty = Number(quantity)
  if (!quantity || Number.isNaN(qty) || qty <= 0) {
    return 'Please enter a quantity.'
  }
  if (qty < service.min_quantity) {
    return `Minimum quantity is ${service.min_quantity}.`
  }
  if (qty > service.max_quantity) {
    return `Maximum quantity is ${service.max_quantity}.`
  }
  return null
}

export function lowestActiveRate(services, tiersByService) {
  let lowest = null
  for (const s of services) {
    const tiers = tiersByService[s.id] || []
    const rates = [Number(s.base_rate), ...tiers.filter((t) => t.is_active).map((t) => Number(t.rate))]
    const min = Math.min(...rates)
    if (lowest === null || min < lowest) lowest = min
  }
  return lowest
}
