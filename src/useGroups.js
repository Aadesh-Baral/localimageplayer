import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as G from './groups'

/**
 * Group tree state for one project ("Project Collections"). A group may hold
 * photos from any source in the project; photoIds are photo keys (see
 * project.js). `initialGroups` seeds it, and `onChange` receives the group map
 * after every edit so the project can be saved.
 * All mutators are immutable so React re-renders predictably.
 */
export default function useGroups(initialGroups, onChange) {
  const [state, setState] = useState(() => ({ groups: initialGroups || {} }))

  const seed = useRef(state.groups)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => {
    if (state.groups === seed.current) return // nothing edited yet
    onChangeRef.current?.(state.groups)
  }, [state])

  const groups = state.groups

  const createGroup = useCallback((name, parentId = null) => {
    const id = G.uid()
    setState((s) => ({
      ...s,
      groups: {
        ...s.groups,
        [id]: {
          id,
          name: name?.trim() || 'Untitled group',
          parentId: parentId && s.groups[parentId] ? parentId : null,
          photoIds: [],
          createdAt: Date.now(),
        },
      },
    }))
    return id
  }, [])

  const renameGroup = useCallback((id, name) => {
    const clean = name?.trim()
    if (!clean) return
    setState((s) =>
      s.groups[id]
        ? { ...s, groups: { ...s.groups, [id]: { ...s.groups[id], name: clean } } }
        : s
    )
  }, [])

  /** Deletes a group and everything nested under it. */
  const deleteGroup = useCallback((id) => {
    setState((s) => {
      if (!s.groups[id]) return s
      const doomed = new Set([id, ...G.descendantIds(s.groups, id)])
      const next = {}
      for (const [gid, g] of Object.entries(s.groups)) {
        if (!doomed.has(gid)) next[gid] = g
      }
      return { ...s, groups: next }
    })
  }, [])

  /**
   * Re-parent a group. Refuses moves that would create a cycle (dropping a
   * group onto itself or onto one of its own descendants).
   */
  const moveGroup = useCallback((id, newParentId) => {
    setState((s) => {
      const g = s.groups[id]
      if (!g) return s
      const parent = newParentId ?? null
      if (parent !== null && !s.groups[parent]) return s
      if (parent !== null && G.isSelfOrDescendant(s.groups, parent, id)) return s
      if (g.parentId === parent) return s
      return { ...s, groups: { ...s.groups, [id]: { ...g, parentId: parent } } }
    })
  }, [])

  const canMove = useCallback(
    (id, newParentId) => {
      if (!groups[id]) return false
      if (newParentId === null) return groups[id].parentId !== null
      if (!groups[newParentId]) return false
      return !G.isSelfOrDescendant(groups, newParentId, id)
    },
    [groups]
  )

  const addPhotos = useCallback((groupId, photoIds) => {
    setState((s) => {
      const g = s.groups[groupId]
      if (!g || !photoIds?.length) return s
      const merged = [...new Set([...g.photoIds, ...photoIds])]
      if (merged.length === g.photoIds.length) return s
      return { ...s, groups: { ...s.groups, [groupId]: { ...g, photoIds: merged } } }
    })
  }, [])

  const removePhotos = useCallback((groupId, photoIds) => {
    setState((s) => {
      const g = s.groups[groupId]
      if (!g || !photoIds?.length) return s
      const drop = new Set(photoIds)
      const kept = g.photoIds.filter((p) => !drop.has(p))
      if (kept.length === g.photoIds.length) return s
      return { ...s, groups: { ...s.groups, [groupId]: { ...g, photoIds: kept } } }
    })
  }, [])

  const flat = useMemo(() => G.flatten(groups), [groups])

  return {
    groups,
    flat,
    createGroup,
    renameGroup,
    deleteGroup,
    moveGroup,
    canMove,
    addPhotos,
    removePhotos,
  }
}
