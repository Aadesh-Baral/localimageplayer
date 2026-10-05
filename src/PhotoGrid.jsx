import { memo, useRef } from 'react'
import { thumbSrc } from './media'

/**
 * One thumbnail. Memoised: it only re-renders when its own photo, selection
 * state or source label changes — not every time the page updates (autosave,
 * download progress, a folder finishing loading…). Handlers come through a
 * stable `actions` object so they never break the memo.
 */
const Thumb = memo(function Thumb({ img, index, selected, source, selectable, draggable, actions }) {
  return (
    <div
      className={`thumb-wrap ${selected ? 'selected' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        const ids = actions.drag(img.id)
        e.dataTransfer.setData('application/x-imageplayer-photos', JSON.stringify(ids))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <button
        className="thumb"
        title={source ? `${img.name}\n${source}` : img.name}
        onClick={(e) => {
          if (selectable && (e.metaKey || e.ctrlKey)) actions.toggle(img.id, { shiftKey: e.shiftKey })
          else actions.open(index)
        }}
      >
        <img
          src={thumbSrc(img, 320)}
          alt={img.name}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
        />
      </button>

      {selectable && (
        <button
          className={`tick ${selected ? 'on' : ''}`}
          aria-pressed={selected}
          aria-label={selected ? `Deselect ${img.name}` : `Select ${img.name}`}
          onClick={(e) => {
            e.stopPropagation()
            actions.toggle(img.id, { shiftKey: e.shiftKey })
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
})

/**
 * Selectable thumbnail grid.
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
  // Latest handlers, behind one object whose identity never changes.
  const latest = useRef({})
  latest.current = { onToggle, onOpen, onDragPhotos }
  const actions = useRef({
    toggle: (id, opts) => latest.current.onToggle?.(id, opts),
    open: (i) => latest.current.onOpen?.(i),
    drag: (id) => latest.current.onDragPhotos?.(id) ?? [id],
  }).current

  if (!images.length) {
    return <div className="empty">{empty}</div>
  }

  return (
    <div className="grid">
      {images.map((img, i) => (
        <Thumb
          key={img.id}
          img={img}
          index={i}
          selected={isSelected?.(img.id) ?? false}
          source={sourceOf?.get(img.id)}
          selectable={!!onToggle}
          draggable={!!onDragPhotos}
          actions={actions}
        />
      ))}
    </div>
  )
}
