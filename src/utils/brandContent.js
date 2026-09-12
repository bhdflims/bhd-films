// Single source of truth for the app's built-in About Us / Terms &
// Conditions text - used by BOTH the customer-facing pages (About.jsx,
// Terms.jsx), so they know what to show when the admin hasn't customized
// anything yet, AND by the admin's Brand Details page, which now PRE-FILLS
// its edit boxes with this exact text (instead of leaving them empty) so
// the admin only ever has to tweak a word/spelling rather than type
// everything out from scratch.

export const DEFAULT_ABOUT =
  'BHD Films helps creators and businesses grow their presence across social platforms with transparent, rate-controlled services. Every price you see is set live by our team and every order you place uses the exact rate shown at checkout, permanently recorded on your order history.'

// Each term is [English, Hindi]. Hindi is optional per term - a term with
// no Hindi line just won't show a second line on the Terms page.
export const DEFAULT_TERMS = [
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

// --- Terms <-> plain-text box conversion -----------------------------
// Box format: one term per "block". Each block is the English line, then
// (optionally) the Hindi line right below it, with a BLANK line between
// terms - so both languages are edited together and it's obvious which
// Hindi line belongs to which English line. Example:
//
//   Small-Scale Platform: BHD Films is a small-scale SMM & entertainment platform.
//   BHD Films एक छोटा SMM और entertainment platform है।
//
//   Purpose: Our services are provided for promotional and entertainment purposes only.
//   हमारी सेवाएँ केवल promotion और entertainment purposes के लिए हैं।

export function termsToBoxText(terms) {
  return terms.map((t) => (t.hi ? `${t.en}\n${t.hi}` : t.en)).join('\n\n')
}

// Returns null (meaning "use the built-in default") when the box is
// empty, otherwise an array of { en, hi } parsed from the box text.
export function boxTextToTerms(text) {
  if (!text || !text.trim()) return null
  const blocks = text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0)
  if (blocks.length === 0) return null
  return blocks.map((lines) => ({ en: lines[0], hi: lines[1] || null }))
}
