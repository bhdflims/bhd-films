import { ScrollText } from 'lucide-react'

// Each entry: English line, then the Hindi translation shown right below it
// in a dimmer/smaller style. Content is exactly what the admin provided —
// update the TERMS array below any time the wording needs to change.
const TERMS = [
  {
    en: 'Small-Scale Platform: BHD Films is a small-scale SMM & entertainment platform.',
    hi: 'BHD Films एक छोटा SMM और entertainment platform है।'
  },
  {
    en: 'Purpose: Our services are provided for promotional and entertainment purposes only.',
    hi: 'हमारी सेवाएँ केवल promotion और entertainment purposes के लिए हैं।'
  },
  {
    en: 'Third-Party Services: Services are sourced through third-party SMM providers and are not officially authorized by Meta, Instagram, Facebook, TikTok, YouTube, or other social media platforms.',
    hi: 'सेवाएँ third-party SMM providers के माध्यम से दी जाती हैं और Meta, Instagram, Facebook, TikTok, YouTube या अन्य social media platforms द्वारा officially authorized नहीं हैं।'
  },
  {
    en: 'Privacy: BHD Films never asks for your password, OTP, login details, or sensitive account information.',
    hi: 'BHD Films कभी भी आपका password, OTP, login details या sensitive account information नहीं मांगता।'
  },
  {
    en: 'Link-Based Service: Orders are processed only through the social media link provided by the customer.',
    hi: 'ऑर्डर केवल customer द्वारा दिए गए social media link के माध्यम से process किया जाता है।'
  },
  {
    en: 'Success Rate: 100% success is not guaranteed. Our services have an expected success/delivery rate of up to 95%.',
    hi: '100% success की guarantee नहीं है। हमारी services की expected success/delivery rate 95% तक हो सकती है।'
  },
  {
    en: 'No Refund: Once an order is placed or started, no refund or cancellation is available.',
    hi: 'Order place या start होने के बाद कोई refund या cancellation उपलब्ध नहीं है।'
  },
  {
    en: 'Delivery: Delivery time and results may vary due to platform updates, restrictions, removals, or technical issues.',
    hi: 'Platform updates, restrictions, removals या technical issues के कारण delivery time और results बदल सकते हैं।'
  },
  {
    en: 'Customer Responsibility: Customers must provide the correct and accessible social media link.',
    hi: 'Customer की जिम्मेदारी है कि वह सही और accessible social media link प्रदान करे।'
  },
  {
    en: 'Order Delivery: BHD Films makes every effort to successfully deliver valid orders, but permanent retention is not guaranteed unless specifically mentioned.',
    hi: 'BHD Films हर valid order को successfully deliver करने का पूरा प्रयास करता है, लेकिन जब तक विशेष रूप से mention न किया गया हो, permanent retention की guarantee नहीं है।'
  },
  {
    en: 'Acceptance: By placing an order, you agree to these Terms & Conditions.',
    hi: 'Order place करने का मतलब है कि आप इन Terms & Conditions से सहमत हैं।'
  }
]

export default function Terms() {
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
              <p className="text-faint" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '4px 0 0' }}>
                {t.hi}
              </p>
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
