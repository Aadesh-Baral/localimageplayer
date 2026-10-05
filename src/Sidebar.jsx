import ProjectBar from './ProjectBar'
import GroupTree from './GroupTree'
import { VENDOR_LABEL } from './project'

function SourceItem({ source, active, onClick }) {
  const { status, images, vendor } = source
  const attention = ['needs-permission', 'disconnected', 'unsupported', 'error'].includes(status)
  // Local paths are long; the last folder name is what you recognise.
  const label =
    vendor === 'local'
      ? source.ref.split(/[\\/]/).filter(Boolean).pop() || source.ref
      : source.name || source.ref
  return (
    <button
      className={`side-item side-source ${active ? 'active' : ''}`}
      onClick={onClick}
      title={source.ref}
    >
      <span className={`vendor-dot vendor-${vendor}`} />
      <span className="side-label">{label}</span>
      <span className={`side-count ${attention ? 'warn' : ''}`}>
        {status === 'loading' ? '…' : attention ? '!' : images.length}
      </span>
    </button>
  )
}

/**
 * Left-hand navigation: project, views, sources, collections, account.
 * `view` is { type: 'library' | 'source' | 'collection' | 'downloads', id? }.
 */
export default function Sidebar({
  view,
  onView,
  projectsApi,
  sourcesApi,
  groupsApi,
  downloadsApi,
  onCreateGroup,
  onDeleteGroup,
  onNewProject,
  onImport,
  onApiKey,
  hasLegacy,
  auth,
  onReloadAll,
  onAddLocal,
  open,
  onClose,
}) {
  const { sources, allImages } = sourcesApi
  const go = (v) => {
    onView(v)
    onClose?.()
  }
  const isView = (type, id) => view.type === type && (id === undefined || view.id === id)

  return (
    <>
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="side-top">
          <div className="brand">Image Player</div>
          <ProjectBar
            projectsApi={projectsApi}
            onNewProject={onNewProject}
            onImport={onImport}
            onApiKey={onApiKey}
            hasLegacy={hasLegacy}
            auth={auth}
          />
        </div>

        <div className="side-scroll">
          <nav className="side-nav">
            <button
              className={`side-item ${isView('library') ? 'active' : ''}`}
              onClick={() => go({ type: 'library' })}
            >
              <span className="side-icon">▦</span>
              <span className="side-label">Library</span>
              <span className="side-count">{allImages.length}</span>
            </button>
            <button
              className={`side-item ${isView('downloads') ? 'active' : ''}`}
              onClick={() => go({ type: 'downloads' })}
            >
              <span className="side-icon">↓</span>
              <span className="side-label">Downloads</span>
              {downloadsApi.active > 0 ? (
                <span className="side-count">{downloadsApi.active}…</span>
              ) : downloadsApi.failedJobs > 0 ? (
                <span className="side-count warn">{downloadsApi.failedJobs}</span>
              ) : null}
            </button>
          </nav>

          {['gdrive', 'local'].map((vendor) => {
            const list = sources.filter((s) => s.vendor === vendor)
            return (
              <div className="side-section" key={vendor}>
                <div className="side-head">
                  <h3>{vendor === 'gdrive' ? 'Drive links' : 'Local folders'}</h3>
                  <button
                    className="btn small ghost"
                    title={`Add ${VENDOR_LABEL[vendor].toLowerCase()}`}
                    onClick={() =>
                      vendor === 'local' ? onAddLocal() : go({ type: 'library', add: vendor })
                    }
                  >
                    +
                  </button>
                </div>
                {list.length === 0 ? (
                  <p className="side-empty">None yet</p>
                ) : (
                  list.map((s) => (
                    <SourceItem
                      key={s.sid}
                      source={s}
                      active={isView('source', s.sid)}
                      onClick={() => go({ type: 'source', id: s.sid })}
                    />
                  ))
                )}
              </div>
            )
          })}

          <div className="side-section side-tree">
            <GroupTree
              embedded
              groups={groupsApi.groups}
              selectedId={view.type === 'collection' ? view.id : null}
              onSelect={(id) => go({ type: 'collection', id })}
              onCreateGroup={onCreateGroup}
              onRename={groupsApi.renameGroup}
              onDelete={onDeleteGroup}
              onMoveGroup={groupsApi.moveGroup}
              onDropPhotos={groupsApi.addPhotos}
              canMove={groupsApi.canMove}
            />
          </div>
        </div>

        <div className="side-foot">
          {auth?.user?.picture ? (
            <img className="avatar" src={auth.user.picture} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="avatar avatar-blank">{(auth?.user?.email || '?')[0]}</span>
          )}
          <span className="side-user" title={auth?.user?.email}>
            {auth?.user?.name || auth?.user?.email}
          </span>
          <button className="btn small ghost" onClick={onReloadAll} title="Re-read every source">
            ↻
          </button>
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={onClose} />}
    </>
  )
}
