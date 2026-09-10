import { Instagram, ArrowUpRight } from 'lucide-react'

// Compact outbound link card pointing customers to the real Instagram
// account. Sized to match the promo/offer banners on Home - a single
// row, not a big spacious block.
export default function FollowInstagramCard() {
  return (
    <a href="https://www.instagram.com/bhd_films/" target="_blank" rel="noopener noreferrer" className="follow-ig-card">
      <span className="follow-ig-icon">
        <Instagram size={19} />
      </span>
      <span className="follow-ig-text">
        <span className="follow-ig-title">Follow Us on Instagram</span>
        <span className="follow-ig-desc">Check upcoming updates, offers &amp; latest services.</span>
      </span>
      <span className="follow-ig-btn">
        View <ArrowUpRight size={12} />
      </span>
    </a>
  )
}
