import PhotoGrid from './PhotoGrid'

/** One source (a Drive link or a local folder) in the Library. */
export default function Section({
  source,
  collapsed,
  onToggle,
  isSelected,
  onToggleSelect,
  onOpen,
  onDragPhotos,
  onPlaySection,
  onSelectSection,
  onReload,
  onRemove,
  onReconnect,
  onRelink,
  selectedInSection,
}) {
  const { images, status, error, vendor, ref } = source
  const isLocal = vendor === 'local'
  const label = isLocal
    ? ref
    : source.name || `Folder ${source.sid.slice(2, 8)}…`
  const sub = isLocal
    ? source.folderName && source.folderName !== ref
      ? `folder “${source.folderName}”`
      : null
    : ref

  const needsAction =
    status === 'needs-permission' || status === 'disconnected' || status === 'unsupported'

  return (
    <section className={`sect ${collapsed ? 'collapsed' : ''} ${needsAction ? 'sect-attention' : ''}`}>
      <header className="sect-head">
        <button className="sect-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <span className={`twisty ${collapsed ? '' : 'open'}`}>▸</span>
          <span className={`vendor-dot vendor-${vendor}`} title={isLocal ? 'Local folder' : 'Google Drive'} />
          <span className="sect-label">
            <span className="sect-name" title={label}>
              {label}
            </span>
            {sub && (
              <span className="sect-ref" title={sub}>
                {sub}
              </span>
            )}
          </span>
        </button>

        <span className="sect-meta">
          {status === 'loading'
            ? 'Loading…'
            : needsAction
              ? 'Not connected'
              : `${images.length} photo${images.length === 1 ? '' : 's'}`}
          {selectedInSection > 0 && (
            <span className="sect-selected">{selectedInSection} selected</span>
          )}
        </span>

        <div className="sect-actions">
          {status === 'needs-permission' && (
            <button className="btn small primary-btn" onClick={onReconnect}>
              Reconnect
            </button>
          )}
          {status === 'disconnected' && (
            <button className="btn small primary-btn" onClick={onRelink}>
              Choose folder…
            </button>
          )}
          {!needsAction && (
            <>
              <button
                className="btn small"
                onClick={onSelectSection}
                disabled={!images.length}
                title="Select every photo in this folder"
              >
                Select all
              </button>
              <button className="btn small" onClick={onPlaySection} disabled={!images.length}>
                Play
              </button>
              <button className="btn small ghost" onClick={onReload} title="Reload">
                ↻
              </button>
              {isLocal && (
                <button
                  className="btn small ghost"
                  onClick={onRelink}
                  title="Point this entry at a different folder on this computer"
                >
                  ⇄
                </button>
              )}
            </>
          )}
          <button className="btn small ghost" onClick={onRemove} title="Remove from project">
            ×
          </button>
        </div>
      </header>

      {error && <p className={needsAction ? 'sect-note' : 'sect-error'}>{error}</p>}

      {!collapsed && !needsAction && (
        <div className="sect-body">
          {status === 'loading' && !images.length ? (
            <div className="empty">Loading photos…</div>
          ) : (
            <PhotoGrid
              images={images}
              isSelected={isSelected}
              onToggle={onToggleSelect}
              onOpen={onOpen}
              onDragPhotos={onDragPhotos}
              empty="Nothing to show for this folder."
            />
          )}
        </div>
      )}
    </section>
  )
}
