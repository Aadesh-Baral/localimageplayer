import { useEffect, useMemo, useRef, useState } from 'react'
import Section from './Section'
import SelectionBar from './SelectionBar'
import useSelection from './useSelection'
import { VENDOR_LABEL } from './project'
import { supported as localSupported } from './localFolders'

export default function Library({
  sourcesApi,
  apiKey,
  groupsApi,
  onPlay,
  onDownload,
  onlySid = null,
  focusAdd = null,
}) {
  const {
    sources: allSources,
    collapsed,
    toggleCollapsed,
    setAllCollapsed,
    removeSource,
    loadSource,
    addLinks,
    addLocalFolder,
    relinkLocal,
  } = sourcesApi

  const [adding, setAdding] = useState('')
  const [addMsg, setAddMsg] = useState(null)

  // Whole library, or just one Drive link / local folder from the sidebar.
  const sources = useMemo(
    () => (onlySid ? allSources.filter((s) => s.sid === onlySid) : allSources),
    [allSources, onlySid]
  )
  const allImages = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const s of sources)
      for (const i of s.images)
        if (!seen.has(i.id)) {
          seen.add(i.id)
          out.push(i)
        }
    return out
  }, [sources])
  const single = onlySid ? sources[0] : null

  const linkInput = useRef(null)
  useEffect(() => {
    if (focusAdd === 'gdrive') linkInput.current?.focus()
  }, [focusAdd])

  // Selection spans every section: the id list is the flattened, in-order view
  // of all sources, so a shift-click range can run across a folder boundary.
  const ids = useMemo(() => allImages.map((i) => i.id), [allImages])
  const sel = useSelection(ids)

  const selectedPhotos = useMemo(
    () => allImages.filter((i) => sel.selected.has(i.id)),
    [allImages, sel.selected]
  )

  const anyExpanded = sources.some((s) => !collapsed[s.sid])

  const addToGroup = (groupId) => {
    groupsApi.addPhotos(groupId, selectedPhotos.map((p) => p.id))
    sel.clear()
  }

  const createGroupWith = () => {
    const name = window.prompt('Name for the new group?', 'New group')
    if (!name) return
    const id = groupsApi.createGroup(name, null)
    groupsApi.addPhotos(id, selectedPhotos.map((p) => p.id))
    sel.clear()
  }

  const submitAdd = (e) => {
    e.preventDefault()
    if (!adding.trim()) return
    const { added, duplicates } = addLinks(adding, apiKey)
    setAdding('')
    if (!added && !duplicates) setAddMsg("Couldn't find a Drive link in that.")
    else if (!added) setAddMsg('Already in this project.')
    else
      setAddMsg(
        `Added ${added} Drive link${added === 1 ? '' : 's'}${
          duplicates ? `, skipped ${duplicates} already added` : ''
        }.`
      )
  }

  const addLocal = async () => {
    setAddMsg(null)
    try {
      const path = await addLocalFolder()
      if (path) setAddMsg(`Added local folder “${path}”.`)
    } catch (e) {
      if (e.name !== 'AbortError') setAddMsg(e.message)
    }
  }

  const relink = async (sid) => {
    try {
      await relinkLocal(sid)
    } catch (e) {
      if (e.name !== 'AbortError') setAddMsg(e.message)
    }
  }

  const renderSection = (source) => {
    const sectionIds = source.images.map((i) => i.id)
    return (
      <Section
        key={source.sid}
        source={source}
        collapsed={!onlySid && !!collapsed[source.sid]}
        onToggle={() => toggleCollapsed(source.sid)}
        isSelected={sel.isSelected}
        onToggleSelect={sel.toggle}
        onOpen={(i) => {
          const photo = source.images[i]
          // Opening a selected photo plays just the selection, from it.
          if (sel.isSelected(photo.id) && selectedPhotos.length > 1) {
            const at = selectedPhotos.findIndex((p) => p.id === photo.id)
            onPlay(selectedPhotos, Math.max(0, at))
            return
          }
          // Otherwise play from this photo through the whole library.
          const globalIndex = ids.indexOf(photo.id)
          onPlay(allImages, globalIndex === -1 ? 0 : globalIndex)
        }}
        onDragPhotos={(id) => (sel.isSelected(id) ? selectedPhotos.map((p) => p.id) : [id])}
        onPlaySection={() => onPlay(source.images, 0)}
        onSelectSection={() => sel.add(sectionIds)}
        onReload={() => loadSource(source.sid, apiKey)}
        onReconnect={() => loadSource(source.sid, apiKey, { request: true })}
        onRelink={() => relink(source.sid)}
        onRemove={() => {
          if (
            window.confirm(
              `Remove “${source.name || source.ref}” from this project? Collections keep their references, so re-adding it brings the photos back.`
            )
          ) {
            removeSource(source.sid)
          }
        }}
        selectedInSection={sectionIds.filter((id) => sel.selected.has(id)).length}
      />
    )
  }

  const byVendor = ['gdrive', 'local'].map((v) => [v, sources.filter((s) => s.vendor === v)])

  return (
    <div className="tab-body">
      <div className="tab-head">
        <div>
          {single ? (
            <>
              <h2 className="title-ellipsis" title={single.ref}>
                {single.vendor === 'local' ? single.ref : single.name || 'Drive folder'}
              </h2>
              <p className="subtle">
                {allImages.length} photo{allImages.length === 1 ? '' : 's'} ·{' '}
                {VENDOR_LABEL[single.vendor]}
              </p>
            </>
          ) : (
            <>
              <h2>
                {allImages.length} photo{allImages.length === 1 ? '' : 's'}
              </h2>
              <p className="subtle">
                across {sources.length} source{sources.length === 1 ? '' : 's'}
              </p>
            </>
          )}
        </div>
        <div className="tab-head-actions">
          <button
            className="btn"
            onClick={() => setAllCollapsed(anyExpanded)}
            disabled={!sources.length}
          >
            {anyExpanded ? 'Collapse all' : 'Expand all'}
          </button>
          <button
            className="btn primary-btn"
            onClick={() => onPlay(allImages, 0)}
            disabled={!allImages.length}
          >
            Play all
          </button>
        </div>
      </div>

      {!onlySid && (
      <div className="addrow">
        <form className="addbar" onSubmit={submitAdd}>
          <input
            ref={linkInput}
            type="text"
            value={adding}
            placeholder="Paste Google Drive folder links…"
            onChange={(e) => {
              setAdding(e.target.value)
              setAddMsg(null)
            }}
            spellCheck={false}
          />
          <button className="btn" type="submit" disabled={!adding.trim()}>
            Add link
          </button>
        </form>
        <button
          className="btn"
          onClick={addLocal}
          disabled={!localSupported()}
          title={
            localSupported()
              ? 'Pick a folder on this computer'
              : 'Local folders need Chrome or Edge on a computer'
          }
        >
          + Local folder…
        </button>
      </div>
      )}
      {addMsg && <p className="notice">{addMsg}</p>}
      {onlySid && !single && <div className="empty">This source was removed from the project.</div>}

      {single ? (
        renderSection(single)
      ) : onlySid ? null : sources.length === 0 ? (
        <div className="empty">
          This project has no sources yet. Paste a Drive folder link or add a local folder.
        </div>
      ) : (
        !onlySid && byVendor.map(
          ([vendor, list]) =>
            list.length > 0 && (
              <div className="vendor-block" key={vendor}>
                <h3 className="vendor-head">
                  <span className={`vendor-dot vendor-${vendor}`} />
                  {VENDOR_LABEL[vendor]}
                  <span className="subtle">
                    {list.length} {vendor === 'local' ? 'folder' : 'link'}
                    {list.length === 1 ? '' : 's'}
                  </span>
                </h3>
                {list.map(renderSection)}
              </div>
            )
        )
      )}

      <SelectionBar
        count={sel.count}
        total={allImages.length}
        flatGroups={groupsApi.flat}
        onAddToGroup={addToGroup}
        onCreateGroupWith={createGroupWith}
        onPlay={() => onPlay(selectedPhotos, 0)}
        onDownload={() => onDownload(selectedPhotos, 'photos')}
        onSelectAll={sel.selectAll}
        onClear={sel.clear}
      />
    </div>
  )
}
