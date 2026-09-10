import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Sparkles, LayoutGrid, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import CategoryCard from '../../components/services/CategoryCard'
import OfferCarousel from '../../components/common/OfferCarousel'
import CouponUnbox from '../../components/common/CouponUnbox'
import FollowInstagramCard from '../../components/common/FollowInstagramCard'
import StatsSection from '../../components/common/StatsSection'
import Loader from '../../components/common/Loader'
import EmptyState from '../../components/common/EmptyState'
import { getIcon } from '../../utils/iconMap'
import { formatRate } from '../../utils/format'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return { text: 'Good Morning', emoji: '👋' }
  if (hour < 17) return { text: 'Good Afternoon', emoji: '👋' }
  return { text: 'Good Evening', emoji: '🌙' }
}

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState([])
  const [services, setServices] = useState([])
  const [tiers, setTiers] = useState([])
  const [offers, setOffers] = useState([])
  const [coupons, setCoupons] = useState([])
  const [popular, setPopular] = useState([])
  const [query, setQuery] = useState('')
  const greeting = useMemo(() => getGreeting(), [])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      const [catRes, svcRes, offerRes, couponRes] = await Promise.all([
        supabase.from('categories').select('*').eq('is_active', true).order('display_order'),
        supabase.from('services').select('*').eq('is_active', true),
        supabase.from('offers').select('*').eq('is_active', true).order('display_order').limit(5),
        supabase.from('coupons').select('*').eq('is_active', true).order('display_order').limit(5)
      ])
      const cats = catRes.data || []
      const svcs = svcRes.data || []
      let tierRows = []
      if (svcs.length > 0) {
        const { data } = await supabase
          .from('service_price_tiers')
          .select('*')
          .eq('is_active', true)
          .in('service_id', svcs.map((s) => s.id))
        tierRows = data || []
      }
      if (!mounted) return
      setCategories(cats)
      setServices(svcs)
      setTiers(tierRows)
      setOffers(offerRes.data || [])
      setCoupons(couponRes.data || [])
      setPopular(
        svcs
          .filter((s) => s.is_popular)
          .sort((a, b) => a.display_order - b.display_order)
          .slice(0, 4)
      )
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const categoryById = useMemo(() => {
    const map = {}
    for (const c of categories) map[c.id] = c
    return map
  }, [categories])

  const fromPriceByCategory = useMemo(() => {
    const map = {}
    for (const cat of categories) {
      const catServices = services.filter((s) => s.category_id === cat.id)
      let lowest = null
      for (const s of catServices) {
        const svcTiers = tiers.filter((t) => t.service_id === s.id)
        const rates = [Number(s.base_rate), ...svcTiers.map((t) => Number(t.rate))]
        const min = Math.min(...rates)
        if (lowest === null || min < lowest) lowest = min
      }
      map[cat.id] = lowest
    }
    return map
  }, [categories, services, tiers])

  const fromPriceByService = useMemo(() => {
    const map = {}
    for (const s of services) {
      const svcTiers = tiers.filter((t) => t.service_id === s.id)
      const rates = [Number(s.base_rate), ...svcTiers.map((t) => Number(t.rate))]
      map[s.id] = Math.min(...rates)
    }
    return map
  }, [services, tiers])

  // Search filters categories dynamically: a category matches if its own
  // name matches, or if any of its (Supabase-loaded) services matches.
  const visibleCategories = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return categories
    return categories.filter((cat) => {
      if (cat.name.toLowerCase().includes(q)) return true
      return services.some((s) => s.category_id === cat.id && s.name.toLowerCase().includes(q))
    })
  }, [categories, services, query])

  function goToPopular(service) {
    const cat = categoryById[service.category_id]
    if (!cat) return
    navigate(`/services/${cat.slug}`, { state: { preselectServiceId: service.id } })
  }

  if (loading) return <Loader />

  return (
    <div className="page-pad">
      <p className="home-greeting">
        {greeting.text} <span>{greeting.emoji}</span>
      </p>
      <h1 className="home-headline">
        Let's Go Viral! <span aria-hidden="true">🚀</span>
      </h1>

      <div className="search-bar-wrap">
        <Search size={16} className="search-icon-left" />
        <input placeholder="Search services..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="section-title">
        <span>Explore Services</span>
        {categories.length > 0 && (
          <button className="link-more" style={{ background: 'none', border: 'none' }} onClick={() => navigate('/services')}>
            View All
          </button>
        )}
      </div>

      {visibleCategories.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={query ? 'No matches found' : 'No categories yet'}
          subtitle={query ? 'Try a different search term.' : "The admin hasn't added any services yet. Check back soon!"}
        />
      ) : (
        <div className="category-grid">
          {visibleCategories.map((cat) => (
            <CategoryCard key={cat.id} category={cat} fromPrice={fromPriceByCategory[cat.id]} />
          ))}
        </div>
      )}

      {offers.length > 0 && (
        <div style={{ margin: '20px 0' }}>
          <OfferCarousel offers={offers} />
        </div>
      )}

      {coupons.length > 0 && (
        <div style={{ margin: '20px 0' }}>
          <CouponUnbox coupons={coupons} />
        </div>
      )}

      {popular.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: offers.length > 0 || coupons.length > 0 ? 0 : 20 }}>
            <span>
              <Sparkles size={14} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--gold-soft)' }} />
              Popular Services
            </span>
          </div>
          <div className="popular-grid">
            {popular.map((s) => {
              const Icon = getIcon(categoryById[s.category_id]?.icon)
              return (
                <div key={s.id} className="popular-card">
                  <button
                    type="button"
                    className="popular-add-btn"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      goToPopular(s)
                    }}
                    aria-label={`Add ${s.name}`}
                  >
                    <Plus size={16} />
                  </button>
                  <span className="popular-icon-wrap">
                    <Icon size={16} />
                  </span>
                  <span className="popular-name">{s.name}</span>
                  <span className="popular-desc">{s.description || categoryById[s.category_id]?.name}</span>
                  <span className="category-price">From {formatRate(fromPriceByService[s.id])}</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div style={{ margin: '20px 0' }}>
        <FollowInstagramCard />
      </div>

      <StatsSection />
    </div>
  )
}
