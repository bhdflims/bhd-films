import { getIcon } from '../../utils/iconMap'
import { formatCurrency, formatRate } from '../../utils/format'
import { platformLabel, targetLinkErrorMessage } from '../../utils/validators'

// One card per selected/available service inside the category order screen.
// Fully controlled - parent (CategoryOrder page) owns the state.
export default function ServiceCalculatorCard({
  service,
  selected,
  quantity,
  targetLink,
  rate,
  total,
  quantityError,
  linkError,
  onToggle,
  onQuantityChange,
  onLinkChange
}) {
  const Icon = getIcon(service.category_icon)

  return (
    <div className="surface-card" style={{ marginBottom: 10 }}>
      <label className="row-between" style={{ cursor: 'pointer' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'var(--surface-strong)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <Icon size={16} />
          </span>
          <span>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{service.name}</div>
            <div className="text-faint" style={{ fontSize: 11 }}>
              {service.external_service_id != null && (
                <>
                  <span style={{ color: 'var(--gold-soft)', fontWeight: 700 }}>ID: {service.external_service_id}</span> ·{' '}
                </>
              )}
              {service.is_fixed_price ? 'Fixed package' : `${service.min_quantity}–${service.max_quantity}`} · {service.estimated_time_text}
            </div>
            <div className="text-faint" style={{ fontSize: 11, marginTop: 2 }}>
              {service.is_fixed_price ? `${formatCurrency(service.base_rate)} flat price` : `${formatRate(service.base_rate)} per 1000`}
            </div>
          </span>
        </span>
        <input type="checkbox" checked={selected} onChange={onToggle} style={{ width: 20, height: 20 }} />
      </label>

      {selected && (
        <div style={{ marginTop: 12 }}>
          {service.is_fixed_price ? (
            <p className="text-faint" style={{ fontSize: 12, margin: 0 }}>
              This is a one-time fixed package — no quantity to enter.
            </p>
          ) : (
            <>
              <span className="field-label">Quantity</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder={`e.g. ${service.min_quantity}`}
                value={quantity}
                onChange={(e) => onQuantityChange(e.target.value)}
              />
              {quantityError && <div className="field-error">{quantityError}</div>}
            </>
          )}

          {service.requires_target_link && (
            <div style={{ marginTop: 10 }}>
              <span className="field-label">Enter {platformLabel(service.target_platform)} Link</span>
              <input
                type="url"
                placeholder={`https://...`}
                value={targetLink}
                onChange={(e) => onLinkChange(e.target.value)}
              />
              {linkError && <div className="field-error">{linkError || targetLinkErrorMessage(service.target_platform)}</div>}
            </div>
          )}

          <div className="divider" />
          <div className="row-between" style={{ fontSize: 12.5 }}>
            <span className="text-dim">
              {service.is_fixed_price ? 'Package price' : `${quantity || 0} units × ${formatRate(rate)} / 1000`}
            </span>
            <span style={{ fontWeight: 800, color: 'var(--gold-soft)' }}>{formatCurrency(total)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
