import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { getIcon } from '../../utils/iconMap'
import { formatRate } from '../../utils/format'

const GRADIENTS = [
  'linear-gradient(135deg,#d4af37,#e6c766)',
  'linear-gradient(135deg,#e63950,#ff7a8a)',
  'linear-gradient(135deg,#8b5cf6,#c4b5fd)',
  'linear-gradient(135deg,#2dd4bf,#5eead4)',
  'linear-gradient(135deg,#f97316,#fbbf24)',
  'linear-gradient(135deg,#3b82f6,#93c5fd)'
]

// Every icon gets a slightly different subtle motion so the grid doesn't
// feel robotic - float / pulse / rotate / zoom, chosen deterministically
// from the category id so it stays stable across re-renders.
const MOTION_VARIANTS = [
  { animate: { y: [0, -4, 0] }, transition: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } },
  { animate: { scale: [1, 1.08, 1] }, transition: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } },
  { animate: { rotate: [0, 6, 0, -6, 0] }, transition: { duration: 4.2, repeat: Infinity, ease: 'easeInOut' } },
  { animate: { y: [0, -2, 0], scale: [1, 1.04, 1] }, transition: { duration: 3.8, repeat: Infinity, ease: 'easeInOut' } }
]

function pickVariant(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return MOTION_VARIANTS[hash % MOTION_VARIANTS.length]
}

function pickGradient(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 17 + id.charCodeAt(i)) >>> 0
  return GRADIENTS[hash % GRADIENTS.length]
}

export default function CategoryCard({ category, fromPrice }) {
  const navigate = useNavigate()
  const Icon = getIcon(category.icon)
  const variant = pickVariant(category.id)
  const gradient = pickGradient(category.id)

  return (
    <button className="category-card" onClick={() => navigate(`/services/${category.slug}`)}>
      <motion.div
        className="category-icon-wrap"
        style={{ background: gradient }}
        animate={variant.animate}
        transition={variant.transition}
      >
        <Icon size={20} />
      </motion.div>
      <span className="category-name">{category.name}</span>
      {fromPrice != null && <span className="category-price">From {formatRate(fromPrice)}</span>}
    </button>
  )
}
