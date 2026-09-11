import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Wallet as WalletIcon, ShieldCheck, Tag, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useWallet } from '../../hooks/useWallet'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import ServiceCalculatorCard from '../../components/services/ServiceCalculatorCard'
import { getIcon } from '../../utils/iconMap'
import { formatCurrency, formatRate } from '../../utils/format'
import { calculateServiceTotal, validateQuantity } from '../../utils/pricing'
import { isValidTargetLink, targetLinkErrorMessage } from '../../utils/validators'

export default function CategoryOrder() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const preselectServiceId = location.state?.preselectServiceId
  const { isLoggedIn } = useAuth()
  const { wallet, refresh: refreshWallet } = useWallet()

  const [loading, setLoading] = useState(true)
  const [category, setCategory] = useState(null)
  const [services, setServices] = useState([])
  const [tiersByService, setTiersByService] = useState({})

  const [selection, setSelection] = useState({}) // serviceId -> { selected, quantity, targetLink }
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [showErrors, setShowErrors] = useState(false)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState(null) // { code, title, discount_amount, payable_total, forAmount }
  const [couponChecking, setCouponChecking] = useState(false)
  const [couponError, setCouponError] = useState('')

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const { data: cat } = await supabase.from('categories').select('*').eq('slug', slug).eq('is_active', true).maybeSingle()
      if (!cat) {
        if (mounted) {
          setCategory(null)
          setLoading(false)
        }
        return
      }
      const { data: svcs } = await supabase
        .from('services')
        .select('*')
        .eq('category_id', cat.id)
        .eq('is_active', true)
        .order('display_order')

      let tiers = []
      if (svcs && svcs.length > 0) {
        const { data } = await supabase
          .from('service_price_tiers')
          .select('*')
          .eq('is_active', true)
          .in('service_id', svcs.map((s) => s.id))
        tiers = data || []
      }
      const byService = {}
      for (const t of tiers) {
        if (!byService[t.service_id]) byService[t.service_id] = []
        byService[t.service_id].push(t)
      }
      if (!mounted) return
      setCategory(cat)
      setServices((svcs || []).map((s) => ({ ...s, category_icon: cat.icon })))
      setTiersByService(byService)
      if (preselectServiceId && (svcs || []).some((s) => s.id === preselectServiceId)) {
        setSelection((prev) => ({ ...prev, [preselectServiceId]: { ...prev[preselectServiceId], selected: true } }))
      }
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  function updateSelection(serviceId, patch) {
    setSelection((prev) => ({ ...prev, [serviceId]: { ...prev[serviceId], ...patch } }))
  }

  const lineItems = useMemo(() => {
    return services
      .filter((s) => selection[s.id]?.selected)
      .map((s) => {
        const state = selection[s.id] || {}
        const { rate, total } = calculateServiceTotal(s, tiersByService[s.id] || [], state.quantity)
        const qtyError = state.quantity ? validateQuantity(s, state.quantity) : null
        const linkError =
          s.requires_target_link && state.targetLink && !isValidTargetLink(s.target_platform, state.targetLink)
            ? targetLinkErrorMessage(s.target_platform)
            : null
        return { service: s, rate, total, qtyError, linkError, quantity: state.quantity, targetLink: state.targetLink }
      })
  }, [services, selection, tiersByService])

  const grandTotal = lineItems.reduce((sum, item) => sum + item.total, 0)
  const hasSelection = lineItems.length > 0

  // A coupon's discount was computed against the order total at the
  // moment it was applied. If the customer changes quantities afterward,
  // that discount is stale — drop it rather than silently keep charging
  // the old (possibly wrong) discounted amount.
  useEffect(() => {
    if (appliedCoupon && appliedCoupon.forAmount !== grandTotal) {
      setAppliedCoupon(null)
      setCouponError('Your order changed — please re-apply the coupon.')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grandTotal])

  const payableTotal = appliedCoupon ? appliedCoupon.payable_total : grandTotal

  async function handleApplyCoupon() {
    setCouponError('')
    if (!couponInput.trim()) {
      setCouponError('Please enter a coupon code.')
      return
    }
    setCouponChecking(true)
    const { data, error: err } = await supabase.rpc('validate_coupon', {
      p_code: couponInput.trim(),
      p_order_amount: grandTotal
    })
    setCouponChecking(false)
    if (err) {
      setCouponError(err.message || 'Could not apply this coupon.')
      return
    }
    setAppliedCoupon({ ...data, forAmount: grandTotal })
    setCouponInput('')
  }

  function handleRemoveCoupon() {
    setAppliedCoupon(null)
    setCouponError('')
  }

  function validateAll() {
    for (const item of lineItems) {
      const qtyErr = validateQuantity(item.service, item.quantity)
      if (qtyErr) return qtyErr
      if (item.service.requires_target_link) {
        if (!item.targetLink || !isValidTargetLink(item.service.target_platform, item.targetLink)) {
          return targetLinkErrorMessage(item.service.target_platform)
        }
      }
    }
    return null
  }

  async function handlePayNow() {
    setSubmitError('')
    setShowErrors(true)

    if (!isLoggedIn) {
      navigate('/login', { state: { from: `/services/${slug}` } })
      return
    }
    if (!hasSelection) {
      setSubmitError('Please select at least one service.')
      return
    }
    const validationError = validateAll()
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    if (wallet && payableTotal > wallet.available_fund) {
      setSubmitError(
        `Insufficient wallet balance. Please add ${formatCurrency(payableTotal - wallet.available_fund)} or more to continue.`
      )
      return
    }

    setSubmitting(true)
    try {
      const payload = lineItems.map((item) => ({
        service_id: item.service.id,
        quantity: Number(item.quantity),
        target_link: item.targetLink || null
      }))

      const { data, error } = await supabase.rpc('place_order', {
        p_items: payload,
        p_idempotency_key: idempotencyKey,
        p_coupon_code: appliedCoupon?.code || null
      })

      if (error) {
        const msg = error.message || ''
        if (msg.includes('INSUFFICIENT_FUNDS')) {
          const shortfall = msg.split(':')[1]
          setSubmitError(`Insufficient wallet balance. Please add ${formatCurrency(shortfall)} or more to continue.`)
        } else {
          setSubmitError(msg.replace('INSUFFICIENT_FUNDS:', ''))
        }
        setSubmitting(false)
        return
      }

      await refreshWallet()
      setIdempotencyKey(crypto.randomUUID())
      navigate('/order-success', { state: data })
    } catch (e) {
      setSubmitError(e.message || 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  if (loading) return <Loader />
  if (!category) {
    return (
      <div className="page-pad">
        <EmptyState title="Category not found" subtitle="It may have been deactivated by the admin." />
      </div>
    )
  }

  const Icon = getIcon(category.icon)

  return (
    <div className="page-pad">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: 14,
            background: 'linear-gradient(135deg,var(--gold),var(--crimson))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Icon size={20} color="#170f08" />
        </span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{category.name}</div>
          {category.description && (
            <div className="text-faint" style={{ fontSize: 11.5 }}>
              {category.description}
            </div>
          )}
        </div>
      </div>

      {services.length === 0 ? (
        <EmptyState title="No services yet" subtitle="The admin hasn't added services to this category yet." />
      ) : (
        <>
          {(() => {
            // Services are grouped under a small sub-heading (Likes,
            // Followers, Views...) when they carry a service_group, purely
            // to make a long list of services on one platform easier to
            // scan - services without a group just render in order with
            // no heading, so this is backward compatible with old data.
            let lastGroup
            return services.map((s) => {
              const state = selection[s.id] || {}
              const { rate, total } = calculateServiceTotal(s, tiersByService[s.id] || [], state.quantity)
              const showGroupHeading = s.service_group && s.service_group !== lastGroup
              lastGroup = s.service_group
              return (
                <div key={s.id}>
                  {showGroupHeading && (
                    <div className="section-title" style={{ margin: '14px 0 8px' }}>
                      {s.service_group}
                    </div>
                  )}
                  <ServiceCalculatorCard
                    service={s}
                    selected={!!state.selected}
                    quantity={state.quantity || ''}
                    targetLink={state.targetLink || ''}
                    rate={rate}
                    total={total}
                    quantityError={showErrors && state.quantity ? validateQuantity(s, state.quantity) : null}
                    linkError={
                      showErrors && s.requires_target_link && state.targetLink && !isValidTargetLink(s.target_platform, state.targetLink)
                        ? targetLinkErrorMessage(s.target_platform)
                        : null
                    }
                    onToggle={() => updateSelection(s.id, { selected: !state.selected })}
                    onQuantityChange={(v) => updateSelection(s.id, { quantity: v })}
                    onLinkChange={(v) => updateSelection(s.id, { targetLink: v })}
                  />
                </div>
              )
            })
          })()}

          {hasSelection && (
            <div className="surface-card" style={{ marginTop: 6 }}>
              <div className="section-title" style={{ marginBottom: 8 }}>
                Order Summary
              </div>
              {lineItems.map((item) => (
                <div key={item.service.id} className="row-between" style={{ fontSize: 12.5, marginBottom: 6, alignItems: 'flex-start' }}>
                  <span className="text-dim">
                    {item.service.name}
                    {item.service.external_service_id != null && (
                      <span className="text-faint"> (ID: {item.service.external_service_id})</span>
                    )}
                    <br />
                    <span className="text-faint">{item.quantity || 0} units × {formatRate(item.rate)} / 1000</span>
                  </span>
                  <span style={{ fontWeight: 700, flexShrink: 0 }}>{formatCurrency(item.total)}</span>
                </div>
              ))}
              <div className="divider" />
              <div className="row-between" style={{ fontSize: 15, fontWeight: 800 }}>
                <span>Grand Total</span>
                <span className={appliedCoupon ? 'text-faint' : 'text-gold'} style={appliedCoupon ? { textDecoration: 'line-through', fontWeight: 600 } : undefined}>
                  {formatCurrency(grandTotal)}
                </span>
              </div>

              {isLoggedIn && (
                <div style={{ marginTop: 10 }}>
                  {appliedCoupon ? (
                    <div className="row-between" style={{ fontSize: 12.5, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 10, padding: '8px 10px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Tag size={13} className="text-success" />
                        <span className="text-success" style={{ fontWeight: 700 }}>{appliedCoupon.code}</span> applied
                      </span>
                      <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={handleRemoveCoupon} aria-label="Remove coupon">
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder="Have a coupon code?"
                        style={{ flex: 1, textTransform: 'uppercase' }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ width: 'auto', flexShrink: 0, padding: '10px 16px' }}
                        onClick={handleApplyCoupon}
                        disabled={couponChecking}
                      >
                        {couponChecking ? 'Checking…' : 'Apply'}
                      </button>
                    </div>
                  )}
                  {couponError && <div className="field-error" style={{ marginTop: 6 }}>{couponError}</div>}
                </div>
              )}

              {appliedCoupon && (
                <>
                  <div className="row-between" style={{ fontSize: 13, marginTop: 10 }}>
                    <span className="text-faint">Coupon Discount</span>
                    <span className="text-success" style={{ fontWeight: 700 }}>- {formatCurrency(appliedCoupon.discount_amount)}</span>
                  </div>
                  <div className="row-between" style={{ fontSize: 15, fontWeight: 800, marginTop: 6 }}>
                    <span>Payable Amount</span>
                    <span className="text-gold">{formatCurrency(payableTotal)}</span>
                  </div>
                </>
              )}

              {isLoggedIn && wallet && (
                <div className="row-between" style={{ fontSize: 12, marginTop: 8 }}>
                  <span className="text-faint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <WalletIcon size={13} /> Available Fund
                  </span>
                  <span className={payableTotal > wallet.available_fund ? 'text-danger' : 'text-success'}>
                    {formatCurrency(wallet.available_fund)}
                  </span>
                </div>
              )}

              {submitError && <div className="field-error" style={{ marginTop: 10 }}>{submitError}</div>}

              {submitError.includes('Insufficient') ? (
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/add-funds')}>
                  Add Funds
                </button>
              ) : (
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handlePayNow} disabled={submitting}>
                  <ShieldCheck size={16} /> {submitting ? 'Processing…' : `Pay Now · ${formatCurrency(payableTotal)}`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
