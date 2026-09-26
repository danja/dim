/* eslint-env browser */
// Outliner: in-place editing for Trestle trees marked data-editable.
// Everything here is also possible through the page's forms; this adds
// Workflowy-style keys and a touch toolbar. After any structural change the
// visible tree is re-fetched from /trestle/tree, so the page never drifts
// from the server.

const root = document.querySelector('.outline[data-editable]')
const csrf = document.querySelector('meta[name="csrf-token"]')?.content

if (root && csrf) {
  const outline = root.dataset.outline
  const zoomId = root.dataset.parent.includes('/node/') ? root.dataset.parent.slice(root.dataset.parent.lastIndexOf('/') + 1) : ''
  let editing = null // { li, input, raw }
  let busy = false

  const status = document.createElement('p')
  status.className = 'outliner-status'
  status.setAttribute('role', 'status')
  root.before(status)
  const say = (text) => { status.textContent = text }

  async function api (path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body)
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`)
    return json
  }

  async function refresh (focusId) {
    const response = await fetch(`/trestle/tree?outline=${encodeURIComponent(outline)}&parent=${encodeURIComponent(zoomId)}`)
    if (!response.ok) return location.reload()
    const holder = document.createElement('div')
    holder.innerHTML = await response.text()
    root.replaceChildren(...holder.firstElementChild.childNodes)
    if (focusId) edit(liOf(focusId))
  }

  const liOf = id => root.querySelector(`li[data-id="${CSS.escape(id)}"]`)
  const rows = () => [...root.querySelectorAll('li')]

  function edit (li) {
    if (!li) return
    finish()
    const span = li.querySelector(':scope > .row > .title')
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'title-input'
    input.value = span.dataset.raw ?? ''
    input.setAttribute('aria-label', 'Item title')
    span.hidden = true
    span.after(input)
    editing = { li, input, span, raw: input.value }
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    toolbar.hidden = false
    input.addEventListener('keydown', onKey)
    input.addEventListener('blur', () => setTimeout(() => { if (editing?.input === input && !busy) save().then(finish) }, 150))
  }

  function finish () {
    if (!editing) return
    editing.input.remove()
    editing.span.hidden = false
    editing = null
    toolbar.hidden = true
  }

  async function save () {
    if (!editing) return
    const { li, input, span } = editing
    if (input.value === editing.raw) return
    const { node } = await api(`/trestle/node/${li.dataset.id}`, { title: input.value })
    span.innerHTML = node.titleHtml
    span.dataset.raw = node.title
    editing.raw = node.title
  }

  async function run (task) {
    if (busy) return
    busy = true
    root.dataset.busy = ''
    try {
      await task()
      say('')
    } catch (error) {
      say(`Not saved: ${error.message}`)
    } finally {
      busy = false
      delete root.dataset.busy
    }
  }

  const id = () => editing?.li.dataset.id

  const actions = {
    newItem: () => run(async () => {
      const after = id()
      await save()
      const { node } = await api('/trestle/nodes', { after, title: '' })
      await refresh(node.id)
    }),
    move: (op) => run(async () => {
      const current = id()
      await save()
      const { moved } = await api(`/trestle/node/${current}/move`, { op })
      if (moved) await refresh(current)
      else say(`Can't ${op} this item`)
    }),
    step: (delta) => run(async () => {
      const all = rows()
      const i = all.indexOf(editing.li)
      await save()
      edit(all[i + delta])
    }),
    remove: () => run(async () => {
      const li = editing.li
      if (Number(li.dataset.children) > 0 && !confirm('Delete this item and everything under it?')) return
      const all = rows()
      const prev = all[all.indexOf(li) - 1]?.dataset.id
      await api(`/trestle/node/${li.dataset.id}/delete`, {})
      editing = null
      await refresh(prev)
    }),
    done: () => run(async () => { await save(); finish() })
  }

  function onKey (e) {
    if (busy) { e.preventDefault(); return }
    const key = e.key
    if (key === 'Enter') { e.preventDefault(); actions.newItem() } else if (key === 'Tab') { e.preventDefault(); actions.move(e.shiftKey ? 'outdent' : 'indent') } else if (key === 'ArrowUp' && e.altKey) { e.preventDefault(); actions.move('up') } else if (key === 'ArrowDown' && e.altKey) { e.preventDefault(); actions.move('down') } else if (key === 'ArrowUp') { e.preventDefault(); actions.step(-1) } else if (key === 'ArrowDown') { e.preventDefault(); actions.step(1) } else if (key === 'Backspace' && editing.input.value === '' && Number(editing.li.dataset.children) === 0) { e.preventDefault(); actions.remove() } else if (key === 'Escape') { e.preventDefault(); editing.input.value = editing.raw; finish() }
  }

  // Touch toolbar: the same actions as the keys, shown while editing.
  const toolbar = document.createElement('div')
  toolbar.className = 'outliner-toolbar'
  toolbar.hidden = true
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Item actions')
  for (const [label, text, fn] of [
    ['Outdent', '⇤', () => actions.move('outdent')],
    ['Indent', '⇥', () => actions.move('indent')],
    ['Move up', '↑', () => actions.move('up')],
    ['Move down', '↓', () => actions.move('down')],
    ['New item', '+', () => actions.newItem()],
    ['Delete', '✕', () => actions.remove()],
    ['Done', '✓', () => actions.done()]
  ]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = text
    button.setAttribute('aria-label', label)
    button.addEventListener('pointerdown', e => e.preventDefault()) // keep the input focused
    button.addEventListener('click', fn)
    toolbar.append(button)
  }
  document.body.append(toolbar)

  // Click a title (not a link inside it) to edit.
  root.addEventListener('click', e => {
    const span = e.target.closest('.title')
    if (!span || e.target.closest('a')) return
    edit(span.closest('li'))
  })

  // Collapse/expand without a page load.
  root.addEventListener('submit', e => {
    const form = e.target.closest('.toggle-form')
    if (!form) return
    e.preventDefault()
    const li = form.closest('li')
    const collapsed = form.querySelector('input[name="collapsed"]').value
    run(async () => {
      await api(`/trestle/node/${li.dataset.id}`, { collapsed })
      await refresh()
    })
  })
}
