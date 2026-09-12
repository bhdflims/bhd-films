import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DEFAULT_TERMS, boxTextToTerms } from '../../utils/brandContent'

export default function Terms() {
  const [brand, setBrand] = useState(null)

  useEffect(() => {
    supabase
      .from('brand_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle()
      .then(({ data }) => setBrand(data))
  }, [])

  const TERMS = boxTextToTerms(brand?.terms_content) || DEFAULT_TERMS

  return (
    <div className="page-pad">
      <div style={{ textAlign: 'center', margin: '20px 0 24px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 12px',
            borderRadius: 16,
            background: 'linear-gradient(135deg,var(--gold),var(--crimson))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <ScrollText size={26} color="#170f08" />
        </div>
        <h1 style={{ fontSize: 19, margin: '0 0 4px' }}>Terms &amp; Conditions</h1>
        <p className="text-faint" style={{ fontSize: 12 }}>नियम एवं शर्तें</p>
      </div>

      <div className="surface-card" style={{ padding: 4 }}>
        {TERMS.map((t, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: 10,
              padding: '12px 10px',
              borderBottom: i < TERMS.length - 1 ? '1px solid var(--border)' : 'none'
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: 7,
                background: 'var(--surface-strong)',
                color: 'var(--gold-soft)',
                fontSize: 11,
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="text-dim" style={{ fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>
                {t.en}
              </p>
              {t.hi && (
                <p className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '4px 0 0' }}>
                  {t.hi}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-faint" style={{ fontSize: 11, textAlign: 'center', margin: '16px 0 0' }}>
        Questions about these terms? Reach out from the Support section in your Profile.
      </p>
    </div>
  )
}
