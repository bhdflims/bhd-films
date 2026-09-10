import { useEffect, useRef, useState } from 'react'
import { ShoppingBag, Star, Users } from 'lucide-react'

// Static "social proof" numbers - these are marketing copy, not a live
// database count (a brand-new store has 0 real orders yet, which would
// undercut the message). Update the `value`s here any time the admin
// wants to change what's shown.
const STATS = [
  { icon: ShoppingBag, value: 6000, label: 'Orders Completed' },
  { icon: Star, value: 100, label: 'Famous Celebrities & Creators' },
  { icon: Users, value: 10000, label: 'Happy Customers' }
]

const DURATION_MS = 1700

function useCountUp(target, active) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!active) return undefined
    let raf
    const start = performance.now()
    function tick(now) {
      const progress = Math.min((now - start) / DURATION_MS, 1)
      const eased = 1 - Math.pow(1 - progress, 3) // ease-out cubic
      setValue(Math.round(eased * target))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, target])

  return value
}

function StatTile({ icon: Icon, value, label, active }) {
  const count = useCountUp(value, active)
  return (
    <div className="home-stat-tile">
      <span className="home-stat-icon">
        <Icon size={16} />
      </span>
      <div className="home-stat-value">{count.toLocaleString('en-IN')}+</div>
      <div className="home-stat-label">{label}</div>
    </div>
  )
}

// Self-contained "Our Statistics" section for the Home page. Numbers
// count up from 0 the first time the section scrolls into view.
export default function StatsSection() {
  const ref = useRef(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (typeof IntersectionObserver === 'undefined') {
      setActive(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setActive(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={ref} style={{ margin: '20px 0' }}>
      <div className="section-title" style={{ justifyContent: 'center', textAlign: 'center' }}>
        <span>📊 Our Statistics</span>
      </div>
      <p className="text-faint" style={{ fontSize: 11, margin: '-6px 0 10px', textAlign: 'center' }}>
        Trusted by Small Businesses &amp; Creators
      </p>
      <div className="home-stats-grid">
        {STATS.map((s) => (
          <StatTile key={s.label} icon={s.icon} value={s.value} label={s.label} active={active} />
        ))}
      </div>
    </div>
  )
}
