import { useMemo, useState } from 'react'
import PhotoGrid from './PhotoGrid'
import SelectionBar from './SelectionBar'
import useSelection from './useSelection'
import * as G from './groups'
import { parseKey, VENDOR_LABEL } from './project'
import ShareDialog from './ShareDialog'

/** One collection's photos (the tree itself lives in the sidebar). */
export default function Collections({
  groupId,
  projectId,
  apiKey,
  flushProject,
  byId,
  sourceOf,
  groupsApi,
  onPlay,
  onDownload,
}) {
  const { groups } = groupsApi
  const [includeSubgroups, setIncludeSubgroups] = useState(true)
  const [sharing, setSharing] = useState(false)
  const group = groupId ? groups[groupId] : null

  // Collection → vendor → link/path → photos, mirroring how it's saved.
  const blocks = useMemo(() => {
    if (!group) return []
    const map = new Map()
    for (const key of G.collectPhotoIds(groups, group.id, includeSubgroups)) {
      const k = parseKey(key)
      if (!k) continue
      const bk = JSON.stringify([k.vendor, k.ref])
      if (!map.has(bk)) map.set(bk, { vendor: k.vendor, ref: k.ref, photos: [], missing: 0 })
      const photo = byId.get(key)
      if (photo) map.get(bk).photos.push(photo)
      else map.get(bk).missing++
    }
    const order = { gdrive: 0, local: 1 }
    const list = [...map.values()].sort((a, b) => order[a.vendor] - order[b.vendor])
    let offset = 0
    for (const b of list) {
      b.offset = offset
      offset += b.photos.length
    }
    return list
  }, [groups, group, includeSubgroups, byId])

  const photos = useMemo(() => blocks.flatMap((b) => b.photos), [blocks])

  const ids = useMemo(() => photos.map((p) => p.id), [photos])
  const sel = useSelection(ids)

  const selectedPhotos = useMemo(
    () => photos.filter((p) => sel.selected.has(p.id)),
    [photos, sel.selected]
  )

  // Photos a group references that aren't in any currently-loaded folder —
  // either the file was removed from Drive, or its folder just isn't loaded
  // right now. Both are recoverable, so we count rather than prune.
  const missingCount = useMemo(
    () => blocks.reduce((n, b) => n + b.missing, 0),
    [blocks]
  )

  // How many distinct folders this group draws from.
  const sourceCount = useMemo(() => {
    if (!sourceOf) return 0
    return new Set(photos.map((p) => sourceOf.get(p.id)).filter(Boolean)).size
  }, [photos, sourceOf])

  const removeFromGroup = () => {
    if (!group) return
    const ids = selectedPhotos.map((p) => p.id)
    // When subgroups are shown, a visible photo may actually live in a child,
    // so removing only from the open group would appear to do nothing.
    const targets = includeSubgroups
      ? [group.id, ...G.descendantIds(groups, group.id)]
      : [group.id]
    targets.forEach((t) => groupsApi.removePhotos(t, ids))
    sel.clear()
  }

  const addToGroup = (groupId) => {
    groupsApi.addPhotos(
      groupId,
      selectedPhotos.map((p) => p.id)
    )
    sel.clear()
  }

  const createGroupWith = () => {
    const name = window.prompt('Name for the new group?', 'New group')
    if (!name) return
    const id = groupsApi.createGroup(name, group ? group.id : null)
    groupsApi.addPhotos(
      id,
      selectedPhotos.map((p) => p.id)
    )
    sel.clear()
  }

  return (
      <div className="tab-body">
        {!group ? (
          <div className="empty">
            This collection no longer exists. Pick another in the sidebar.
          </div>
        ) : (
          <>
            <div className="tab-head">
              <div>
                <h2>{G.pathOf(groups, group.id).join(' / ')}</h2>
                <p className="subtle">
                  {photos.length} photo{photos.length === 1 ? '' : 's'}
                  {sourceCount > 1 && ` from ${sourceCount} sources`}
                  {missingCount > 0 &&
                    ` · ${missingCount} not available right now (source not loaded or not connected)`}
                </p>
              </div>
              <div className="tab-head-actions">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={includeSubgroups}
                    onChange={(e) => setIncludeSubgroups(e.target.checked)}
                  />
                  Include sub-collections
                </label>
                <button
                  className="btn primary-btn"
                  onClick={() => onPlay(photos, 0)}
                  disabled={!photos.length}
                >
                  Play collection
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    onDownload(photos, G.pathOf(groups, group.id).join(' - '))
                  }
                  disabled={!photos.length}
                >
                  Download collection
                </button>
                <button className="btn" onClick={() => setSharing(true)} title="Share a view-only link">
                  Share…
                </button>
              </div>
            </div>


            {blocks.length === 0 ? (
              <div className="empty">
                {includeSubgroups
                  ? 'Nothing here yet. Add photos from the Library, or drag them onto this collection in the sidebar.'
                  : 'No photos directly in this collection — try including sub-collections.'}
              </div>
            ) : (
              blocks.map((b) => (
                <div className="coll-block" key={`${b.vendor}|${b.ref}`}>
                  <h4 className="coll-block-head">
                    <span className={`vendor-dot vendor-${b.vendor}`} />
                    <span className="subtle">{VENDOR_LABEL[b.vendor]}</span>
                    <span className="coll-ref" title={b.ref}>
                      {b.ref}
                    </span>
                    <span className="subtle">
                      {b.photos.length}
                      {b.missing > 0 && ` · ${b.missing} unavailable`}
                    </span>
                  </h4>
                  <PhotoGrid
                    images={b.photos}
                    isSelected={sel.isSelected}
                    onToggle={sel.toggle}
                    onOpen={(i) => {
                      const photo = b.photos[i]
                      if (sel.isSelected(photo.id) && selectedPhotos.length > 1) {
                        const at = selectedPhotos.findIndex((p) => p.id === photo.id)
                        onPlay(selectedPhotos, Math.max(0, at))
                      } else {
                        onPlay(photos, b.offset + i)
                      }
                    }}
                    onDragPhotos={(id) =>
                      sel.isSelected(id) ? selectedPhotos.map((p) => p.id) : [id]
                    }
                    empty={
                      b.vendor === 'local'
                        ? 'This folder isn’t connected in this browser — reconnect it in the Library.'
                        : 'This link isn’t loaded — check it in the Library.'
                    }
                  />
                </div>
              ))
            )}

            <SelectionBar
              count={sel.count}
              total={photos.length}
              flatGroups={groupsApi.flat}
              onAddToGroup={addToGroup}
              onCreateGroupWith={createGroupWith}
              onPlay={() => onPlay(selectedPhotos, 0)}
              onDownload={() =>
                onDownload(
                  selectedPhotos,
                  G.pathOf(groups, group.id).join(' - ')
                )
              }
              onSelectAll={sel.selectAll}
              onClear={sel.clear}
              extraActions={
                <button className="btn danger" onClick={removeFromGroup}>
                  Remove from group
                </button>
              }
            />
          </>
        )}
      {sharing && group && (
        <ShareDialog
          projectId={projectId}
          group={group}
          blocks={blocks}
          apiKey={apiKey}
          flushProject={flushProject}
          onClose={() => setSharing(false)}
        />
      )}
      </div>
  )
}
