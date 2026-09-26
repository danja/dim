/* eslint-env browser */
// Farelo board: drag cards between and within columns (pointer events —
// on touch, drag by the ⠿ grip so the page still scrolls), or move the
// focused card with Alt+←/→ (column) and Alt+↑/↓ (order). The "Move"
// menu on each card does the same without JavaScript.

const board = document.querySelector('.board')
const csrf = document.querySelector('meta[name="csrf-token"]')?.content

if (board && csrf) {
  const status = document.createElement('p')
  status.className = 'board-status'
  status.setAttribute('role', 'status')
  board.before(status)

  async function move (id, body) {
    status.textContent = ''
    const response = await fetch(`/farelo/task/${id}/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body)
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) {
      status.textContent = json.error ?? `Not moved (HTTP ${response.status})`
      return false
    }
    sessionStorage.setItem('farelo-focus', id)
    location.reload()
    return true
  }

  // Refocus the card that just moved.
  const again = sessionStorage.getItem('farelo-focus')
  if (again) {
    sessionStorage.removeItem('farelo-focus')
    const card = board.querySelector(`.task-card[data-id="${CSS.escape(again)}"]`)
    if (card) { card.focus(); card.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }

  const columns = [...board.querySelectorAll('.cards')]

  // Where a drop at (x, y) lands: the column under the pointer, and the card
  // it goes before (or after, at the end).
  function dropTarget (x, y) {
    const list = document.elementFromPoint(x, y)?.closest('.cards')
    if (!list) return null
    const cards = [...list.querySelectorAll('.task-card:not(.dragging)')]
    const next = cards.find(c => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2 })
    return { list, before: next?.dataset.id ?? null, after: next ? null : cards.at(-1)?.dataset.id ?? null }
  }

  let drag = null
  board.addEventListener('pointerdown', e => {
    const card = e.target.closest('.task-card')
    if (!card || e.button !== 0 || e.target.closest('a, button, select, summary, input')) return
    if (e.pointerType !== 'mouse' && !e.target.closest('.grip')) return
    drag = { card, x: e.clientX, y: e.clientY, started: false }
    card.setPointerCapture(e.pointerId)
  })
  board.addEventListener('pointermove', e => {
    if (!drag) return
    if (!drag.started && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
    drag.started = true
    drag.card.classList.add('dragging')
    drag.card.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`
    for (const c of columns) c.classList.toggle('drop-here', c === dropTarget(e.clientX, e.clientY)?.list)
  })
  board.addEventListener('pointerup', e => {
    if (!drag) return
    const { card, started } = drag
    drag = null
    card.classList.remove('dragging')
    card.style.transform = ''
    for (const c of columns) c.classList.remove('drop-here')
    if (!started) return
    const target = dropTarget(e.clientX, e.clientY)
    if (target) move(card.dataset.id, { status: target.list.dataset.status, before: target.before, after: target.after })
  })
  board.addEventListener('pointercancel', () => {
    if (drag) { drag.card.classList.remove('dragging'); drag.card.style.transform = '' }
    drag = null
  })

  board.addEventListener('keydown', e => {
    const card = e.target.closest('.task-card')
    if (!card || !e.altKey) return
    const list = card.closest('.cards')
    const i = columns.indexOf(list)
    const cards = [...list.querySelectorAll('.task-card')]
    const j = cards.indexOf(card)
    let body = null
    if (e.key === 'ArrowLeft' && i > 0) body = { status: columns[i - 1].dataset.status }
    if (e.key === 'ArrowRight' && i < columns.length - 1) body = { status: columns[i + 1].dataset.status }
    if (e.key === 'ArrowUp' && j > 0) body = { status: list.dataset.status, before: cards[j - 1].dataset.id }
    if (e.key === 'ArrowDown' && j < cards.length - 1) body = { status: list.dataset.status, after: cards[j + 1].dataset.id }
    if (!body) return
    e.preventDefault()
    move(card.dataset.id, body)
  })
}
