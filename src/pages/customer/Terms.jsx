import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// The app's original built-in terms — used whenever the admin hasn't
// filled in custom terms on the Brand Details page yet, so this page
// never goes blank. Each entry is [English, Hindi] the way the page has
// always shown them; a custom value entered on Brand Details is plain
// English-only text (one line per term) instead — see below.
const DEFAULT_TERMS = [
  ['Small-Scale Platform: BHD Films is a small-scale SMM & entertainment platform.', 'BHD Films एक छोटा SMM और entertainment platform है।'],
  ['Purpose: Our services are provided for promotional and entertainment purposes only.', 'हमारी सेवाएँ केवल promotion और entertainment purposes के लिए हैं।'],
  [
    'Third-Party Services: Services are sourced through third-party SMM providers and are not officially authorized by Meta, Instagram, Facebook, TikTok, YouTube, or other social media platforms.',
    'सेवाएँ third-party SMM providers के माध्यम से दी जाती हैं और Meta, Instagram, Facebook, TikTok, YouTube या अन्य social media platforms द्वारा officially authorized नहीं हैं।'
  ],
  ['Privacy: BHD Films never asks for your password, OTP, login details, or sensitive account information.', 'BHD Films कभी भी आपका password, OTP, login details या sensitive account information नहीं मांगता।'],
  ['Link-Based Service: Orders are processed only through the social media link provided by the customer.', 'ऑर्डर केवल customer द्वारा दिए गए social media link के माध्यम से process किया जाता है।'],
  ['Success Rate: 100% success is not guaranteed. Our services have an expected success/delivery rate of up to 95%.', '100% success की guarantee नहीं है। हमारी services की expected success/delivery rate 95% तक हो सकती है।'],
  ['No Refund: Once an order is placed or started, no refund or cancellation is available.', 'Order place या start होने के बाद कोई refund या cancellation उपलब्ध नहीं है।'],
  ['Delivery: Delivery time and results may vary due to platform updates, restrictions, removals, or technical issues.', 'Platform updates, restrictions, removals या technical issues के कारण delivery time और results बदल सकते हैं।'],
  ['Customer Responsibility: Customers must provide the correct and accessible social media link.', 'Customer की जिम्मेदारी है कि वह सही और accessible social media link प्रदान करे।'],
  [
    'Order Delivery: BHD Films makes every effort to successfully deliver valid orders, but permanent retention is not guaranteed unless specifically mentioned.',
    'BHD Films हर valid order को successfully deliver करने का पूरा प्रयास करता है, लेकिन जब तक विशेष रूप से mention न किया गया हो, permanent retention की guarantee नहीं है।'
  ],
  ['Acceptance: By placing an order, you agree to these Terms & Conditions.', 'Order place करने का मतलब है कि आप इन Terms & Conditions से सहमत हैं।']
].map(([en, hi]) => ({ en, hi }))

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

  const custom = brand?.terms_content?.trim()
  // A custom entry is plain text, one term per non-blank line - no Hindi
  // translation since the admin types it in free-form on Brand Details.
  const TERMS = custom
    ? custom
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((en) => ({ en, hi: null }))
    : DEFAULT_TERMS

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
