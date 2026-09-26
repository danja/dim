// Type-ahead for link targets: any <input data-picker> searches every facet
// via /find.json as you type and fills in the chosen resource's IRI.
// Without JavaScript the field still accepts a URL, IRI or [[type/slug]].

function debounce (fn, ms) {
  let t
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

function enhance (input) {
  const list = document.createElement('ul')
  list.className = 'picker'
  list.id = `picker-${Math.random().toString(36).slice(2)}`
  list.setAttribute('role', 'listbox')
  list.hidden = true
  input.after(list)
  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-controls', list.id)
  input.setAttribute('aria-expanded', 'false')
  let items = []
  let active = -1

  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1 }
  const choose = (i) => { if (items[i]) { input.value = items[i].iri; close() } }
  const highlight = (i) => {
    active = i
    for (const [n, li] of [...list.children].entries()) li.setAttribute('aria-selected', String(n === i))
  }

  const search = debounce(async () => {
    const q = input.value.trim()
    if (q.length < 2 || /^(https?:|\/|\[\[)/.test(q)) return close()
    try {
      const response = await fetch(`/find.json?q=${encodeURIComponent(q)}&limit=8`, { headers: { Accept: 'application/json' } })
      const { groups } = await response.json()
      items = groups.flatMap(g => g.results.map(r => ({ ...r, facet: g.label })))
    } catch {
      items = []
    }
    list.replaceChildren(...items.map((r, i) => {
      const li = document.createElement('li')
      li.setAttribute('role', 'option')
      li.textContent = r.label
      const small = document.createElement('small')
      small.textContent = r.facet
      li.append(small)
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(i) })
      return li
    }))
    list.hidden = items.length === 0
    input.setAttribute('aria-expanded', String(!list.hidden))
    highlight(-1)
  }, 250)

  input.addEventListener('input', search)
  input.addEventListener('blur', () => setTimeout(close, 100))
  input.addEventListener('keydown', e => {
    if (list.hidden) return
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(active + 1, items.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(active - 1, 0)) }
    if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active) }
    if (e.key === 'Escape') close()
  })
}

for (const input of document.querySelectorAll('input[data-picker]')) enhance(input)
