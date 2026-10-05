import { thumbSrc } from './media'

/**
 * Selectable thumbnail grid.
 *
 * Interaction model:
 *  - click the image  → open it in the viewer
 *  - click the tick   → toggle selection (shift extends a range)
 *  - ⌘/ctrl-click     → toggle selection without opening
 */
export default function PhotoGrid({
  images,
  isSelected,
  onToggle,
  onOpen,
  onDragPhotos,
  sourceOf,
  empty,
}) {
  if (!images.length) {
    return <div className="empty">{empty}</div>
  }

  return (
    <div className="grid">
      {images.map((img, i) => {
        const selected = isSelected?.(img.id) ?? false
        const source = sourceOf?.get(img.id)
        return (
          <div
            key={img.id}
            className={`thumb-wrap ${selected ? 'selected' : ''}`}
            draggable={!!onDragPhotos}
            onDragStart={(e) => {
              const ids = onDragPhotos?.(img.id) ?? [img.id]
              e.dataTransfer.setData(
                'application/x-imageplayer-photos',
                JSON.stringify(ids)
              )
              e.dataTransfer.effectAllowed = 'copy'
            }}
          >
            <button
              className="thumb"
              title={source ? `${img.name}\n${source}` : img.name}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) {
                  onToggle?.(img.id, { shiftKey: e.shiftKey })
                } else {
                  onOpen?.(i)
                }
              }}
            >
              <img
                src={thumbSrc(img, 320)}
                alt={img.name}
                loading="lazy"
                referrerPolicy="no-referrer"
                draggable={false}
              />
            </button>

            {onToggle && (
              <button
                className={`tick ${selected ? 'on' : ''}`}
                aria-pressed={selected}
                aria-label={
                  selected ? `Deselect ${img.name}` : `Select ${img.name}`
                }
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(img.id, { shiftKey: e.shiftKey })
                }}
              >
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path
                    d="M5 12.5 L10 17.5 L19 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}

            {source && (
              <span className="source-badge" title={source}>
                {source}
              </span>
            )}

            <span className="thumb-name">{img.name}</span>
          </div>
        )
      })}
    </div>
  )
}
