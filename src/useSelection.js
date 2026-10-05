import { useCallback, useMemo, useRef, useState } from 'react'

/**
 * Multi-select over an ordered list, with shift-click range extension.
 * `ids` is the currently visible order — ranges are computed against it, so
 * switching groups naturally rebases what shift-click means.
 */
export default function useSelection(ids) {
  const [selected, setSelected] = useState(() => new Set())
  const anchor = useRef(null)

  // Drop anything no longer on screen so counts never lie.
  const visible = useMemo(() => new Set(ids), [ids])
  const effective = useMemo(
    () => new Set([...selected].filter((id) => visible.has(id))),
    [selected, visible]
  )

  const toggle = useCallback(
    (id, { shiftKey = false } = {}) => {
      setSelected((prev) => {
        const next = new Set([...prev].filter((x) => visible.has(x)))

        if (shiftKey && anchor.current != null) {
          const from = ids.indexOf(anchor.current)
          const to = ids.indexOf(id)
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from < to ? [from, to] : [to, from]
            const shouldSelect = !next.has(id)
            for (let i = lo; i <= hi; i++) {
              if (shouldSelect) next.add(ids[i])
              else next.delete(ids[i])
            }
            return next
          }
        }

        if (next.has(id)) next.delete(id)
        else next.add(id)
        anchor.current = id
        return next
      })
    },
    [ids, visible]
  )

  const selectAll = useCallback(() => setSelected(new Set(ids)), [ids])

  /** Union in a batch — used by "select all" on a single folder section. */
  const add = useCallback((extra) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of extra) next.add(id)
      return next
    })
  }, [])
  const clear = useCallback(() => {
    anchor.current = null
    setSelected(new Set())
  }, [])

  const isSelected = useCallback((id) => effective.has(id), [effective])

  return {
    selected: effective,
    count: effective.size,
    isSelected,
    toggle,
    add,
    selectAll,
    clear,
    setSelected,
  }
}
