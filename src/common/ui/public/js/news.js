// News: read/star toggles in place, and opening an item marks it read.
// Without this script the same forms post and reload the page.

const token = document.querySelector('meta[name="csrf-token"]')?.content ?? ''

async function setFlags (ids, fields) {
  const response = await fetch('/news/items/flags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': token },
    body: JSON.stringify({ ids, ...fields }),
    keepalive: true
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function show (id, { read, starred }) {
  for (const row of document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`)) {
    row.classList.toggle('read', read)
    row.classList.toggle('starred', starred)
  }
  for (const form of document.querySelectorAll('form.flag')) {
    if (form.elements.ids.value !== id) continue
    const button = form.querySelector('button')
    const key = button.dataset.flag
    const on = key === 'read' ? read : starred
    form.elements[key].value = on ? 'false' : 'true'
    button.setAttribute('aria-pressed', String(on))
    if (key === 'read') {
      button.textContent = on ? 'unread' : 'read'
      button.setAttribute('aria-label', on ? 'Mark unread' : 'Mark read')
    } else {
      button.textContent = on ? '★' : '☆'
      button.setAttribute('aria-label', on ? 'Unstar' : 'Star')
    }
  }
}

document.addEventListener('submit', async event => {
  const form = event.target
  if (!form.matches('form.flag')) return
  event.preventDefault()
  const key = form.querySelector('button').dataset.flag
  try {
    const result = await setFlags([form.elements.ids.value], { [key]: form.elements[key].value === 'true' })
    for (const item of result.items) show(item.id, item)
  } catch {
    form.submit()
  }
})

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-read-id]')
  if (!link) return
  const id = link.dataset.readId
  setFlags([id], { read: true }).then(result => result.items.forEach(item => show(item.id, item))).catch(() => {})
})
