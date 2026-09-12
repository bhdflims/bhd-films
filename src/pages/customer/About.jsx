import { useEffect, useState } from 'react'
import { Clapperboard, Mail, Phone } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { DEFAULT_ABOUT } from '../../utils/brandContent'

export default function About() {
  const [brand, setBrand] = useState(null)

  useEffect(() => {
    supabase
      .from('brand_settings')
      .select('*')
      .eq('id', true)
      .maybeSingle()
      .then(({ data }) => setBrand(data))
  }, [])

  const nameFirst = brand?.brand_name_primary?.trim() || 'BHD'
  const nameAccent = brand?.brand_name_accent?.trim() || 'Films'
  const aboutText = brand?.about_content?.trim() || DEFAULT_ABOUT
  const paragraphs = aboutText.split(/\n\s*\n/).filter((p) => p.trim())

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
          <Clapperboard size={26} color="#170f08" />
        </div>
        <h1 style={{ fontSize: 19, margin: '0 0 4px' }}>
          {nameFirst} {nameAccent}
        </h1>
        <p className="text-faint" style={{ fontSize: 12 }}>Premium Social Media Growth Services</p>
      </div>

      <div className="surface-card" style={{ marginBottom: 12 }}>
        {paragraphs.map((p, i) => (
          <p
            key={i}
            className="text-dim"
            style={{ fontSize: 13, lineHeight: 1.6, margin: i < paragraphs.length - 1 ? '0 0 10px' : 0 }}
          >
            {p}
          </p>
        ))}
      </div>

      {(brand?.support_email || brand?.support_phone) && (
        <div className="surface-card" style={{ marginBottom: 12 }}>
          <p className="text-faint" style={{ fontSize: 11, margin: '0 0 8px', fontWeight: 700 }}>Contact Us</p>
          {brand?.support_email && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: brand?.support_phone ? 6 : 0 }}>
              <Mail size={14} className="text-faint" />
              <a href={`mailto:${brand.support_email}`} className="text-dim" style={{ fontSize: 12.5, textDecoration: 'none' }}>
                {brand.support_email}
              </a>
            </div>
          )}
          {brand?.support_phone && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Phone size={14} className="text-faint" />
              <span className="text-dim" style={{ fontSize: 12.5 }}>{brand.support_phone}</span>
            </div>
          )}
        </div>
      )}

      <div className="surface-card">
        <p className="text-dim" style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
          Need help? Reach out any time from the Support section in your Profile.
        </p>
      </div>
    </div>
  )
}
