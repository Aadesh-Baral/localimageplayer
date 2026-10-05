import { useEffect, useRef, useState } from 'react'

/**
 * Floating action bar shown whenever at least one photo is selected.
 * `extraActions` lets the Collections tab add "Remove from group".
 */
export default function SelectionBar({
  count,
  total,
  flatGroups,
  onAddToGroup,
  onCreateGroupWith,
  onPlay,
  onDownload,
  onSelectAll,
  onClear,
  busy,
  extraActions = null,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  if (!count) return null

  return (
    <div className="selbar">
      <span className="selbar-count">
        {count} of {total} selected
      </span>

      <div className="selbar-actions">
        <div className="menu-wrap" ref={menuRef}>
          <button
            className="btn"
            onClick={() => setMenuOpen((o) => !o)}
            disabled={busy}
          >
            Add to group ▾
          </button>
          {menuOpen && (
            <div className="menu">
              <button
                className="menu-item new"
                onClick={() => {
                  setMenuOpen(false)
                  onCreateGroupWith()
                }}
              >
                + New group from selection…
              </button>
              {flatGroups.length > 0 && <div className="menu-sep" />}
              {flatGroups.length === 0 ? (
                <div className="menu-empty">No groups yet</div>
              ) : (
                flatGroups.map((g) => (
                  <button
                    key={g.id}
                    className="menu-item"
                    style={{ paddingLeft: 12 + g.depth * 14 }}
                    onClick={() => {
                      setMenuOpen(false)
                      onAddToGroup(g.id)
                    }}
                  >
                    {g.depth > 0 && <span className="menu-rail">└</span>}
                    {g.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {extraActions}

        <button className="btn" onClick={onPlay} disabled={busy}>
          Play selection
        </button>
        <button className="btn" onClick={onDownload} disabled={busy}>
          {busy ? 'Preparing…' : 'Download ZIP'}
        </button>
        <button className="btn ghost" onClick={onSelectAll} disabled={busy}>
          Select all
        </button>
        <button className="btn ghost" onClick={onClear} disabled={busy}>
          Clear
        </button>
      </div>
    </div>
  )
}
