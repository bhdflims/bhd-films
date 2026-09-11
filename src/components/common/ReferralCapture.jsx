import { useEffect } from 'react'

// If this page was opened via a referral link (e.g. bhdflims.in/?ref=ABC123),
// remember the code in this browser until the person signs in for the
// first time - AuthContext then tries to claim it exactly once, right
// after login (see claim_referral_code in loadProfile()). Mounted once at
// the top of the app (see App.jsx), renders nothing.
export default function ReferralCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('ref')
    if (code && code.trim()) {
      try {
        localStorage.setItem('bhd_ref_code', code.trim().toUpperCase())
      } catch {
        // localStorage can be unavailable (private browsing etc.) - the
        // referral link still works fine for browsing, it just won't be
        // remembered for the claim step after login.
      }
    }
  }, [])
  return null
}
