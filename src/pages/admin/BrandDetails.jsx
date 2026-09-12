import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Loader from '../../components/common/Loader'
import { formatDate } from '../../utils/format'
import { DEFAULT_ABOUT, DEFAULT_TERMS, termsToBoxText } from '../../utils/brandContent'

// The exact text these two boxes below pre-fill themselves with the
// moment nothing's been saved yet - same text customers see on the About
// Us / Terms pages right now. Editing a word here and hitting Save is all
// it takes; the "Reset" links next to each box clear the box back to
// this same built-in starting point if needed. (The "Need help? Reach
// out..." line on the About Us page is separate, fixed footer text, not
// part of this box - it always shows underneath, so it's not included
// here.)
const DEFAULT_ABOUT_BOX = DEFAULT_ABOUT
const DEFAULT_TERMS_BOX = termsToBoxText(DEFAULT_TERMS)

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
        without asking anyone to edit code. The About Us and Terms boxes below already show exactly what's live
        today, so you can just fix a word or spelling directly and hit Save.
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
        <div className="row-between" style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13.5 }}>About Us Page</strong>
          <button
            type="button"
            onClick={() => setSettings({ ...settings, about_content: '' })}
            className="text-faint"
            style={{ background: 'none', border: 'none', textDecoration: 'underline', fontSize: 11, cursor: 'pointer', padding: 0 }}
          >
            Reset to original text
          </button>
        </div>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          This box already shows exactly what customers see today — just fix a word or spelling and hit Save.
          Leave a blank line between paragraphs. English only (no Hindi version of this page exists).
        </p>
        <textarea
          rows={6}
          value={settings.about_content || DEFAULT_ABOUT_BOX}
          onChange={(e) => setSettings({ ...settings, about_content: e.target.value })}
        />
      </div>

      {/* ---------------- Terms & Conditions ---------------- */}
      <div className="surface-card" style={{ marginBottom: 16 }}>
        <div className="row-between" style={{ marginBottom: 6 }}>
          <strong style={{ fontSize: 13.5 }}>Terms &amp; Conditions</strong>
          <button
            type="button"
            onClick={() => setSettings({ ...settings, terms_content: '' })}
            className="text-faint"
            style={{ background: 'none', border: 'none', textDecoration: 'underline', fontSize: 11, cursor: 'pointer', padding: 0 }}
          >
            Reset to original text
          </button>
        </div>
        <p className="text-faint" style={{ fontSize: 11.5, margin: '6px 0 10px' }}>
          This box already shows all 11 terms exactly as customers see them today, English AND Hindi together —
          just fix a word or spelling and hit Save. Each term is two lines: the English line, then its Hindi
          line right below it. Leave a blank line between each term (a term with no Hindi is just one line, still
          followed by a blank line). Don't add or remove blank lines in the middle of a single term's two lines,
          or its Hindi line will be read as a new term.
        </p>
        <textarea
          rows={16}
          value={settings.terms_content || DEFAULT_TERMS_BOX}
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
