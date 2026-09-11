import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

// Rendered with a PORTAL straight onto <body>, deliberately outside the
// normal page tree. Reason: the page content lives inside .app-content,
// which has its own position:relative + z-index:1 (needed to sit above
// the animated background) - and in CSS, once an ancestor creates its
// own "stacking context" like that, nothing inside it can ever visually
// out-rank a completely separate element elsewhere on the page no
// matter how high its own z-index is set. BottomNav is exactly that kind
// of separate element (z-index: 30, sibling of .app-content, not inside
// it) - so every modal opened from a page was quietly being painted
// UNDERNEATH the bottom nav bar close to the screen edge, which is why
// the Confirm Order popup's buttons kept looking cut off / hard to tap
// near the bottom on phones no matter how the CSS around them was
// tweaked. Portaling to <body> sidesteps the whole problem: the modal is
// no longer inside .app-content's stacking context, so its z-index
// (see .modal-backdrop in index.css) is compared directly against
// BottomNav's and always wins, on every page and every device.
export default function Modal({ title, onClose, children }) {
  return createPortal(
    <div className="modal-backdrop modal-backdrop--dialog" onClick={onClose}>
      <div className="modal-sheet modal-sheet--dialog" onClick={(e) => e.stopPropagation()}>
        <div className="row-between" style={{ marginBottom: 14 }}>
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}
