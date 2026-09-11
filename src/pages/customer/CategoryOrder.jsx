import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { Wallet as WalletIcon, ShieldCheck, Tag, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useWallet } from '../../hooks/useWallet'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import Modal from '../../components/common/Modal'
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [showErrors, setShowErrors] = useState(false)

  const [couponInput, setCouponInput] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState(null) // { code, title, discount_amount, payable_total, forAmount }
  const [couponChecking, setCouponChecking] = useState(false)
  const [couponError, setCouponError] = useState('')

  // When a category has a lot of services (Followers, Likes, Views,
  // Comments...), the real "Order Summary" card with the Pay Now button
  // sits at the very bottom of a long list - picking the very FIRST
  // service on the page meant scrolling past everything else just to
  // check out. This tracks whether that card is currently on-screen, so
  // a small floating bar can offer a shortcut to it (and to Pay Now)
  // from wherever the customer actually is on the page.
  const orderSummaryRef = useRef(null)
  const [summaryInView, setSummaryInView] = useState(false)

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

  useEffect(() => {
    if (!hasSelection) {
      setSummaryInView(false)
      return
    }
    const el = orderSummaryRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setSummaryInView(entry.isIntersecting), {
      rootMargin: '0px 0px -15% 0px'
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasSelection])

  function scrollToOrderSummary() {
    orderSummaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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

  // Runs every validation check, and if everything looks good, opens the
  // "Confirm Your Order" popup instead of charging the wallet right away -
  // the actual charge only happens once the customer taps "Yes, Place
  // Order" in that popup (see handleConfirmPay below).
  function handlePayNow() {
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
      scrollToOrderSummary()
      return
    }
    if (wallet && payableTotal > wallet.available_fund) {
      setSubmitError(
        `Insufficient wallet balance. Please add ${formatCurrency(payableTotal - wallet.available_fund)} or more to continue.`
      )
      scrollToOrderSummary()
      return
    }

    setConfirmOpen(true)
  }

  async function handleConfirmPay() {
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
        setConfirmOpen(false)
        return
      }

      setConfirmOpen(false)
      await refreshWallet()
      setIdempotencyKey(crypto.randomUUID())
      navigate('/order-success', { state: data })
    } catch (e) {
      setSubmitError(e.message || 'Something went wrong. Please try again.')
      setSubmitting(false)
      setConfirmOpen(false)
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
                    onToggle={() =>
                      updateSelection(s.id, {
                        selected: !state.selected,
                        // Fixed-price services (e.g. a Watch Time package)
                        // have no quantity input, so lock it to 1 the
                        // moment the card is selected.
                        quantity: s.is_fixed_price ? 1 : state.quantity
                      })
                    }
                    onQuantityChange={(v) => updateSelection(s.id, { quantity: v })}
                    onLinkChange={(v) => updateSelection(s.id, { targetLink: v })}
                  />
                </div>
              )
            })
          })()}

          {hasSelection && (
            <div className="surface-card" style={{ marginTop: 6 }} ref={orderSummaryRef}>
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
                    <span className="text-faint">
                      {item.service.is_fixed_price ? 'Fixed package price' : `${item.quantity || 0} units × ${formatRate(item.rate)} / 1000`}
                    </span>
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

      {/* Floating shortcut to checkout - shows once something's selected,
          and hides itself the moment the real Order Summary card (with
          the actual Pay Now button, coupon field, etc.) scrolls into
          view, so it never sits on top of it. Fixes having to scroll
          past every other service group just to pay for the first one
          you picked. */}
      {hasSelection && !confirmOpen && !summaryInView && (
        <div className="sticky-pay-bar">
          <div style={{ minWidth: 0 }}>
            <div className="text-faint" style={{ fontSize: 10.5 }}>
              {lineItems.length} service{lineItems.length > 1 ? 's' : ''} selected
            </div>
            <div className="text-gold" style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.3 }}>
              {formatCurrency(payableTotal)}
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ width: 'auto', flexShrink: 0, padding: '11px 18px' }}
            onClick={handlePayNow}
            disabled={submitting}
          >
            <ShieldCheck size={15} /> Pay Now
          </button>
        </div>
      )}

      {confirmOpen && (
        <Modal title="Confirm Your Order" onClose={() => (submitting ? null : setConfirmOpen(false))}>
          <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
            <strong className="text-gold">{formatCurrency(payableTotal)}</strong> will be deducted from your wallet right now
            for {lineItems.length} service{lineItems.length > 1 ? 's' : ''}. This cannot be undone once placed.
          </p>

          <div className="surface-card" style={{ marginBottom: 10 }}>
            {/* Scrolls on its own once there are a lot of line items, so a big
                order can never be what pushes the buttons below the fold. */}
            <div style={{ maxHeight: 130, overflowY: 'auto' }}>
              {lineItems.map((item) => (
                <div key={item.service.id} className="row-between" style={{ fontSize: 12, marginBottom: 6, alignItems: 'flex-start' }}>
                  <span className="text-faint">
                    {item.service.name}
                    {!item.service.is_fixed_price && ` × ${item.quantity || 0}`}
                  </span>
                  <span style={{ flexShrink: 0 }}>{formatCurrency(item.total)}</span>
                </div>
              ))}
            </div>
            <div className="divider" />

            {/* The coupon field lives here too (not just further down in
                the Order Summary card) - the floating "Pay Now" shortcut
                can bring someone straight to this popup without them
                ever scrolling past that card, and they should still get
                the chance to use a coupon before paying. */}
            {appliedCoupon ? (
              <div
                className="row-between"
                style={{ fontSize: 12, background: 'rgba(46,204,113,0.08)', border: '1px solid rgba(46,204,113,0.25)', borderRadius: 10, padding: '7px 10px', marginBottom: 8 }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Tag size={12} className="text-success" />
                  <span className="text-success" style={{ fontWeight: 700 }}>{appliedCoupon.code}</span> applied
                </span>
                <button type="button" className="icon-btn" style={{ width: 22, height: 22 }} onClick={handleRemoveCoupon} aria-label="Remove coupon">
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="Have a coupon code?"
                  style={{ flex: 1, textTransform: 'uppercase', fontSize: 12.5, padding: '9px 12px' }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ width: 'auto', flexShrink: 0, padding: '9px 14px', fontSize: 12.5 }}
                  onClick={handleApplyCoupon}
                  disabled={couponChecking}
                >
                  {couponChecking ? 'Checking…' : 'Apply'}
                </button>
              </div>
            )}
            {couponError && <div className="field-error" style={{ fontSize: 11.5, marginBottom: 8 }}>{couponError}</div>}

            {appliedCoupon && (
              <div className="row-between" style={{ fontSize: 12.5, marginBottom: 4 }}>
                <span className="text-faint">Grand Total</span>
                <span className="text-faint" style={{ textDecoration: 'line-through' }}>{formatCurrency(grandTotal)}</span>
              </div>
            )}
            {appliedCoupon && (
              <div className="row-between" style={{ fontSize: 12.5, marginBottom: 4 }}>
                <span className="text-faint">Coupon Discount</span>
                <span className="text-success" style={{ fontWeight: 700 }}>- {formatCurrency(appliedCoupon.discount_amount)}</span>
              </div>
            )}
            <div className="row-between" style={{ fontWeight: 800, fontSize: 14 }}>
              <span>Total Payable</span>
              <span className="text-gold">{formatCurrency(payableTotal)}</span>
            </div>
          </div>

          {wallet && (
            <p className="text-faint" style={{ fontSize: 11, marginBottom: 10 }}>
              Wallet balance after this order: {formatCurrency(wallet.available_fund - payableTotal)}
            </p>
          )}

          {submitError && <div className="field-error" style={{ marginBottom: 10 }}>{submitError}</div>}

          {/* Sticky to the bottom edge of the popup itself (not the page) so
              on a small phone screen, with a tall order summary above, these
              two buttons are always visible and tappable without needing to
              scroll past them - they never get pushed off-screen. */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              position: 'sticky',
              bottom: -18,
              margin: '0 -16px -18px',
              padding: '12px 16px calc(env(safe-area-inset-bottom, 0px) + 12px)',
              background: 'var(--bg-elevated)',
              borderTop: '1px solid var(--border-soft)'
            }}
          >
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmPay} disabled={submitting}>
              <ShieldCheck size={16} /> {submitting ? 'Processing…' : 'Yes, Place Order'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
