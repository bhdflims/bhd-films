import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import { formatDate } from '../../utils/format'

// The app's original, built-in text — used only to SHOW an admin what
// customers currently see when a field below is left blank. The actual
// fallback logic lives in the customer-facing pages themselves
// (About.jsx, Terms.jsx, Home.jsx, TopHeader.jsx) so this page never has
// to duplicate/own that text, it's just shown here for reference.
const DEFAULT_ABOUT =
  "BHD Films helps creators and businesses grow their presence across social platforms with transparent, rate-controlled services. Every price you see is set live by our team and every order you place uses the exact rate shown at checkout, permanently recorded on your order history.\n\nNeed help? Reach out any time from the Support section in your Profile."
const DEFAULT_TERMS = [
  'Small-Scale Platform: BHD Films is a small-scale SMM & entertainment platform.',
  'Purpose: Our services are provided for promotional and entertainment purposes only.',
  'Third-Party Services: Services are sourced through third-party SMM providers and are not officially authorized by Meta, Instagram, Facebook, TikTok, YouTube, or other social media platforms.',
  'Privacy: BHD Films never asks for your password, OTP, login details, or sensitive account information.',
  'Link-Based Service: Orders are processed only through the social media link provided by the customer.',
  'Success Rate: 100% success is not guaranteed. Our services have an expected success/delivery rate of up to 95%.',
  'No Refund: Once an order is placed or started, no refund or cancellation is available.',
  'Delivery: Delivery time and results may vary due to platform updates, restrictions, removals, or technical issues.',
  'Customer Responsibility: Customers must provide the correct and accessible social media link.',
  'Order Delivery: BHD Films makes every effort to successfully deliver valid orders, but permanent retention is not guaranteed unless specifically mentioned.',
  'Acceptance: By placing an order, you agree to these Terms & Conditions.'
].join('\n')

export default function BrandDetails() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('brand_settings').select('*').eq('id', true).maybeSingle()
    setSettings(data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase
      .from('brand_settings')
      .update({
        brand_name_primary: settings.brand_name_primary,
        brand_name_accent: settings.brand_name_accent,
        home_tagline: settings.home_tagline,
        support_email: settings.support_email,
        support_phone: settings.support_phone,
        about_content: settings.about_content,
        terms_content: settings.terms_content,
        updated_by: user.id
      })
      .eq('id', true)
    setSaving(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage('Saved — customers will see this the next time they open the page.')
    load()
  }

  if (loading || !settings) return <Loader />

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 19, margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Sparkles size={19} /> Brand Details
      </h1>
      <p className="text-faint" style={{ fontSize: 12, marginTop: 0, marginBottom: 18 }}>
        Change the text customers see on About Us, Terms &amp; Conditions, the home page, and the app header —
        without asking anyone to edit code. Leave any box empty to keep the app's original built-in text; it
        won't show blank.
      </p>

      {/* ---------------- Header ---------------- */}
      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>App Header</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 12px' }}>
          Shown at the top of every customer page. Two parts so the second word can stay gold-colored, same as
          today. Leave both blank to keep "BHD FILMS".
        </p>
        <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120 }}>
            <span className="field-label">First word</span>
            <input
              placeholder="BHD"
              value={settings.brand_name_primary || ''}
              onChange={(e) => setSettings({ ...settings, brand_name_primary: e.target.value })}
            />
          </div>
          <div style={{ flex: 1, minWidth: 120 }}>
            <span className="field-label">Second word (gold)</span>
            <input
              placeholder="FILMS"
              value={settings.brand_name_accent || ''}
              onChange={(e) => setSettings({ ...settings, brand_name_accent: e.target.value })}
            />
          </div>
        </div>
        <p className="text-faint" style={{ fontSize: 11.5, margin: 0 }}>
          Preview: <strong>{settings.brand_name_primary || 'BHD'}</strong>{' '}
          <strong className="text-gold">{settings.brand_name_accent || 'FILMS'}</strong>
        </p>
      </div>

      {/* ---------------- Home tagline ---------------- */}
      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>Home Page Tagline</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          The bold line under "Good Morning" on the home page. Leave blank to keep "Let's Go Viral! 🚀".
        </p>
        <input
          placeholder="Let's Go Viral!"
          value={settings.home_tagline || ''}
          onChange={(e) => setSettings({ ...settings, home_tagline: e.target.value })}
        />
      </div>

      {/* ---------------- Support contact ---------------- */}
      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>Support Contact</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          Shown to customers on the About Us page so they know how to reach you directly. Leave blank to show
          neither — customers can still always use the in-app Support ticket system either way.
        </p>
        <div style={{ marginBottom: 10 }}>
          <span className="field-label">Support Email (optional)</span>
          <input
            type="email"
            placeholder="support@bhdfilms.in"
            value={settings.support_email || ''}
            onChange={(e) => setSettings({ ...settings, support_email: e.target.value })}
          />
        </div>
        <div>
          <span className="field-label">Support Phone / WhatsApp (optional)</span>
          <input
            placeholder="+91 XXXXX XXXXX"
            value={settings.support_phone || ''}
            onChange={(e) => setSettings({ ...settings, support_phone: e.target.value })}
          />
        </div>
      </div>

      {/* ---------------- About Us ---------------- */}
      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>About Us Page</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          Leave a blank line between paragraphs. Leave this whole box empty to keep the original About Us text.
        </p>
        <textarea
          rows={6}
          placeholder={DEFAULT_ABOUT}
          value={settings.about_content || ''}
          onChange={(e) => setSettings({ ...settings, about_content: e.target.value })}
        />
      </div>

      {/* ---------------- Terms & Conditions ---------------- */}
      <div className="surface-card" style={{ marginBottom: 16 }}>
        <strong style={{ fontSize: 13.5 }}>Terms &amp; Conditions</strong>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          One line = one numbered term on the Terms page. Leave this whole box empty to keep the original 11
          terms.
        </p>
        <textarea
          rows={10}
          placeholder={DEFAULT_TERMS}
          value={settings.terms_content || ''}
          onChange={(e) => setSettings({ ...settings, terms_content: e.target.value })}
        />
      </div>

      {message && <p className="text-dim" style={{ fontSize: 12.5, marginBottom: 10 }}>{message}</p>}
      <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>

      {settings.updated_at && (
        <p className="text-faint" style={{ fontSize: 11, marginTop: 14 }}>
          Last changed {formatDate(settings.updated_at)}
        </p>
      )}
    </div>
  )
}
