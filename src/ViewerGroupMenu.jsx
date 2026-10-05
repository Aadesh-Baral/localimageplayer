import { useEffect, useRef, useState } from 'react'

/**
 * "Add to group" picker for the photo currently open in the viewer.
 * Each group row toggles membership, so a mis-click is one click to undo.
 * New groups are named inline (no window.prompt, which would drop fullscreen).
 */
export default function ViewerGroupMenu({
  photoId,
  groupsApi,
  open,
  onOpenChange,
  onNotify,
}) {
  const { groups, flat, addPhotos, removePhotos, createGroup } = groupsApi
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const wrapRef = useRef(null)

  const memberOf = flat.filter((g) => groups[g.id]?.photoIds.includes(photoId))

  useEffect(() => {
    if (!open) {
      setNaming(false)
      setName('')
      return
    }
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) onOpenChange(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onOpenChange])

  const toggle = (g) => {
    const inGroup = groups[g.id]?.photoIds.includes(photoId)
    if (inGroup) {
      removePhotos(g.id, [photoId])
      onNotify(`Removed from “${g.name}”`)
    } else {
      addPhotos(g.id, [photoId])
      onNotify(`Added to “${g.name}”`)
    }
  }

  const createWith = () => {
    const clean = name.trim()
    if (!clean) return
    const id = createGroup(clean, null)
    addPhotos(id, [photoId])
    onNotify(`Added to new group “${clean}”`)
    setNaming(false)
    setName('')
  }

  return (
    <div
      className="menu-wrap"
      ref={wrapRef}
      // Keep viewer shortcuts (arrows, space, F…) from firing while typing.
      onKeyDown={(e) => naming && e.stopPropagation()}
    >
      <button
        className={`chip ${memberOf.length ? 'toggle on' : ''}`}
        onClick={() => onOpenChange(!open)}
        title="Add this photo to a group (G)"
      >
        {memberOf.length
          ? `In ${memberOf.length} group${memberOf.length === 1 ? '' : 's'} ▾`
          : 'Add to group ▾'}
      </button>

      {open && (
        <div className="menu menu-down viewer-menu">
          {naming ? (
            <form
              className="menu-new-form"
              onSubmit={(e) => {
                e.preventDefault()
                createWith()
              }}
            >
              <input
                autoFocus
                value={name}
                placeholder="New group name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    setNaming(false)
                  }
                }}
              />
              <button className="btn small" type="submit" disabled={!name.trim()}>
                Add
              </button>
            </form>
          ) : (
            <button className="menu-item new" onClick={() => setNaming(true)}>
              + New group…
            </button>
          )}

          {flat.length > 0 && <div className="menu-sep" />}
          {flat.length === 0 ? (
            <div className="menu-empty">No groups yet</div>
          ) : (
            flat.map((g) => {
              const inGroup = groups[g.id]?.photoIds.includes(photoId)
              return (
                <button
                  key={g.id}
                  className={`menu-item ${inGroup ? 'checked' : ''}`}
                  style={{ paddingLeft: 12 + g.depth * 14 }}
                  onClick={() => toggle(g)}
                  title={inGroup ? 'Click to remove from this group' : 'Click to add'}
                >
                  <span className="menu-check">{inGroup ? '✓' : ''}</span>
                  {g.depth > 0 && <span className="menu-rail">└</span>}
                  {g.name}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
