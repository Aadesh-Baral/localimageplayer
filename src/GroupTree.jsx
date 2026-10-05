import { useState } from 'react'
import * as G from './groups'

const PHOTO_MIME = 'application/x-imageplayer-photos'
const GROUP_MIME = 'application/x-imageplayer-group'

function GroupNode({
  group,
  depth,
  groups,
  selectedId,
  onSelect,
  onCreateChild,
  onRename,
  onDelete,
  onMoveGroup,
  onDropPhotos,
  canMove,
  expanded,
  toggleExpanded,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(group.name)
  const [dropping, setDropping] = useState(false)

  const children = G.childrenOf(groups, group.id)
  const isOpen = expanded.has(group.id)
  const directCount = group.photoIds.length
  const totalCount = G.collectPhotoIds(groups, group.id, true).length

  const commitRename = () => {
    setEditing(false)
    if (draft.trim() && draft !== group.name) onRename(group.id, draft)
    else setDraft(group.name)
  }

  return (
    <li className="tree-node">
      <div
        className={`tree-row ${selectedId === group.id ? 'active' : ''} ${
          dropping ? 'dropping' : ''
        }`}
        style={{ paddingLeft: 8 + depth * 15 }}
        onClick={() => onSelect(group.id)}
        draggable={!editing}
        onDragStart={(e) => {
          e.stopPropagation()
          e.dataTransfer.setData(GROUP_MIME, group.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          const types = e.dataTransfer.types
          if (types.includes(PHOTO_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
            setDropping(true)
          } else if (types.includes(GROUP_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setDropping(true)
          }
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDropping(false)
          const photoRaw = e.dataTransfer.getData(PHOTO_MIME)
          if (photoRaw) {
            try {
              onDropPhotos(group.id, JSON.parse(photoRaw))
            } catch {
              /* malformed payload, ignore */
            }
            return
          }
          const movingId = e.dataTransfer.getData(GROUP_MIME)
          if (movingId && canMove(movingId, group.id)) {
            onMoveGroup(movingId, group.id)
            toggleExpanded(group.id, true)
          }
        }}
      >
        <button
          className={`twisty ${children.length ? '' : 'leaf'} ${
            isOpen ? 'open' : ''
          }`}
          onClick={(e) => {
            e.stopPropagation()
            if (children.length) toggleExpanded(group.id)
          }}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          tabIndex={children.length ? 0 : -1}
        >
          {children.length ? '▸' : '•'}
        </button>

        {editing ? (
          <input
            className="tree-input"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraft(group.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span
            className="tree-name"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setDraft(group.name)
              setEditing(true)
            }}
            title={G.pathOf(groups, group.id).join(' / ')}
          >
            {group.name}
          </span>
        )}

        <span className="tree-count" title={`${directCount} directly, ${totalCount} including subgroups`}>
          {totalCount}
        </span>

        <span className="tree-actions">
          <button
            title="New subgroup"
            onClick={(e) => {
              e.stopPropagation()
              onCreateChild(group.id)
              toggleExpanded(group.id, true)
            }}
          >
            +
          </button>
          <button
            title="Rename"
            onClick={(e) => {
              e.stopPropagation()
              setDraft(group.name)
              setEditing(true)
            }}
          >
            ✎
          </button>
          <button
            title="Delete group and its subgroups"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(group.id)
            }}
          >
            ×
          </button>
        </span>
      </div>

      {isOpen && children.length > 0 && (
        <ul className="tree-children">
          {children.map((c) => (
            <GroupNode
              key={c.id}
              group={c}
              depth={depth + 1}
              groups={groups}
              selectedId={selectedId}
              onSelect={onSelect}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onMoveGroup={onMoveGroup}
              onDropPhotos={onDropPhotos}
              canMove={canMove}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function GroupTree({
  groups,
  selectedId,
  onSelect,
  onCreateGroup,
  onRename,
  onDelete,
  onMoveGroup,
  onDropPhotos,
  canMove,
  embedded = false,
}) {
  const [expanded, setExpanded] = useState(() => {
    // Start with the open collection's ancestors expanded so it's visible.
    const open = new Set()
    let cur = selectedId ? groups[selectedId]?.parentId : null
    while (cur && groups[cur] && !open.has(cur)) {
      open.add(cur)
      cur = groups[cur].parentId
    }
    return open
  })
  const [rootDropping, setRootDropping] = useState(false)

  const toggleExpanded = (id, force) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      const shouldOpen = force ?? !next.has(id)
      if (shouldOpen) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const roots = G.childrenOf(groups, null)

  return (
    <div className={embedded ? 'tree tree-embedded' : 'tree'}>
      <div className="tree-head">
        <h3>Collections</h3>
        <button
          className="btn small ghost"
          onClick={() => onCreateGroup(null)}
          title="New collection"
        >
          +
        </button>
      </div>

      <div
        className={`tree-root ${rootDropping ? 'dropping' : ''}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(GROUP_MIME)) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            setRootDropping(true)
          }
        }}
        onDragLeave={() => setRootDropping(false)}
        onDrop={(e) => {
          setRootDropping(false)
          const movingId = e.dataTransfer.getData(GROUP_MIME)
          if (movingId && canMove(movingId, null)) onMoveGroup(movingId, null)
        }}
      >
        {roots.length === 0 ? (
          <p className="tree-empty">
            No collections yet. Select photos and choose <em>Add to group → New group</em>,
            or press <strong>+</strong> above.
          </p>
        ) : (
          <ul className="tree-list">
            {roots.map((g) => (
              <GroupNode
                key={g.id}
                group={g}
                depth={0}
                groups={groups}
                selectedId={selectedId}
                onSelect={onSelect}
                onCreateChild={onCreateGroup}
                onRename={onRename}
                onDelete={onDelete}
                onMoveGroup={onMoveGroup}
                onDropPhotos={onDropPhotos}
                canMove={canMove}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
              />
            ))}
          </ul>
        )}
      </div>

      {!embedded && (
        <p className="tree-hint">
          Drag a collection onto another to nest it, or onto blank space to move it to the
          top level. Drag photos onto a collection to add them.
        </p>
      )}
    </div>
  )
}
